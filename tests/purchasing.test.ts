/**
 * Purchasing & suppliers: schema, supplier CRUD, purchase order lifecycle,
 * receiving into the supplies ledger, payments, balances, KWD rounding.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/purchasing.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-purchasing-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron')
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase, MIGRATIONS } = require('../main/db');
const {
  saveSupplier,
  listSuppliers,
  createPurchaseOrder,
  getPurchaseOrder,
  setPurchaseOrderStatus,
  receivePurchaseOrderItems,
  recordSupplierPayment,
  supplierBalance,
  listSupplierPayments,
  PurchasingServiceError,
} = require('../main/services/purchasing');
const { createSupply, getSupply } = require('../main/services/supplies');
const {
  assertOrThrow,
  assertEqualOrThrow,
  getResults,
  resetCounters,
} = require('./helpers/test-setup');

function expectError(fn: () => unknown, statusCode: number, label: string) {
  try {
    fn();
  } catch (e) {
    const err = e as { statusCode?: number };
    assertOrThrow(err instanceof PurchasingServiceError, `${label}: wrong error type`);
    assertEqualOrThrow(err.statusCode, statusCode, `${label}: wrong status code`);
    return;
  }
  throw new Error(`${label}: expected an error but none was thrown`);
}

resetCounters();
initDatabase();
const db = getDatabase();

// 1. Schema.
const lastMigration = MIGRATIONS[MIGRATIONS.length - 1];
assertEqualOrThrow(lastMigration.version, 128, 'recipe cost history is the last registered migration');
const tables = (
  db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
).map((r) => r.name);
for (const t of ['suppliers', 'purchase_orders', 'purchase_order_items', 'supplier_payments', 'recipe_cost_history']) {
  assertOrThrow(tables.includes(t), `table ${t} exists after init`);
}

// 2. KWD tenant.
db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('country', 'KW', 'now')`).run();
db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('currency', 'KWD', 'now')`).run();

// 3. Actor user for supply movement FK.
db.prepare(
  `INSERT INTO users (id, name, email, password, role, is_active) VALUES ('u-owner', 'Owner', 'owner@test.local', 'x', 'owner', 1)`,
).run();

// 4. Supplier CRUD.
expectError(() => saveSupplier(db, { name: '' }), 400, 'supplier name required');
const supplier = saveSupplier(db, { name: 'شركة الخليج للمواد الغذائية', phone: '99998888' }) as { id: string };
assertEqualOrThrow(listSuppliers(db).length, 1, 'one active supplier');

// 5. Supply item to receive against.
const supply = createSupply(db, { name: 'أرز بسمتي', baseUnit: 'kg' }, 'u-owner') as { id: string };

// 6. PO lifecycle.
expectError(
  () => createPurchaseOrder(db, { supplier_id: supplier.id, items: [] }),
  400,
  'empty items rejected',
);
const po = createPurchaseOrder(db, {
  supplier_id: supplier.id,
  expected_date: '2026-12-01',
  items: [
    { supply_id: supply.id, description: 'أرز بسمتي', quantity: 10, unit_cost: 12.3456 },
    { description: 'أكياس تغليف', quantity: 100, unit_cost: 0.05 },
  ],
}) as { id: number; po_number: string; status: string; total: number };
assertEqualOrThrow(po.status, 'draft', 'PO starts as draft');
assertEqualOrThrow(po.total, 128.456, 'PO total rounds to KWD three decimals');
expectError(
  () => receivePurchaseOrderItems(db, po.id, { receipts: [{ item_id: 1, quantity: 1 }], actor_user_id: 'u-owner' }),
  409,
  'cannot receive a draft PO',
);
setPurchaseOrderStatus(db, po.id, 'sent');
expectError(() => setPurchaseOrderStatus(db, po.id, 'draft'), 409, 'no backward transition');

// 7. Receiving.
const detail = getPurchaseOrder(db, po.id) as { items: { id: number; supply_id: string | null }[] };
const riceLine = detail.items.find((i) => i.supply_id === supply.id)!;
const bagsLine = detail.items.find((i) => !i.supply_id)!;
expectError(
  () =>
    receivePurchaseOrderItems(db, po.id, {
      receipts: [{ item_id: riceLine.id, quantity: 11 }],
      actor_user_id: 'u-owner',
    }),
  409,
  'over-receiving rejected',
);
const afterPartial = receivePurchaseOrderItems(db, po.id, {
  receipts: [
    { item_id: riceLine.id, quantity: 6 },
    { item_id: bagsLine.id, quantity: 100 },
  ],
  actor_user_id: 'u-owner',
}) as { status: string };
assertEqualOrThrow(afterPartial.status, 'partially_received', 'partial receipt status');
const rice = getSupply(db, supply.id) as { stock_quantity: number };
assertEqualOrThrow(rice.stock_quantity, 6, 'stock increased by received quantity');
const movement = db
  .prepare(
    `SELECT * FROM supply_movements WHERE supply_id = ? AND reference_type = 'purchase_order' AND reference_id = ?`,
  )
  .get(supply.id, String(po.id)) as { quantity_delta: number; unit_cost: number } | undefined;
assertOrThrow(!!movement, 'supply movement recorded with PO reference');
assertEqualOrThrow(movement!.quantity_delta, 6, 'movement quantity matches receipt');
const afterFull = receivePurchaseOrderItems(db, po.id, {
  receipts: [{ item_id: riceLine.id, quantity: 4 }],
  actor_user_id: 'u-owner',
}) as { status: string };
assertEqualOrThrow(afterFull.status, 'received', 'fully received status');

// 8. Payments & balance.
recordSupplierPayment(db, {
  supplier_id: supplier.id,
  amount: 100,
  payment_date: '2026-11-25',
  method: 'knet',
});
expectError(
  () => recordSupplierPayment(db, { supplier_id: supplier.id, amount: 0, payment_date: '2026-11-25' }),
  400,
  'zero payment rejected',
);
const balance = supplierBalance(db, supplier.id) as {
  received_total: number;
  paid_total: number;
  balance: number;
};
assertEqualOrThrow(balance.received_total, 128.456, 'received total matches PO value');
assertEqualOrThrow(balance.paid_total, 100, 'paid total matches payments');
assertEqualOrThrow(balance.balance, 28.456, 'balance = received - paid at KWD precision');
assertEqualOrThrow(listSupplierPayments(db, supplier.id).length, 1, 'payment listed');

closeDatabase();
console.log('🧪 Purchasing & Suppliers Tests');
console.log(getResults());
