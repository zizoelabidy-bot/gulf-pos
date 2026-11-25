/**
 * Food cost intelligence (directive §11): per-item profitability (food cost
 * percentage, margin), theoretical vs actual consumption, waste cost, and
 * recipe cost change history. All money math uses Decimal with half-up
 * rounding to the tenant currency's fraction digits (KWD = 3).
 */
import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import { getDatabase, now } from '../db';
import {
  getRecipe,
  getRecipeByProduct,
  parseRecipeSnapshot,
  type RecipeSnapshot,
} from './recipes';
import { roundCurrencyCost } from './supplies';

type Db = ReturnType<typeof getDatabase>;

export class FoodCostServiceError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'FoodCostServiceError';
    this.statusCode = statusCode;
  }
}

function fractionDigits(db: Db): number {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'currency'`).get() as
    | { value: string }
    | undefined;
  const code = (row?.value ?? 'KWD').trim().toUpperCase();
  // mirror resolveDbCurrencyFractionDigits without re-importing settings helpers
  return code === 'KWD' || code === 'BHD' || code === 'OMR' || code === 'JOD' || code === 'IQD'
    ? 3
    : code === 'JPY' || code === 'KRW'
      ? 0
      : 2;
}

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return new Decimal(part).div(whole).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

/** Per-product profitability: price, recipe unit cost, margin, food cost %. */
export function itemProfitability(db: Db) {
  const products = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.is_active, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = 1 ORDER BY p.name`,
    )
    .all() as { id: string; name: string; price: number | null; is_active: number; category_name: string | null }[];
  return products.map((p) => {
    const recipe = getRecipeByProduct(db, p.id);
    const unitCost = recipe && recipe.cost_known ? recipe.unit_cost : null;
    const price = typeof p.price === 'number' && Number.isFinite(p.price) ? p.price : null;
    const margin = price !== null && unitCost !== null ? roundCurrencyCost(new Decimal(price).minus(unitCost), fractionDigits(db)) : null;
    return {
      product_id: p.id,
      product_name: p.name,
      category_name: p.category_name,
      price,
      has_recipe: !!recipe && recipe.items.length > 0,
      cost_known: !!(recipe && recipe.cost_known),
      unit_cost: unitCost,
      margin,
      food_cost_pct: price !== null && unitCost !== null ? pct(unitCost, price) : null,
    };
  });
}

type Bucket = {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  theoretical_qty: number;
  depleted_qty: number;
  restored_qty: number;
  waste_qty: number;
  waste_cost: number;
};

/** Theoretical (per recipes on sold items) vs actual (stock movements) consumption. */
export function consumptionReport(db: Db, fromIso: string, toIso: string) {
  if (!fromIso || !toIso) throw new FoodCostServiceError(400, 'from and to are required');
  const supplies = db
    .prepare(`SELECT id, name, base_unit FROM supplies WHERE is_active = 1`)
    .all() as { id: string; name: string; base_unit: string }[];
  const buckets = new Map<string, Bucket>();
  for (const s of supplies) {
    buckets.set(s.id, {
      supply_id: s.id,
      supply_name: s.name,
      base_unit: s.base_unit,
      theoretical_qty: 0,
      depleted_qty: 0,
      restored_qty: 0,
      waste_qty: 0,
      waste_cost: 0,
    });
  }

  // Theoretical: sum recipe snapshot components on non-cancelled order lines.
  const lines = db
    .prepare(
      `SELECT oi.recipe_snapshot
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) < datetime(?)
         AND o.status != 'cancelled'
         AND oi.status NOT IN ('cancelled', 'voided')
         AND oi.recipe_snapshot IS NOT NULL`,
    )
    .all(fromIso, toIso) as { recipe_snapshot: string }[];
  for (const line of lines) {
    const snapshot: RecipeSnapshot | null = parseRecipeSnapshot(line.recipe_snapshot);
    if (!snapshot) continue;
    for (const component of snapshot.components) {
      const bucket = buckets.get(component.supply_id);
      if (bucket) bucket.theoretical_qty += Math.abs(component.quantity);
    }
  }

  // Actual: recipe depletion/restore and waste movements in the window.
  const movements = db
    .prepare(
      `SELECT supply_id, movement_type, SUM(quantity_delta) AS qty,
              SUM(ABS(quantity_delta) * COALESCE(unit_cost, 0)) AS cost
       FROM supply_movements
       WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
         AND movement_type IN ('recipe_depletion', 'recipe_restore', 'waste')
       GROUP BY supply_id, movement_type`,
    )
    .all(fromIso, toIso) as { supply_id: string; movement_type: string; qty: number | null; cost: number | null }[];
  for (const m of movements) {
    const bucket = buckets.get(m.supply_id);
    if (!bucket) continue;
    const qty = Math.abs(m.qty ?? 0);
    if (m.movement_type === 'recipe_depletion') bucket.depleted_qty += qty;
    else if (m.movement_type === 'recipe_restore') bucket.restored_qty += qty;
    else if (m.movement_type === 'waste') {
      bucket.waste_qty += qty;
      bucket.waste_cost += m.cost ?? 0;
    }
  }

  const fd = fractionDigits(db);
  return [...buckets.values()]
    .filter((b) => b.theoretical_qty > 0 || b.depleted_qty > 0 || b.waste_qty > 0)
    .map((b) => {
      const actualNet = b.depleted_qty - b.restored_qty;
      return {
        ...b,
        actual_net_qty: actualNet,
        waste_cost: roundCurrencyCost(new Decimal(b.waste_cost), fd),
        variance_qty: new Decimal(actualNet).minus(b.theoretical_qty).toNumber(),
      };
    });
}

/** Record the recipe's current computed cost into its change history. */
export function recordRecipeCostSnapshot(
  db: Db,
  recipeId: string,
  trigger: 'save' | 'supply_cost',
): void {
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return;
  db.prepare(
    `INSERT INTO recipe_cost_history (id, recipe_id, total_cost, unit_cost, cost_known, trigger, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomBytes(8).toString('hex'),
    recipeId,
    recipe.total_cost,
    recipe.unit_cost,
    recipe.cost_known ? 1 : 0,
    trigger,
    now(),
  );
}

/** After a supply's unit cost changes, refresh history for every recipe using it. */
export function touchRecipeCostHistoryForSupply(db: Db, supplyId: string): number {
  const rows = db
    .prepare(`SELECT DISTINCT recipe_id FROM recipe_items WHERE supply_id = ?`)
    .all(supplyId) as { recipe_id: string }[];
  for (const row of rows) recordRecipeCostSnapshot(db, row.recipe_id, 'supply_cost');
  return rows.length;
}

export function recipeCostHistory(db: Db, recipeId: string) {
  return db
    .prepare(
      `SELECT h.id, h.total_cost, h.unit_cost, h.cost_known, h.trigger, h.recorded_at
       FROM recipe_cost_history h WHERE h.recipe_id = ? ORDER BY h.recorded_at DESC, h.rowid DESC`,
    )
    .all(recipeId) as {
    id: string;
    total_cost: number | null;
    unit_cost: number | null;
    cost_known: number;
    trigger: string;
    recorded_at: string;
  }[];
}
