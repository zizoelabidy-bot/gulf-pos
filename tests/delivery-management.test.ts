/**
 * Delivery management: schema, zone/driver CRUD, assignment workflow guards,
 * KWD rounding, and driver cash settlement.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/delivery-management.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-delivery-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron')
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase, MIGRATIONS } = require('../main/db');
const {
  listDeliveryZones,
  saveDeliveryZone,
  listDeliveryDrivers,
  saveDeliveryDriver,
  assignDeliveryOrder,
  updateDeliveryAssignmentStatus,
  driverCashSummary,
  settleDriverCash,
  listDeliverySettlements,
  DeliveryServiceError,
} = require('../main/services/delivery');
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
    assertOrThrow(err instanceof DeliveryServiceError, `${label}: wrong error type`);
    assertEqualOrThrow(err.statusCode, statusCode, `${label}: wrong status code`);
    return;
  }
  throw new Error(`${label}: expected an error but none was thrown`);
}

resetCounters();

initDatabase();
const db = getDatabase();

// 1. Migration registered and tables created.
const lastMigration = MIGRATIONS[MIGRATIONS.length - 1];
assertEqualOrThrow(lastMigration.version, 129, 'add_licensing is the last registered migration');
const tables = (
  db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
).map((r) => r.name);
for (const t of ['delivery_zones', 'delivery_drivers', 'delivery_assignments', 'delivery_settlements']) {
  assertOrThrow(tables.includes(t), `table ${t} exists after init`);
}

// 2. KWD: three fraction digits drive fee rounding.
db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('country', 'KW', 'now')`).run();
db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('currency', 'KWD', 'now')`).run();

// 3. Zone CRUD + validation.
expectError(() => saveDeliveryZone(db, { name_ar: '', fee: 1 }), 400, 'zone name required');
const zone = saveDeliveryZone(db, { name_ar: 'حولي', name_en: 'Hawally', fee: 1.2345 }) as {
  id: string;
  fee: number;
};
assertEqualOrThrow(zone.fee, 1.235, 'zone fee rounds to KWD three decimals');
assertEqualOrThrow(listDeliveryZones(db).length, 1, 'one active zone listed');
saveDeliveryZone(db, { id: zone.id, name_ar: 'حولي', fee: 0.5, active: false });
assertEqualOrThrow(listDeliveryZones(db).length, 0, 'inactive zone hidden by default');
assertEqualOrThrow(listDeliveryZones(db, true).length, 1, 'inactive zone listed with includeInactive');
saveDeliveryZone(db, { id: zone.id, name_ar: 'حولي', fee: 0.5, active: true });

// 4. Driver CRUD.
expectError(() => saveDeliveryDriver(db, { name: ' ' }), 400, 'driver name required');
const driver = saveDeliveryDriver(db, { name: 'أبو محمد', phone: '67766846' }) as { id: string };
assertEqualOrThrow(listDeliveryDrivers(db).length, 1, 'one active driver listed');

// 5. Orders: one delivery order, one takeaway order.
db.prepare(`INSERT INTO orders (order_number, type, total) VALUES ('DLV-1', 'delivery', 5.5)`).run();
db.prepare(`INSERT INTO orders (order_number, type, total) VALUES ('TKA-1', 'takeaway', 3)`).run();
const dlv = db.prepare(`SELECT id FROM orders WHERE order_number = 'DLV-1'`).get() as { id: number };
const tka = db.prepare(`SELECT id FROM orders WHERE order_number = 'TKA-1'`).get() as { id: number };

// 6. Assignment guards.
expectError(
  () => assignDeliveryOrder(db, { order_id: tka.id, driver_id: driver.id }),
  400,
  'takeaway order cannot be assigned',
);
expectError(
  () => assignDeliveryOrder(db, { order_id: dlv.id, driver_id: 'drv_missing' }),
  404,
  'unknown driver rejected',
);
const assignment = assignDeliveryOrder(db, {
  order_number: 'DLV-1',
  driver_id: driver.id,
  zone_id: zone.id,
  assigned_by: 'owner',
}) as { id: number; cod_amount: number; status: string };
assertEqualOrThrow(assignment.cod_amount, 5.5, 'COD defaults to the order total');
assertEqualOrThrow(assignment.status, 'assigned', 'assignment starts as assigned');
expectError(
  () => assignDeliveryOrder(db, { order_id: dlv.id, driver_id: driver.id }),
  409,
  'second open assignment on the same order rejected',
);

// 7. Status workflow.
expectError(
  () => updateDeliveryAssignmentStatus(db, assignment.id, { status: 'delivered', collected_amount: 5.5 }),
  409,
  'cannot deliver before going out for delivery',
);
updateDeliveryAssignmentStatus(db, assignment.id, { status: 'out_for_delivery' });
const done = updateDeliveryAssignmentStatus(db, assignment.id, {
  status: 'delivered',
  collected_amount: 5.5,
}) as { status: string; collected_amount: number; delivered_at: string };
assertEqualOrThrow(done.status, 'delivered', 'assignment delivered');
assertEqualOrThrow(done.collected_amount, 5.5, 'collected amount recorded');
assertOrThrow(!!done.delivered_at, 'delivered_at stamped');
expectError(
  () => updateDeliveryAssignmentStatus(db, assignment.id, { status: 'cancelled' }),
  409,
  'delivered assignment is final',
);

// 8. Settlement.
const today = new Date().toISOString().slice(0, 10);
const summary = driverCashSummary(db, driver.id, today);
assertEqualOrThrow(summary.expected_cash, 5.5, 'expected cash matches delivered COD');
assertEqualOrThrow(summary.delivered_count, 1, 'one delivered order in summary');
const settlement = settleDriverCash(db, {
  driver_id: driver.id,
  business_date: today,
  settled_by: 'owner',
}) as { id: number; difference: number };
assertEqualOrThrow(settlement.difference, 0, 'no cash difference when fully collected');
const linked = db
  .prepare('SELECT settlement_id FROM delivery_assignments WHERE id = ?')
  .get(assignment.id) as { settlement_id: number };
assertEqualOrThrow(linked.settlement_id, settlement.id, 'assignment linked to settlement');
expectError(
  () => settleDriverCash(db, { driver_id: driver.id, business_date: today }),
  409,
  'double settlement rejected',
);
assertEqualOrThrow(listDeliverySettlements(db).length, 1, 'settlement listed');
expectError(
  () => updateDeliveryAssignmentStatus(db, assignment.id, { status: 'returned' }),
  409,
  'settled assignment cannot change status',
);

closeDatabase();
console.log('🧪 Delivery Management Tests');
console.log(getResults());
