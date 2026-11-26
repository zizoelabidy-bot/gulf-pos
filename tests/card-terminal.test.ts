/**
 * Tap SmartPOS card terminal adapter (simulator + webhook hashstring).
 * Usage: node tests/run-electron-node-test.cjs tests/card-terminal.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-cardterm-'));
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
const { initDatabase, getDatabase, MIGRATIONS } = require('../main/db');
const svc = require('../main/services/tap-smartpos');
const { assertOrThrow, assertEqualOrThrow, getResults, resetCounters } = require('./helpers/test-setup');

async function rejects(fn: () => Promise<unknown> | unknown, code: number, label: string) {
  try { await fn(); } catch (e) {
    assertEqualOrThrow((e as any).statusCode, code, label);
    return;
  }
  throw new Error(label + ': expected an error');
}

(async () => {
  resetCounters();
  initDatabase();
  const db = getDatabase();
  assertEqualOrThrow(MIGRATIONS[MIGRATIONS.length - 1].version, 131, 'migration 131 is last');
  assertEqualOrThrow(svc.getConfigView().status, 'disabled', 'disabled by default');

  // KWD formatting + known-vector hashstring (formula from Tap docs).
  assertEqualOrThrow(svc.formatAmount(5.6), '5.600', 'KWD 3 decimals');
  assertEqualOrThrow(svc.formatAmount(5.6, 'SAR'), '5.60', 'SAR 2 decimals');
  const vec = { id: 'chg_1', amount: 1, currency: 'KWD', status: 'CAPTURED', reference: { gateway: 'g', payment: 'p' }, transaction: { created: '123' } };
  const { createHmac } = require('crypto');
  const expected = createHmac('sha256', 'sk_test').update('x_idchg_1x_amount1.000x_currencyKWDx_gateway_referencegx_payment_referencepx_statusCAPTUREDx_created123').digest('hex');
  assertEqualOrThrow(svc.computeHashstring(vec, 'sk_test'), expected, 'hashstring formula');

  // Disabled -> cannot create.
  await rejects(() => svc.createIntent({ amount: 5 }), 409, 'disabled rejects');

  // Simulator flow.
  svc.saveConfig({ enabled: true, mode: 'simulator' });
  await rejects(() => svc.createIntent({ amount: 0 }), 400, 'zero amount');
  await rejects(() => svc.createIntent({ amount: Infinity }), 400, 'infinite amount rejected');
  await rejects(() => svc.createIntent({ amount: 0.0001 }), 400, 'fractional fils rejected');
  const a = await svc.createIntent({ amount: 5.6, orderRef: 'ORD-1' });
  assertEqualOrThrow(a.status, 'INITIATED', 'intent initiated');
  assertEqualOrThrow(a.amount, 5.6, 'amount kept');
  await rejects(() => svc.createIntent({ amount: 1 }), 409, 'terminal busy');
  const r = svc.simulateResult(a.intent_id, 'CAPTURED');
  assertOrThrow(r.ok && r.status === 'CAPTURED', 'captured via signed webhook');
  const a2 = svc.getIntent(a.intent_id);
  assertOrThrow(!!a2.transaction_ref, 'transaction ref recorded');
  assertEqualOrThrow(svc.simulateResult(a.intent_id, 'DECLINED').reason, 'terminal_status_conflict', 'conflicting terminal result rejected');
  assertEqualOrThrow(svc.getIntent(a.intent_id).status, 'CAPTURED', 'status not overwritten');
  await rejects(() => svc.cancelIntent(a.intent_id), 409, 'cannot cancel captured');

  // Decline + cancel.
  const b = await svc.createIntent({ amount: 2 });
  assertEqualOrThrow(svc.simulateResult(b.intent_id, 'DECLINED').status, 'DECLINED', 'declined');
  const c = await svc.createIntent({ amount: 2 });
  assertEqualOrThrow((await svc.cancelIntent(c.intent_id)).status, 'CANCELLED', 'cancelled');

  // Forged webhook rejected.
  const d = await svc.createIntent({ amount: 3 });
  const forged = { id: d.intent_id, status: 'CAPTURED', amount: 3, currency: 'KWD', reference: {}, transaction: { created: '1' } };
  assertEqualOrThrow(svc.ingestWebhook(forged, { hashstring: 'deadbeef' }).reason, 'signature', 'bad hashstring rejected');
  assertEqualOrThrow(svc.ingestWebhook(forged, {}).reason, 'signature', 'missing hashstring rejected');
  assertEqualOrThrow(svc.getIntent(d.intent_id).status, 'INITIATED', 'forged webhook did not change state');
  await svc.cancelIntent(d.intent_id);

  // Signed amount/currency and intent identity mismatch must not capture a payment.
  svc.saveConfig({ secretKey: 'sim-test-key' });
  const e = await svc.createIntent({ amount: 4 });
  const signed = { id: e.intent_id, status: 'CAPTURED', amount: 5, currency: 'KWD', reference: { payment: 'p' }, transaction: { created: '1' } };
  const send = (body: any) => svc.ingestWebhook(body, { hashstring: svc.computeHashstring(body, 'sim-test-key') }, true);
  assertEqualOrThrow(send(signed).reason, 'amount_currency_mismatch', 'signed wrong amount rejected');
  assertEqualOrThrow(send({ ...signed, amount: 4, currency: 'SAR' }).reason, 'amount_currency_mismatch', 'signed wrong currency rejected');
  assertEqualOrThrow(send({ ...signed, id: 'other', intent_id: e.intent_id, amount: 4 }).reason, 'unknown_intent', 'unsigned intent reference ignored');
  assertEqualOrThrow(svc.getIntent(e.intent_id).status, 'INITIATED', 'bad results leave payment untouched');
  await svc.cancelIntent(e.intent_id);

  // Secret never exposed; stored encrypted; localhost URL refused; live needs config.
  svc.saveConfig({ secretKey: 'sk_live_SECRET123', merchantId: 'm1', terminalId: 't1' });
  const view = JSON.stringify(svc.getConfigView());
  assertOrThrow(!view.includes('SECRET123'), 'secret not in view');
  const raw = db.prepare('SELECT secret_key_enc FROM card_terminal_config').get().secret_key_enc;
  assertOrThrow(raw.startsWith('enc1.') && !raw.includes('SECRET123'), 'secret encrypted at rest');
  try { svc.saveConfig({ webhookBaseUrl: 'http://localhost:3000' }); throw new Error('no throw'); } catch (e) {
    assertOrThrow((e as Error).message.includes('localhost'), 'localhost refused');
  }
  svc.saveConfig({ mode: 'live' });
  await rejects(() => svc.createIntent({ amount: 1 }), 409, 'live without webhook url');
  svc.saveConfig({ webhookBaseUrl: 'https://example.com' });
  await rejects(() => svc.createIntent({ amount: 1 }), 409, 'uncertified live charge blocked even with config');
  await rejects(() => svc.simulateResult('x', 'CAPTURED'), 409, 'simulate blocked in live');

  const res = getResults();
  console.log(`card-terminal: ${res.passed} passed, ${res.failed} failed`);
  if (res.failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
