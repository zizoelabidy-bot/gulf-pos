/**
 * Aggregator integrations: migration 130 schema, credential encryption,
 * HMAC verification, webhook ingestion via a mock Talabat/Keeta simulator,
 * dedupe, item mapping fallback, auto-accept, status push logging.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/aggregators.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-aggregators-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron')
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' },
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'mock',
        encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
        decryptString: (value: Buffer) => value.toString().split('').reverse().join(''),
      } };
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase, MIGRATIONS } = require('../main/db');
const svc = require('../main/services/aggregators/service');
const { encryptConfigValue, decryptConfigValue } = require('../main/services/aggregators/crypto');
const { getAdapter } = require('../main/services/aggregators/adapters');
const { assertOrThrow, assertEqualOrThrow, getResults, resetCounters } = require('./helpers/test-setup');

const SECRET = 'sim-webhook-secret-123';

/** Mock platform simulator: builds a signed Talabat order-dispatch webhook. */
function talabatDispatch(orderCode: string, items: { sku: string; name: string; quantity: number; price: number }[]) {
  const payload = {
    order: {
      code: orderCode,
      currency: 'KWD',
      items: items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, price: i.price })),
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      customer: { name: 'Sim Customer', phone: '+96590000000' },
      comment: 'ring twice',
    },
  };
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  return { payload, headers: { webhookhmacauth: sig } };
}

function keetaOrder(orderId: string) {
  const payload = {
    order: {
      orderId,
      currency: 'KWD',
      items: [{ skuId: 'K-BRG-1', name: 'Keeta Burger', quantity: 1, price: 1.75 }],
      total: 1.75,
      remark: 'no onions',
    },
  };
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
  return { payload, headers: { 'x-keeta-signature': sig } };
}

resetCounters();
initDatabase();
const db = getDatabase();
db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('country', 'KW'), ('currency', 'KWD')");

// 1. Migration 130 is last and created the tables
const lastMigration = MIGRATIONS[MIGRATIONS.length - 1];
assertEqualOrThrow(lastMigration.version, 131, 'add_card_terminal_tap_smartpos is the last registered migration');
for (const table of ['aggregator_integrations', 'aggregator_events', 'aggregator_item_map']) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  assertOrThrow(!!row, `table ${table} exists`);
}
const seeded = db.prepare('SELECT COUNT(*) AS c FROM aggregator_integrations').get();
assertEqualOrThrow(seeded.c, 4, 'four platform rows seeded');

// 2. Credential encryption roundtrip; stored value never plaintext
const enc = encryptConfigValue('super-secret-value');
assertOrThrow(enc.startsWith('enc1.') && !enc.includes('super-secret-value'), 'encrypted value is opaque');
assertEqualOrThrow(decryptConfigValue(enc), 'super-secret-value', 'decrypt roundtrip');

// 3. Save config: secrets masked in views, status transitions
svc.saveConfig('talabat', { enabled: true, storeId: 'store-kw-01', webhookSecret: SECRET, autoAccept: true });
let views = svc.getConfigViews();
const talabatView = views.find((v: any) => v.platform === 'talabat');
assertEqualOrThrow(talabatView.status, 'configured', 'talabat status configured');
assertOrThrow(talabatView.hasWebhookSecret === true, 'view masks webhook secret presence only');
assertOrThrow(!('webhookSecret' in talabatView), 'view never returns secret value');
const stored = db.prepare('SELECT webhook_secret_enc FROM aggregator_integrations WHERE platform = ?').get('talabat');
assertOrThrow(stored.webhook_secret_enc.startsWith('enc1.'), 'secret encrypted at rest');

// 4. Incomplete config reports what is missing
svc.saveConfig('keeta', { enabled: true });
const keetaView = svc.getConfigViews().find((v: any) => v.platform === 'keeta');
assertEqualOrThrow(keetaView.status, 'incomplete', 'keeta incomplete without credentials');
assertOrThrow(!!keetaView.lastError, 'incomplete reason recorded');

// 5. Simulator: signed Talabat webhook ingests into a POS online order
const sim1 = talabatDispatch('TLB-100001', [
  { sku: 'sku-zaatar', name: 'Zaatar Manoushe', quantity: 2, price: 0.75 },
  { sku: 'sku-latte', name: 'Latte', quantity: 1, price: 1.25 },
]);
const r1 = svc.ingestWebhook('talabat', sim1.payload, sim1.headers);
assertOrThrow(r1.ok && !r1.duplicate, 'talabat order ingested');
assertOrThrow(!!r1.orderNumber, 'POS order number allocated');
assertOrThrow(r1.autoAccepted === false, 'unimplemented auto-accept never reports success');
const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(r1.orderId);
assertEqualOrThrow(order.type, 'online', 'order type online');
assertEqualOrThrow(order.online_platform, 'talabat', 'online_platform set');
assertEqualOrThrow(order.external_order_id, 'TLB-100001', 'external_order_id set');
assertEqualOrThrow(order.total, 2.75, 'order total from payload');
const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(r1.orderId);
assertEqualOrThrow(items.length, 2, 'two order items');
assertOrThrow(items[0].product_id === 'ext:talabat:sku-zaatar', 'unmapped item uses placeholder product id');

// Financial and signature regressions.
const keyRow = db.prepare("SELECT value FROM license_meta WHERE key = 'aggregator_secret'").get();
assertOrThrow(keyRow.value.startsWith('os1.'), 'key wrapped with OS storage adapter');
assertOrThrow(!svc.testConnection('talabat').ok, 'configuration is not live connectivity');
const pretty = talabatDispatch('TLB-PRETTY', [{ sku: 'a', name: 'A', quantity: 1, price: 1 }]);
const rawPretty = JSON.stringify(pretty.payload, null, 2);
const signedPretty = crypto.createHmac('sha256', SECRET).update(rawPretty).digest('hex');
assertOrThrow(svc.ingestWebhook('talabat', pretty.payload, { webhookhmacauth: signedPretty }, rawPretty).ok, 'original bytes accepted');
assertOrThrow(!svc.ingestWebhook('talabat', pretty.payload, { webhookhmacauth: signedPretty }).ok, 'reserialized bytes do not match signature');
for (const [id, quantity, price] of [['NEG', 1, -1], ['ZEROQ', 0, 1], ['FRACQ', 1.5, 1], ['BADPRICE', 1, '1xyz']]) {
  const badOrder = talabatDispatch(String(id), [{ sku: 'a', name: 'A', quantity: Number(quantity), price: price as number }]);
  assertOrThrow(!svc.ingestWebhook('talabat', badOrder.payload, badOrder.headers).ok, 'invalid order rejected: ' + id);
}
const broken = talabatDispatch('TLB-ROLLBACK', [{ sku: 'a', name: 'A', quantity: 1, price: 1 }, { sku: 'b', name: 'FAIL-ITEM', quantity: 1, price: 1 }]);
db.exec("CREATE TEMP TRIGGER fail_aggregator_item BEFORE INSERT ON order_items WHEN NEW.product_name = 'FAIL-ITEM' BEGIN SELECT RAISE(ABORT, 'forced item failure'); END");
let rolledBack = false;
try { svc.ingestWebhook('talabat', broken.payload, broken.headers); } catch { rolledBack = true; }
db.exec('DROP TRIGGER fail_aggregator_item');
assertOrThrow(rolledBack, 'forced item failure surfaced');
assertEqualOrThrow(db.prepare("SELECT COUNT(*) AS c FROM orders WHERE external_order_id = 'TLB-ROLLBACK'").get().c, 0, 'failed line rolls back entire order');

// 6. Dedupe: same external order id is not inserted twice
const r2 = svc.ingestWebhook('talabat', sim1.payload, sim1.headers);
assertOrThrow(r2.ok && r2.duplicate === true && r2.orderId === r1.orderId, 'duplicate webhook deduped');
const orderCount = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE external_order_id = 'TLB-100001'").get();
assertEqualOrThrow(orderCount.c, 1, 'still one order');

// 7. Bad signature rejected and logged
const bad = svc.ingestWebhook('talabat', sim1.payload, { webhookhmacauth: 'deadbeef' });
assertOrThrow(!bad.ok && bad.reason === 'signature', 'bad signature rejected');

// 8. Disabled platform rejects
svc.saveConfig('deliveroo', { enabled: false });
const disabled = svc.ingestWebhook('deliveroo', { order: { id: 'X', items: [{ name: 'A', quantity: 1, price: 1 }] } }, {});
assertOrThrow(!disabled.ok && disabled.reason === 'disabled', 'disabled platform rejects');

// 9. Item mapping: mapped sku resolves to real product id
svc.setItemMapEntry('talabat', 'sku-latte', 'prod-real-latte', 'Latte');
const sim2 = talabatDispatch('TLB-100002', [{ sku: 'sku-latte', name: 'Latte', quantity: 1, price: 1.25 }]);
const r3 = svc.ingestWebhook('talabat', sim2.payload, sim2.headers);
const mappedItem = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(r3.orderId);
assertEqualOrThrow(mappedItem.product_id, 'prod-real-latte', 'item map resolves product');

// 10. Keeta adapter ingest + readiness metadata
svc.saveConfig('keeta', { enabled: true, clientId: 'k-client', clientSecret: 'k-secret', storeId: 'keetaMerchant-7', webhookSecret: SECRET });
const k1 = keetaOrder('KEETA-555');
const r4 = svc.ingestWebhook('keeta', k1.payload, k1.headers);
assertOrThrow(r4.ok && !!r4.orderNumber, 'keeta order ingested');
const keetaAdapter = getAdapter('keeta');
assertEqualOrThrow(keetaAdapter.readiness, 'documented', 'keeta documented readiness');
const jahezAdapter = getAdapter('jahez');
assertEqualOrThrow(jahezAdapter.readiness, 'needs-partner', 'jahez marked needs-partner');

// 11. Status push logs the outbound payload (live delivery needs partner endpoints)
const pushed = svc.pushStatus('keeta', 'KEETA-555', 'ready');
assertOrThrow(pushed.delivered === false, 'status not delivered without partner endpoints');
assertOrThrow(String(pushed.payload.endpoint).includes('/v1/orders/KEETA-555/readyForPickup'), 'keeta ready endpoint shape');

// 12. Event log captures the flow
const events = svc.listEvents(50);
const kinds = events.map((e: any) => e.kind);
for (const expected of ['order_received', 'order_duplicate', 'signature_rejected', 'webhook_rejected_disabled', 'status_update']) {
  assertOrThrow(kinds.includes(expected), `event log includes ${expected}`);
}

closeDatabase();
const { passed, failed } = getResults();
console.log(`\nAggregators: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
