/**
 * GULF POS commercial licensing service.
 *
 * License keys are Ed25519-signed JSON tokens issued by the separate
 * GULF CCTV License Admin app (admin-app/ in this repo). The private
 * signing key never ships with the client; only the public key below.
 *
 * Token format: GPL1.<base64url(payload-json)>.<base64url(signature)>
 * Payload: {
 *   lic_id, customer, type: 'perpetual'|'annual'|'trial',
 *   issued_at, expires_at: string|null,
 *   max_devices: number, max_branches: number,
 *   modules: string[] ('*' = all),
 *   devices: string[] (device fingerprints this key is bound to, [] = unbound)
 * }
 *
 * Expiry policy (per product directive): expired licenses never delete or
 * lock away data. Reports, exports and viewing stay available; new sales
 * are blocked after a grace period.
 */
import crypto from 'crypto';
import os from 'os';
import type Database from 'better-sqlite3';

// PRODUCTION public key. The matching private key is the GULF POS License
// Signing Key held in Zizo's Instinct vault (saved 2026-11-26); it never
// touches this repository or the client build. Rotation: generate a new
// keypair, store the new private key in the vault, replace this constant,
// and ship an update; old keys stay valid until they expire or are re-issued.
const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7lmcnKGiE+4WO4D5CKaNAc9w2z5QxXT2gP0BICAMFbQ=
-----END PUBLIC KEY-----`;

// Test-only override: honored solely when GULF_LICENSE_TEST=1, so the test
// suite can sign keys with a throwaway keypair. Never set in production.
function publicKeyPem(): string {
  if ((process as NodeJS.Process & { type?: string }).type !== 'browser' &&
      process.env.GULF_LICENSE_TEST === '1' && process.env.GULF_LICENSE_PUBLIC_KEY_PEM) {
    return process.env.GULF_LICENSE_PUBLIC_KEY_PEM;
  }
  return EMBEDDED_PUBLIC_KEY_PEM;
}

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export type LicenseType = 'perpetual' | 'annual' | 'trial';
export type LicenseStatus =
  | 'active' // signed license, within validity
  | 'trial' // built-in local trial, no key needed
  | 'grace' // expired but within grace period, writes still allowed
  | 'expired'; // read-only: reports/export allowed, new sales blocked

export interface LicensePayload {
  lic_id: string;
  customer: string;
  type: LicenseType;
  issued_at: string;
  expires_at: string | null;
  max_devices: number;
  max_branches: number;
  modules: string[];
  devices: string[];
}

export interface LicenseState {
  status: LicenseStatus;
  can_write: boolean;
  payload: LicensePayload | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  device_fingerprint: string;
  message: string | null;
}

export class LicenseError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function metaGet(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM license_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

function metaSet(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO license_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function deviceFingerprint(db: Database.Database): string {
  let salt = metaGet(db, 'device_salt');
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
    metaSet(db, 'device_salt', salt);
  }
  const basis = `${salt}|${os.hostname()}|${os.platform()}|${os.arch()}`;
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export function verifyToken(token: string): LicensePayload {
  if (typeof token !== 'string' || token.length > 32768) throw new LicenseError('Invalid license key format');
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'GPL1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    throw new LicenseError('Invalid license key format');
  }
  const payloadBytes = fromB64url(parts[1]);
  const signature = fromB64url(parts[2]);
  if (signature.length !== 64) throw new LicenseError('License key signature is invalid', 403);
  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new LicenseError('Invalid license key payload');
  }
  const ok = crypto.verify(null, payloadBytes, publicKeyPem(), signature);
  if (!ok) throw new LicenseError('License key signature is invalid', 403);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new LicenseError('Invalid license payload');
  for (const field of ['lic_id', 'customer', 'type', 'issued_at'] as const) {
    if (typeof payload[field] !== 'string' || !payload[field].trim() || payload[field].length > 256) {
      throw new LicenseError(`License key has invalid ${field}`);
    }
  }
  if (!['perpetual', 'annual', 'trial'].includes(payload.type)) {
    throw new LicenseError('License key has an unknown type');
  }
  const issued = Date.parse(payload.issued_at);
  if (!Number.isFinite(issued) || issued > Date.now() + 5 * 60_000) throw new LicenseError('Invalid license issue date');
  if (payload.type === 'perpetual' ? payload.expires_at !== null :
    typeof payload.expires_at !== 'string' || !Number.isFinite(Date.parse(payload.expires_at)) ||
    Date.parse(payload.expires_at) <= issued) throw new LicenseError('Invalid license expiry');
  if (![payload.max_devices, payload.max_branches].every(v => Number.isSafeInteger(v) && v > 0 && v <= 10000)) {
    throw new LicenseError('Invalid license limits');
  }
  if (!Array.isArray(payload.modules) || !payload.modules.length || payload.modules.length > 128 ||
      payload.modules.some(m => typeof m !== 'string' || !/^(?:\*|[a-z0-9_-]{1,64})$/.test(m))) {
    throw new LicenseError('Invalid license modules');
  }
  if (!Array.isArray(payload.devices) || payload.devices.length > payload.max_devices ||
      new Set(payload.devices).size !== payload.devices.length ||
      payload.devices.some(d => typeof d !== 'string' || !/^[a-f0-9]{32}$/.test(d))) {
    throw new LicenseError('Invalid license device bindings');
  }
  return payload;
}

function daysFrom(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function logEvent(
  db: Database.Database,
  kind: string,
  licId: string | null,
  detail: string | null,
): void {
  db.prepare(
    'INSERT INTO license_events (id, kind, lic_id, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), kind, licId, detail, new Date().toISOString());
}

function activeActivation(db: Database.Database): { token: string; payload: string } | null {
  const row = db
    .prepare(
      "SELECT token, payload FROM license_activations WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1",
    )
    .get() as { token: string; payload: string } | undefined;
  return row || null;
}

function ensureTrialStarted(db: Database.Database): string {
  let started = metaGet(db, 'trial_started_at');
  if (!started) {
    started = new Date().toISOString();
    metaSet(db, 'trial_started_at', started);
    logEvent(db, 'trial_started', null, null);
  }
  return started;
}

export function getLicenseState(db: Database.Database): LicenseState {
  const fp = deviceFingerprint(db);
  const now = new Date();
  const activation = activeActivation(db);
  if (activation) {
    let payload: LicensePayload;
    try {
      payload = verifyToken(activation.token);
      if (payload.devices.length && !payload.devices.includes(fp)) throw new LicenseError('License device mismatch');
    } catch {
      return {
        status: 'expired',
        can_write: false,
        payload: null,
        trial_ends_at: null,
        grace_ends_at: null,
        device_fingerprint: fp,
        message: 'Stored license key failed verification',
      };
    }
    if (payload.expires_at) {
      const expiry = new Date(payload.expires_at);
      const graceEnd = daysFrom(payload.expires_at, GRACE_DAYS);
      if (now > new Date(graceEnd)) {
        return {
          status: 'expired',
          can_write: false,
          payload,
          trial_ends_at: null,
          grace_ends_at: null,
          device_fingerprint: fp,
          message: 'License expired; reports and export remain available',
        };
      }
      if (now > expiry) {
        return {
          status: 'grace',
          can_write: true,
          payload,
          trial_ends_at: null,
          grace_ends_at: graceEnd,
          device_fingerprint: fp,
          message: `License expired; grace period ends ${graceEnd.slice(0, 10)}`,
        };
      }
    }
    return {
      status: 'active',
      can_write: true,
      payload,
      trial_ends_at: null,
      grace_ends_at: null,
      device_fingerprint: fp,
      message: null,
    };
  }
  // A previously deactivated paid installation does not get a fresh trial.
  if (db.prepare("SELECT 1 FROM license_activations WHERE status = 'deactivated' LIMIT 1").get()) {
    return { status: 'expired', can_write: false, payload: null, trial_ends_at: null,
      grace_ends_at: null, device_fingerprint: fp, message: 'License deactivated; activate a replacement key' };
  }
  // No activated key: built-in trial.
  const started = ensureTrialStarted(db);
  const trialEnd = daysFrom(started, TRIAL_DAYS);
  if (now <= new Date(trialEnd)) {
    return {
      status: 'trial',
      can_write: true,
      payload: null,
      trial_ends_at: trialEnd,
      grace_ends_at: null,
      device_fingerprint: fp,
      message: `Trial ends ${trialEnd.slice(0, 10)}`,
    };
  }
  return {
    status: 'expired',
    can_write: false,
    payload: null,
    trial_ends_at: trialEnd,
    grace_ends_at: null,
    device_fingerprint: fp,
    message: 'Trial ended; reports and export remain available. Activate a license key to continue selling.',
  };
}

export function activateLicense(db: Database.Database, token: string): LicenseState {
  const payload = verifyToken(token);
  const fp = deviceFingerprint(db);
  if (payload.devices.length > 0 && !payload.devices.includes(fp)) {
    logEvent(db, 'activate_rejected_device', payload.lic_id, `fingerprint ${fp} not bound`);
    throw new LicenseError(
      'This license key is bound to different device(s). Issue a transfer key from the GULF CCTV admin app.',
      403,
    );
  }
  if (db.prepare("SELECT 1 FROM license_activations WHERE lic_id = ? AND status = 'deactivated' LIMIT 1").get(payload.lic_id)) {
    throw new LicenseError('This license was deactivated on this installation; request a replacement key', 403);
  }
  if (payload.expires_at && new Date() > new Date(daysFrom(payload.expires_at, GRACE_DAYS))) {
    logEvent(db, 'activate_rejected_expired', payload.lic_id, null);
    throw new LicenseError('This license key has already expired');
  }
  const previous = activeActivation(db);
  db.transaction(() => {
    if (previous) {
      db.prepare(
        "UPDATE license_activations SET status = 'replaced', deactivated_at = ? WHERE status = 'active'",
      ).run(new Date().toISOString());
    }
    db.prepare(
      `INSERT INTO license_activations (id, lic_id, token, payload, device_fingerprint, status, activated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    ).run(
      crypto.randomUUID(),
      payload.lic_id,
      token,
      JSON.stringify(payload),
      fp,
      new Date().toISOString(),
    );
    logEvent(db, 'activated', payload.lic_id, `type=${payload.type} customer=${payload.customer}`);
  })();
  return getLicenseState(db);
}

export function deactivateLicense(db: Database.Database): { transfer_receipt: string } {
  const activation = activeActivation(db);
  if (!activation) throw new LicenseError('No active license to deactivate', 404);
  const payload = verifyToken(activation.token);
  const fp = deviceFingerprint(db);
  db.transaction(() => {
    db.prepare(
      "UPDATE license_activations SET status = 'deactivated', deactivated_at = ? WHERE status = 'active'",
    ).run(new Date().toISOString());
    logEvent(db, 'deactivated', payload.lic_id, null);
  })();
  // Offline transfer receipt is a local claim, NOT independently verifiable
  // revocation proof. The issuer must review it manually.
  let receiptKey = metaGet(db, 'receipt_key');
  if (!receiptKey) {
    receiptKey = crypto.randomBytes(32).toString('hex');
    metaSet(db, 'receipt_key', receiptKey);
  }
  const body = `${payload.lic_id}|${fp}|${new Date().toISOString()}`;
  const mac = crypto.createHmac('sha256', receiptKey).update(body).digest('hex');
  return { transfer_receipt: `GPLR1.${b64url(Buffer.from(body))}.${mac.slice(0, 24)}` };
}

export function moduleEnabled(db: Database.Database, module: string): boolean {
  const state = getLicenseState(db);
  if (!state.can_write) return false;
  if (state.status === 'trial') return true;
  if (!state.payload) return state.status !== 'expired';
  const mods = state.payload.modules;
  return mods.includes('*') || mods.includes(module);
}

export function requireActiveLicense(db: Database.Database): void {
  const state = getLicenseState(db);
  if (!state.can_write) {
    throw new LicenseError(state.message || 'License expired', 402);
  }
}
