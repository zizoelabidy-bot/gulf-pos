/**
 * Purchasing & suppliers: supplier records, purchase orders, goods receiving
 * into the supplies ledger, supplier payments, and running balances.
 *
 * Money is major-unit REAL rounded to the tenant currency's fraction digits
 * (3 for KWD) with Decimal half-up. Stock effects go through the supplies
 * movement ledger with reference_type 'purchase_order'.
 */
import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import { getDatabase, now, withTxn } from '../db';
import { getCurrencyFractionDigits } from '../countries';
import { getTenantCurrency } from './refund';
import { recordSupplyMovementInTxn } from './supplies';
import { touchRecipeCostHistoryForSupply } from './food-cost';

export class PurchasingServiceError extends Error {
  statusCode: number;
  diagnosticCode?: string;
  constructor(statusCode: number, message: string, diagnosticCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.diagnosticCode = diagnosticCode;
  }
}

type Db = ReturnType<typeof getDatabase>;

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

function roundMoney(db: Db, value: number | Decimal): number {
  let digits = 2;
  try {
    digits = getCurrencyFractionDigits(getTenantCurrency(db));
  } catch {
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'currency'")
        .get() as { value?: string | null } | undefined;
      digits = getCurrencyFractionDigits(row?.value || '');
    } catch {
      digits = 2;
    }
  }
  const rounded = new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toNumber();
  return Object.is(rounded, -0) ? 0 : rounded;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function cleanText(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new PurchasingServiceError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new PurchasingServiceError(400, `${field} exceeds ${max} characters`);
  return trimmed;
}

function cleanAmount(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1_000_000_000) {
    throw new PurchasingServiceError(400, `${field} must be a number between 0 and 1000000000`);
  }
  return num;
}

function cleanQuantity(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) {
    throw new PurchasingServiceError(400, `${field} must be a number greater than 0`);
  }
  return num;
}

// ── Suppliers ───────────────────────────────────────────────────────────────

export function listSuppliers(db: Db, includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM suppliers ORDER BY name COLLATE NOCASE, id'
    : 'SELECT * FROM suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE, id';
  return db.prepare(sql).all();
}

export function saveSupplier(
  db: Db,
  input: {
    id?: string;
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    address?: unknown;
    notes?: unknown;
    active?: unknown;
  },
) {
  const name = cleanText(input.name, 160, 'name');
  if (!name) throw new PurchasingServiceError(400, 'supplier name is required');
  const phone = cleanText(input.phone, 40, 'phone');
  const email = cleanText(input.email, 160, 'email');
  const address = cleanText(input.address, 300, 'address');
  const notes = cleanText(input.notes, 500, 'notes');
  const ts = now();
  if (input.id) {
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.id);
    if (!existing) throw new PurchasingServiceError(404, 'supplier not found');
    const active = input.active === undefined ? undefined : input.active ? 1 : 0;
    if (active === undefined) {
      db.prepare(
        'UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?',
      ).run(name, phone, email, address, notes, ts, input.id);
    } else {
      db.prepare(
        'UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      ).run(name, phone, email, address, notes, active, ts, input.id);
    }
    return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(input.id);
  }
  const id = newId('spl');
  db.prepare(
    'INSERT INTO suppliers (id, name, phone, email, address, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
  ).run(id, name, phone, email, address, notes, ts, ts);
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

// ── Purchase orders ─────────────────────────────────────────────────────────

function nextPoNumber(db: Db): string {
  const row = db
    .prepare("SELECT po_number FROM purchase_orders ORDER BY id DESC LIMIT 1")
    .get() as { po_number?: string } | undefined;
  const match = row?.po_number?.match(/(\d+)\s*$/);
  const next = match ? Number(match[1]) + 1 : 1;
  return `PO-${String(next).padStart(4, '0')}`;
}

export function createPurchaseOrder(
  db: Db,
  input: {
    supplier_id?: unknown;
    expected_date?: unknown;
    notes?: unknown;
    created_by?: string | null;
    items?: unknown;
  },
) {
  const supplierId = cleanText(input.supplier_id, 80, 'supplier_id');
  if (!supplierId) throw new PurchasingServiceError(400, 'supplier_id is required');
  const expectedDate = cleanText(input.expected_date, 10, 'expected_date');
  if (expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    throw new PurchasingServiceError(400, 'expected_date must be YYYY-MM-DD');
  }
  const notes = cleanText(input.notes, 500, 'notes');
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 200) {
    throw new PurchasingServiceError(400, 'items must be an array of 1 to 200 lines');
  }
  const items = input.items.map((raw, idx) => {
    const line = raw as Record<string, unknown>;
    const description = cleanText(line.description, 200, `items[${idx}].description`);
    const supplyId = cleanText(line.supply_id, 80, `items[${idx}].supply_id`);
    if (!description && !supplyId) {
      throw new PurchasingServiceError(400, `items[${idx}] needs a description or a supply`);
    }
    return {
      supply_id: supplyId,
      description: description ?? '',
      quantity: cleanQuantity(line.quantity, `items[${idx}].quantity`),
      unit: cleanText(line.unit, 10, `items[${idx}].unit`),
      unit_cost: cleanAmount(line.unit_cost ?? 0, `items[${idx}].unit_cost`),
    };
  });

  return withTxn(() => {
    const supplier = db.prepare('SELECT id, active FROM suppliers WHERE id = ?').get(supplierId) as
      | { id: string; active: number }
      | undefined;
    if (!supplier) throw new PurchasingServiceError(404, 'supplier not found');
    if (!supplier.active) throw new PurchasingServiceError(400, 'supplier is inactive');
    for (const line of items) {
      if (line.supply_id) {
        const supply = db
          .prepare('SELECT id, base_unit FROM supplies WHERE id = ? AND deleted_at IS NULL')
          .get(line.supply_id) as { id: string; base_unit: string } | undefined;
        if (!supply) throw new PurchasingServiceError(404, `supply not found: ${line.supply_id}`);
        if (!line.description) line.description = line.supply_id;
        if (!line.unit) line.unit = supply.base_unit;
      }
    }
    const total = roundMoney(
      db,
      items.reduce((acc, l) => acc.plus(new Decimal(l.quantity).times(l.unit_cost)), new Decimal(0)),
    );
    const ts = now();
    const poNumber = nextPoNumber(db);
    const result = db
      .prepare(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, notes, total, created_by, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      )
      .run(poNumber, supplierId, expectedDate, notes, total, input.created_by ?? null, ts, ts);
    const poId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO purchase_order_items (po_id, supply_id, description, quantity, unit, unit_cost) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const line of items) {
      insertItem.run(poId, line.supply_id, line.description, line.quantity, line.unit, line.unit_cost);
    }
    return getPurchaseOrder(db, poId);
  });
}

export function getPurchaseOrder(db: Db, poId: number) {
  const po = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchase_orders p
       LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
    )
    .get(poId);
  if (!po) throw new PurchasingServiceError(404, 'purchase order not found');
  const items = db
    .prepare(
      `SELECT i.*, sp.name AS supply_name FROM purchase_order_items i
       LEFT JOIN supplies sp ON sp.id = i.supply_id WHERE i.po_id = ? ORDER BY i.id`,
    )
    .all(poId);
  return { ...(po as object), items };
}

export function listPurchaseOrders(db: Db, filter: { status?: string; supplier_id?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push('p.status = ?');
    args.push(filter.status);
  }
  if (filter.supplier_id) {
    where.push('p.supplier_id = ?');
    args.push(filter.supplier_id);
  }
  return db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchase_orders p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.id DESC LIMIT 200`,
    )
    .all(...args);
}

const PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['cancelled'],
  partially_received: ['cancelled'],
  received: [],
  cancelled: [],
};

export function setPurchaseOrderStatus(db: Db, poId: number, next: unknown) {
  const status = next as PurchaseOrderStatus;
  if (!['draft', 'sent', 'partially_received', 'received', 'cancelled'].includes(status)) {
    throw new PurchasingServiceError(400, 'invalid status');
  }
  const po = db.prepare('SELECT id, status FROM purchase_orders WHERE id = ?').get(poId) as
    | { id: number; status: PurchaseOrderStatus }
    | undefined;
  if (!po) throw new PurchasingServiceError(404, 'purchase order not found');
  if (status === 'received' || status === 'partially_received') {
    throw new PurchasingServiceError(400, 'receipt status is set by receiving items, not directly');
  }
  if (!PO_TRANSITIONS[po.status].includes(status)) {
    throw new PurchasingServiceError(409, `cannot move from ${po.status} to ${status}`, 'invalid_transition');
  }
  db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), poId);
  return getPurchaseOrder(db, poId);
}

export function receivePurchaseOrderItems(
  db: Db,
  poId: number,
  input: { receipts?: unknown; actor_user_id?: string | null },
) {
  if (!Array.isArray(input.receipts) || input.receipts.length === 0) {
    throw new PurchasingServiceError(400, 'receipts must be a non-empty array');
  }
  const receipts = input.receipts.map((raw) => {
    const line = raw as Record<string, unknown>;
    const itemId = Number(line.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new PurchasingServiceError(400, 'receipts[].item_id must be a positive integer');
    }
    return { item_id: itemId, quantity: cleanQuantity(line.quantity, 'receipts[].quantity') };
  });
  if (!input.actor_user_id) throw new PurchasingServiceError(400, 'actor_user_id is required');

  return withTxn(() => {
    const po = db.prepare('SELECT id, status, po_number FROM purchase_orders WHERE id = ?').get(poId) as
      | { id: number; status: PurchaseOrderStatus; po_number: string }
      | undefined;
    if (!po) throw new PurchasingServiceError(404, 'purchase order not found');
    if (po.status === 'draft') throw new PurchasingServiceError(409, 'send the order before receiving', 'po_not_sent');
    if (po.status === 'received' || po.status === 'cancelled') {
      throw new PurchasingServiceError(409, `cannot receive against a ${po.status} order`, 'invalid_transition');
    }
    for (const r of receipts) {
      const item = db
        .prepare('SELECT * FROM purchase_order_items WHERE id = ? AND po_id = ?')
        .get(r.item_id, poId) as
        | { id: number; supply_id: string | null; quantity: number; received_quantity: number; unit_cost: number; unit: string | null; description: string }
        | undefined;
      if (!item) throw new PurchasingServiceError(404, `order line ${r.item_id} not found`);
      const remaining = new Decimal(item.quantity).minus(item.received_quantity);
      if (new Decimal(r.quantity).greaterThan(remaining)) {
        throw new PurchasingServiceError(
          409,
          `line ${r.item_id}: receiving ${r.quantity} exceeds remaining ${remaining.toNumber()}`,
          'over_receive',
        );
      }
      if (item.supply_id) {
        recordSupplyMovementInTxn(db, {
          supplyId: item.supply_id,
          movementType: 'receive',
          quantity: r.quantity,
          unit: item.unit ?? undefined,
          unitCost: item.unit_cost,
          reason: `Purchase order ${po.po_number}`,
          actorUserId: input.actor_user_id as string,
          referenceType: 'purchase_order',
          referenceId: poId,
        });
      }
      db.prepare(
        'UPDATE purchase_order_items SET received_quantity = received_quantity + ? WHERE id = ?',
      ).run(r.quantity, r.item_id);
      if (item.supply_id) {
        try {
          touchRecipeCostHistoryForSupply(db, item.supply_id);
        } catch {
          // cost history is audit metadata; never fail a goods receipt on it
        }
      }
    }
    const totals = db
      .prepare(
        'SELECT SUM(quantity) AS q, SUM(received_quantity) AS r FROM purchase_order_items WHERE po_id = ?',
      )
      .get(poId) as { q: number; r: number };
    const status: PurchaseOrderStatus = new Decimal(totals.r).greaterThanOrEqualTo(totals.q)
      ? 'received'
      : 'partially_received';
    db.prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), poId);
    return getPurchaseOrder(db, poId);
  });
}

// ── Payments & balances ─────────────────────────────────────────────────────

export function recordSupplierPayment(
  db: Db,
  input: {
    supplier_id?: unknown;
    amount?: unknown;
    payment_date?: unknown;
    method?: unknown;
    reference?: unknown;
    notes?: unknown;
    created_by?: string | null;
  },
) {
  const supplierId = cleanText(input.supplier_id, 80, 'supplier_id');
  if (!supplierId) throw new PurchasingServiceError(400, 'supplier_id is required');
  const amount = roundMoney(db, cleanAmount(input.amount, 'amount'));
  if (amount <= 0) throw new PurchasingServiceError(400, 'amount must be greater than 0');
  const paymentDate = cleanText(input.payment_date, 10, 'payment_date');
  if (!paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new PurchasingServiceError(400, 'payment_date must be YYYY-MM-DD');
  }
  const method = cleanText(input.method, 40, 'method');
  const reference = cleanText(input.reference, 120, 'reference');
  const notes = cleanText(input.notes, 500, 'notes');
  const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId);
  if (!supplier) throw new PurchasingServiceError(404, 'supplier not found');
  const result = db
    .prepare(
      `INSERT INTO supplier_payments (supplier_id, amount, payment_date, method, reference, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(supplierId, amount, paymentDate, method, reference, notes, input.created_by ?? null, now());
  return db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(Number(result.lastInsertRowid));
}

export function listSupplierPayments(db: Db, supplierId?: string) {
  if (supplierId) {
    return db
      .prepare(
        `SELECT p.*, s.name AS supplier_name FROM supplier_payments p
         LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.supplier_id = ?
         ORDER BY p.payment_date DESC, p.id DESC LIMIT 200`,
      )
      .all(supplierId);
  }
  return db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM supplier_payments p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.payment_date DESC, p.id DESC LIMIT 200`,
    )
    .all();
}

export function supplierBalance(db: Db, supplierId: string) {
  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new PurchasingServiceError(404, 'supplier not found');
  const received = db
    .prepare(
      `SELECT COALESCE(SUM(i.received_quantity * i.unit_cost), 0) AS v
       FROM purchase_order_items i
       JOIN purchase_orders p ON p.id = i.po_id
       WHERE p.supplier_id = ? AND p.status != 'cancelled'`,
    )
    .get(supplierId) as { v: number };
  const paid = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM supplier_payments WHERE supplier_id = ?')
    .get(supplierId) as { v: number };
  const receivedTotal = roundMoney(db, received.v);
  const paidTotal = roundMoney(db, paid.v);
  return {
    supplier_id: supplierId,
    supplier_name: supplier.name,
    received_total: receivedTotal,
    paid_total: paidTotal,
    balance: roundMoney(db, new Decimal(receivedTotal).minus(paidTotal)),
  };
}
