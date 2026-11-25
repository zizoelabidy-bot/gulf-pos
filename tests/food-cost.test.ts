/**
 * Food cost intelligence: item profitability (food cost %, margin),
 * theoretical vs actual consumption, waste cost, recipe cost history.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/food-cost.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-foodcost-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron')
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase } = require('../main/db');
const { createSupply, recordSupplyMovement } = require('../main/services/supplies');
const { saveRecipe, buildRecipeSnapshot, applyRecipeSnapshot } = require('../main/services/recipes');
const {
  itemProfitability,
  consumptionReport,
  recipeCostHistory,
  touchRecipeCostHistoryForSupply,
} = require('../main/services/food-cost');
const {
  assertOrThrow,
  assertEqualOrThrow,
  getResults,
  resetCounters,
} = require('./helpers/test-setup');

resetCounters();
initDatabase();
const db = getDatabase();

db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('currency', 'KWD', 'now')`).run();
db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('country', 'KW', 'now')`).run();
db.prepare(
  `INSERT INTO users (id, name, email, password, role, is_active) VALUES ('u-chef', 'Chef', 'chef@test.local', 'x', 'owner', 1)`,
).run();
db.prepare(
  `INSERT INTO categories (id, name, sort_order, is_active) VALUES ('cat-1', 'مشروبات', 1, 1)`,
).run();
db.prepare(
  `INSERT INTO products (id, name, price, category_id, is_active) VALUES ('p-latte', 'لاتيه', 1.500, 'cat-1', 1)`,
).run();

// Supplies with known costs.
const milk = createSupply(db, { name: 'حليب', baseUnit: 'ml' }, 'u-chef') as { id: string };
recordSupplyMovement(db, {
  supplyId: milk.id, movementType: 'receive', quantity: 1000, unit: 'ml',
  totalCost: 0.300, reason: 'opening', actorUserId: 'u-chef',
});
const coffee = createSupply(db, { name: 'بن', baseUnit: 'g' }, 'u-chef') as { id: string };
recordSupplyMovement(db, {
  supplyId: coffee.id, movementType: 'receive', quantity: 500, unit: 'g',
  totalCost: 2.000, reason: 'opening', actorUserId: 'u-chef',
});

// 1. Recipe save records cost history.
const recipe = saveRecipe(db, {
  productId: 'p-latte',
  yieldQuantity: 1,
  items: [
    { supplyId: milk.id, quantity: 200, unit: 'ml' },
    { supplyId: coffee.id, quantity: 18, unit: 'g' },
  ],
}) as { id: string; cost_known: boolean; unit_cost: number };
assertOrThrow(recipe.cost_known, 'recipe cost known after receives');
// 200ml @ 0.0003/ml = 0.06 ; 18g @ 0.004/g = 0.072 ; total 0.132
assertEqualOrThrow(recipe.unit_cost, 0.132, 'unit cost computed from supply costs');
let history = recipeCostHistory(db, recipe.id) as { trigger: string; unit_cost: number }[];
assertEqualOrThrow(history.length, 1, 'one history row after save');
assertEqualOrThrow(history[0].trigger, 'save', 'history trigger is save');

// 2. Supply cost change refreshes history via the hook.
recordSupplyMovement(db, {
  supplyId: milk.id, movementType: 'receive', quantity: 1000, unit: 'ml',
  totalCost: 0.500, reason: 'price up', actorUserId: 'u-chef',
});
const touched = touchRecipeCostHistoryForSupply(db, milk.id) as number;
assertEqualOrThrow(touched, 1, 'one recipe touched by milk cost change');
history = recipeCostHistory(db, recipe.id) as { trigger: string; unit_cost: number }[];
assertEqualOrThrow(history.length, 2, 'second history row after supply cost change');
assertEqualOrThrow(history[0].trigger, 'supply_cost', 'newest history row is supply_cost trigger');

// 3. Item profitability: food cost % and margin.
const items = itemProfitability(db) as {
  product_id: string; price: number; unit_cost: number; margin: number; food_cost_pct: number;
}[];
const latte = items.find((i) => i.product_id === 'p-latte')!;
const expectedUnit = history[0].unit_cost;
assertEqualOrThrow(latte.unit_cost, expectedUnit, 'profitability uses latest cost');
assertEqualOrThrow(latte.margin, Math.round((1.5 - expectedUnit) * 1000) / 1000, 'margin = price - cost');
assertOrThrow(latte.food_cost_pct > 0 && latte.food_cost_pct < 100, 'food cost pct in range');

// 4. Theoretical vs actual: deplete via snapshot for 3 lattes, waste 50ml milk.
const snapshot = buildRecipeSnapshot(db, 'p-latte', 3);
applyRecipeSnapshot(db, snapshot, { direction: 'deplete', actorUserId: 'u-chef', referenceId: 1 });
recordSupplyMovement(db, {
  supplyId: milk.id, movementType: 'waste', quantity: 50, unit: 'ml',
  reason: 'spoiled', actorUserId: 'u-chef',
});
// fake a sold order line carrying the snapshot so theoretical side has data
db.prepare(
  `INSERT INTO orders (order_number, status, type, subtotal, total, created_at)
   VALUES ('1001', 'completed', 'dine_in', 4.5, 4.5, '2026-11-25T10:00:00')`,
).run();
db.prepare(
  `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal, total, status, recipe_snapshot)
   VALUES (1, 'p-latte', 'لاتيه', 3, 1.5, 4.5, 4.5, 'served', ?)`,
).run(JSON.stringify(snapshot));

const report = consumptionReport(db, '2026-11-25T00:00:00', '2026-11-26T00:00:00') as {
  supply_id: string; theoretical_qty: number; actual_net_qty: number; waste_qty: number; variance_qty: number;
}[];
const milkRow = report.find((r) => r.supply_id === milk.id)!;
assertEqualOrThrow(milkRow.theoretical_qty, 600, 'theoretical milk = 3 x 200ml');
assertEqualOrThrow(milkRow.actual_net_qty, 600, 'actual depletion matches');
assertEqualOrThrow(milkRow.waste_qty, 50, 'waste recorded separately');
assertEqualOrThrow(milkRow.variance_qty, 0, 'no variance when actual matches theoretical');
const coffeeRow = report.find((r) => r.supply_id === coffee.id)!;
assertEqualOrThrow(coffeeRow.theoretical_qty, 54, 'theoretical coffee = 3 x 18g');

closeDatabase();
console.log('🧪 Food Cost Tests');
console.log(getResults());
