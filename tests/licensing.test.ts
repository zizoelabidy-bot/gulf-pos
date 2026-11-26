/**
 * Commercial licensing: trial lifecycle, signed key activation, device
 * binding, expiry/grace/read-only policy, deactivation + transfer receipt.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/licensing.test.ts
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gulf-licensing-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron')
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

// Throwaway issuer keypair for this test run.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
process.env.GULF_LICENSE_TEST = '1';
process.env.GULF_LICENSE_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' });

const { initDatabase, getDatabase, closeDatabase } = require('../main/db');
const {
  getLicenseState,
  activateLicense,
  deactivateLicense,
  deviceFingerprint,
  moduleEnabled,
  requireActiveLicense,
  TRIAL_DAYS,
  GRACE_DAYS,
} = require('../main/services/licensing');
const { assertOrThrow, assertEqualOrThrow, getResults, resetCounters } = require('./helpers/test-setup');

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signKey(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, privateKey);
  return `GPL1.${b64url(body)}.${b64url(sig)}`;
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lic_id: 'GL-TEST-1',
    customer: 'Test Cafe',
    type: 'annual',
    issued_at: new Date(Date.now() - 30 * 864e5).toISOString(),
    expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
    max_devices: 1,
    max_branches: 1,
    modules: ['*'],
    devices: [],
    ...overrides,
  };
}

resetCounters();
initDatabase();
const db = getDatabase();

// 1. Fresh install starts in trial.
let state = getLicenseState(db);
assertEqualOrThrow(state.status, 'trial', 'fresh install is trial');
assertEqualOrThrow(state.can_write, true, 'trial can write');
assertOrThrow(state.trial_ends_at, 'trial has an end date');

// 2. Garbage key rejected.
let threw = false;
try {
  activateLicense(db, 'not-a-key');
} catch (e: any) {
  threw = /format/.test(e.message);
}
assertOrThrow(threw, 'garbage key rejected');

// 3. Key signed by a different key rejected.
const other = crypto.generateKeyPairSync('ed25519');
const foreignBody = Buffer.from(JSON.stringify(basePayload()), 'utf8');
const foreignSig = crypto.sign(null, foreignBody, other.privateKey);
threw = false;
try {
  activateLicense(db, `GPL1.${b64url(foreignBody)}.${b64url(foreignSig)}`);
} catch (e: any) {
  threw = /signature/i.test(e.message);
}
assertOrThrow(threw, 'foreign signature rejected');

// 4. Valid annual key activates.
state = activateLicense(db, signKey(basePayload()));
assertEqualOrThrow(state.status, 'active', 'annual key activates');
assertEqualOrThrow(state.payload?.customer, 'Test Cafe', 'payload surfaced');
assertOrThrow(moduleEnabled(db, 'pos'), 'module * enables pos');

// 5. Device-bound key for another device rejected.
threw = false;
try {
  activateLicense(db, signKey(basePayload({ lic_id: 'GL-TEST-2', devices: ['deadbeef'.repeat(4)] })));
} catch (e: any) {
  threw = /bound/.test(e.message);
}
assertOrThrow(threw, 'key bound to another device rejected');

// 6. Device-bound key for THIS device activates.
state = activateLicense(
  db,
  signKey(basePayload({ lic_id: 'GL-TEST-3', devices: [deviceFingerprint(db)] })),
);
assertEqualOrThrow(state.status, 'active', 'device-bound key activates on the right device');

// Reject malformed signed claims and keep the previous valid activation.
for (const overrides of [
  { max_devices: 0 }, { max_branches: 1.5 }, { devices: ['invalid'] },
  { devices: [deviceFingerprint(db), 'deadbeef'.repeat(4)] },
  { modules: [] }, { expires_at: 'invalid-date' }, { expires_at: null },
  { issued_at: new Date(Date.now() + 864e5).toISOString() },
]) {
  let rejected = false;
  try { activateLicense(db, signKey(basePayload({ ...overrides, lic_id: 'INVALID' }))); }
  catch { rejected = true; }
  assertOrThrow(rejected, 'malformed signed claims rejected: ' + JSON.stringify(overrides));
}
assertEqualOrThrow(getLicenseState(db).payload?.lic_id, 'GL-TEST-3', 'invalid license does not replace active key');
const savedSalt = db.prepare("SELECT value FROM license_meta WHERE key = 'device_salt'").get().value;
db.prepare("UPDATE license_meta SET value = ? WHERE key = 'device_salt'").run('restored-to-another-device');
assertEqualOrThrow(getLicenseState(db).can_write, false, 'stored key binding checked on every status read');
db.prepare("UPDATE license_meta SET value = ? WHERE key = 'device_salt'").run(savedSalt);
assertEqualOrThrow(getLicenseState(db).can_write, true, 'original device remains valid');

// 7. Already-expired key (beyond grace) rejected.
threw = false;
try {
  activateLicense(
    db,
    signKey(
      basePayload({
        lic_id: 'GL-TEST-4',
        expires_at: new Date(Date.now() - (GRACE_DAYS + 5) * 864e5).toISOString(),
      }),
    ),
  );
} catch (e: any) {
  threw = /expired/.test(e.message);
}
assertOrThrow(threw, 'expired-beyond-grace key rejected');

// 8. Key inside grace period activates and reports grace.
state = activateLicense(
  db,
  signKey(basePayload({ lic_id: 'GL-TEST-5', expires_at: new Date(Date.now() - 864e5).toISOString() })),
);
assertEqualOrThrow(state.status, 'grace', 'recently expired key lands in grace');
assertEqualOrThrow(state.can_write, true, 'grace can still write');

// 9. Deactivate returns an unverified transfer claim and blocks local reuse.
const { transfer_receipt } = deactivateLicense(db);
assertOrThrow(/^GPLR1\./.test(transfer_receipt), 'transfer receipt issued');
state = getLicenseState(db);
assertEqualOrThrow(state.status, 'expired', 'deactivation does not restore trial access');
threw = false;
try { activateLicense(db, signKey(basePayload({ lic_id: 'GL-TEST-5' }))); } catch (e: any) { threw = /deactivated/.test(e.message); }
assertOrThrow(threw, 'deactivated license ID cannot be reused on this database');

// 10. Trial expiry flips to read-only and blocks sales writes.
// Remove activations in this isolated fixture only to exercise the fresh-install trial path.
db.prepare('DELETE FROM license_activations').run();
db.prepare("UPDATE license_meta SET value = ? WHERE key = 'trial_started_at'").run(
  new Date(Date.now() - (TRIAL_DAYS + 2) * 864e5).toISOString(),
);
state = getLicenseState(db);
assertEqualOrThrow(state.status, 'expired', 'trial older than 14 days is expired');
assertEqualOrThrow(state.can_write, false, 'expired blocks writes');
threw = false;
try {
  requireActiveLicense(db);
} catch (e: any) {
  threw = e.statusCode === 402;
}
assertOrThrow(threw, 'requireActiveLicense throws 402 when expired');

// 11. Perpetual key never expires.
state = activateLicense(db, signKey(basePayload({ lic_id: 'GL-TEST-6', type: 'perpetual', expires_at: null })));
assertEqualOrThrow(state.status, 'active', 'perpetual activates');
assertEqualOrThrow(state.payload?.expires_at, null, 'perpetual has no expiry');

closeDatabase();
console.log(getResults());
