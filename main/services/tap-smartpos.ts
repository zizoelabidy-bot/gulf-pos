/**
 * GULF POS - Tap Payments SmartPOS (card terminal: KNET / Visa / Mastercard) adapter.
 *
 * Modes:
 *  - simulator: no network. Intents are created locally and results are produced by
 *    simulateResult(), which signs a webhook with the stored secret and feeds it through
 *    the same ingestWebhook() path the live mode uses (so hashstring checking is exercised).
 *  - live: new charges blocked pending merchant-certified contract and reconciliation.
 *
 * Secrets are encrypted at rest (same AES-GCM helper as the delivery integrations) and
 * are never returned by the API.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { getDatabase } from '../db';
import { encryptConfigValue, decryptConfigValue } from './aggregators/crypto';

export const TAP_API_BASE = 'https://api.tap.company/v2';
export type TerminalMode = 'simulator' | 'live';
export type IntentStatus = 'INITIATED' | 'CAPTURED' | 'DECLINED' | 'CANCELLED' | 'FAILED';

export class CardTerminalError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'CardTerminalError';
  }
}

/** KWD has 3 decimals; Tap expects the amount rounded to the currency's standard decimals. */
export function formatAmount(n: number, currency = 'KWD'): string {
  const dec = ['KWD', 'BHD', 'OMR', 'JOD'].includes(currency) ? 3 : 2;
  return (Math.round(n * 10 ** dec) / 10 ** dec).toFixed(dec);
}

/** Hashstring per Tap docs (developers.tap.company/docs/webhook): HMAC-SHA256 with the secret key. */
export function computeHashstring(body: any, secretKey: string): string {
  const toHash =
    'x_id' + (body?.id ?? '') +
    'x_amount' + formatAmount(Number(body?.amount ?? 0), body?.currency || 'KWD') +
    'x_currency' + (body?.currency ?? '') +
    'x_gateway_reference' + (body?.reference?.gateway ?? '') +
    'x_payment_reference' + (body?.reference?.payment ?? '') +
    'x_status' + (body?.status ?? '') +
    'x_created' + (body?.transaction?.created ?? '');
  return createHmac('sha256', secretKey).update(toHash, 'utf8').digest('hex');
}

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

interface CfgRow {
  enabled: number; mode: string; merchant_id: string | null; terminal_id: string | null;
  secret_key_enc: string | null; webhook_base_url: string | null; last_error: string | null; updated_at: string;
}
const cfgRow = (): CfgRow => getDatabase().prepare('SELECT * FROM card_terminal_config WHERE id = 1').get() as CfgRow;

export function getConfigView() {
  const r = cfgRow();
  const hasSecret = !!r.secret_key_enc;
  const complete = !!(r.merchant_id && r.terminal_id && hasSecret);
  return {
    provider: 'tap_smartpos',
    enabled: !!r.enabled,
    mode: r.mode as TerminalMode,
    merchantId: r.merchant_id,
    terminalId: r.terminal_id,
    secretKeySet: hasSecret,
    webhookBaseUrl: r.webhook_base_url,
    webhookPath: '/api/card-terminal/webhook',
    lastError: r.last_error,
    status: !r.enabled ? 'disabled' : r.mode === 'simulator' ? 'simulator' : complete ? 'unverified' : 'incomplete',
    updatedAt: r.updated_at,
  };
}

export function saveConfig(input: {
  enabled?: boolean; mode?: string; merchantId?: string; terminalId?: string; secretKey?: string; webhookBaseUrl?: string;
}) {
  const db = getDatabase();
  if (input.mode !== undefined && !['simulator', 'live'].includes(input.mode)) throw new CardTerminalError('mode must be simulator or live');
  if (input.webhookBaseUrl && /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(input.webhookBaseUrl)) {
    throw new CardTerminalError('Webhook URL cannot be localhost: Tap cannot reach it');
  }
  const cur = cfgRow();
  if (hasOpenIntent() && (input.enabled === false ||
      (input.mode !== undefined && input.mode !== cur.mode) ||
      input.secretKey !== undefined || input.merchantId !== undefined ||
      input.terminalId !== undefined || input.webhookBaseUrl !== undefined)) {
    throw new CardTerminalError('Resolve the open payment before changing terminal configuration', 409);
  }
  const secretEnc = input.secretKey ? encryptConfigValue(input.secretKey.trim()) : cur.secret_key_enc;
  db.prepare(
    `UPDATE card_terminal_config SET enabled = ?, mode = ?, merchant_id = ?, terminal_id = ?, secret_key_enc = ?,
       webhook_base_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
  ).run(
    input.enabled === undefined ? cur.enabled : input.enabled ? 1 : 0,
    input.mode ?? cur.mode,
    input.merchantId !== undefined ? input.merchantId.trim() || null : cur.merchant_id,
    input.terminalId !== undefined ? input.terminalId.trim() || null : cur.terminal_id,
    secretEnc,
    input.webhookBaseUrl !== undefined ? input.webhookBaseUrl.trim().replace(/\/+$/, '') || null : cur.webhook_base_url,
  );
  return getConfigView();
}

function secret(): string | null {
  return decryptConfigValue(cfgRow().secret_key_enc);
}

export function listIntents(limit = 50) {
  return getDatabase().prepare('SELECT * FROM card_terminal_intents ORDER BY id DESC LIMIT ?').all(limit);
}
export function getIntent(intentId: string) {
  return getDatabase().prepare('SELECT * FROM card_terminal_intents WHERE intent_id = ?').get(intentId) as any;
}

function hasOpenIntent(): boolean {
  return !!getDatabase().prepare(`SELECT 1 FROM card_terminal_intents WHERE status = 'INITIATED' LIMIT 1`).get();
}

export async function createIntent(input: { amount: number; orderRef?: string; currency?: string }) {
  const cfg = cfgRow();
  if (!cfg.enabled) throw new CardTerminalError('Card terminal is disabled', 409);
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount <= 0) {
    throw new CardTerminalError('amount must be finite and positive');
  }
  // Provider intent contract and reconciliation are not yet merchant-certified.
  // Do not send real charges from this skeleton.
  if (cfg.mode !== 'simulator') throw new CardTerminalError('Live terminal payments are not certified; use manual card reconciliation', 409);
  const currency = input.currency || 'KWD';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new CardTerminalError('Invalid currency');
  const amount = Number(formatAmount(input.amount, currency));
  if (amount <= 0 || amount !== input.amount || !Number.isSafeInteger(Math.round(amount * 1000))) {
    throw new CardTerminalError('Amount exceeds supported precision or range');
  }
  // Tap returns 400 while the terminal is busy; mirror that locally so the cashier gets one clear message.
  if (hasOpenIntent()) throw new CardTerminalError('Terminal is busy with another payment. Cancel it or wait for it to finish.', 409);
  const idem = randomUUID();
  const db = getDatabase();
  const intentId = 'sim_' + randomUUID().replace(/-/g, '').slice(0, 20);
  db.prepare(
    'INSERT INTO card_terminal_intents (intent_id, idempotent_key, order_ref, amount, currency, mode) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(intentId, idem, input.orderRef ?? null, amount, currency, cfg.mode);
  return getIntent(intentId);
}

export async function cancelIntent(intentId: string) {
  const it = getIntent(intentId);
  if (!it) throw new CardTerminalError('Unknown intent', 404);
  if (it.status !== 'INITIATED') throw new CardTerminalError('Only an INITIATED payment can be cancelled', 409);
  if (it.mode === 'live') {
    const key = secret();
    if (!key) throw new CardTerminalError('Secret key missing', 409);
    const res = await fetch(`${TAP_API_BASE}/intent/${encodeURIComponent(intentId)}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new CardTerminalError(`Tap returned HTTP ${res.status} on cancel`, 502);
  }
  getDatabase().prepare(`UPDATE card_terminal_intents SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE intent_id = ? AND status = 'INITIATED'`).run(intentId);
  return getIntent(intentId);
}

/** Webhook ingress: verifies the hashstring header, then updates the intent. Idempotent. */
export function ingestWebhook(body: any, headers: Record<string, string>, allowSimulator = false) {
  const cfg = cfgRow();
  const key = secret();
  if (!cfg.enabled || !key) return { ok: false as const, reason: 'not_configured' };
  const got = (headers['hashstring'] || '').trim();
  if (!got || !safeEq(got, computeHashstring(body, key))) return { ok: false as const, reason: 'signature' };
  // Only the id included in the signed hash may select an intent.
  const it = typeof body?.id === 'string' ? getIntent(body.id) : null;
  if (!it) return { ok: false as const, reason: 'unknown_intent' };
  if (it.mode !== cfg.mode || (it.mode === 'simulator' && !allowSimulator)) {
    return { ok: false as const, reason: 'mode_mismatch' };
  }
  const amount = typeof body?.amount === 'number' || (typeof body?.amount === 'string' && /^\d+(?:\.\d+)?$/.test(body.amount))
    ? Number(body.amount) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || body.currency !== it.currency || amount !== Number(it.amount)) {
    return { ok: false as const, reason: 'amount_currency_mismatch' };
  }
  const st = String(body.status || '').toUpperCase();
  const mapped: IntentStatus =
    st === 'CAPTURED' ? 'CAPTURED' : st === 'CANCELLED' ? 'CANCELLED' : st === 'DECLINED' ? 'DECLINED' : ['FAILED', 'ABANDONED', 'TIMEDOUT', 'VOID'].includes(st) ? 'FAILED' : 'INITIATED';
  if (st === 'CAPTURED' && (typeof body?.reference?.payment !== 'string' || !body.reference.payment.trim())) {
    return { ok: false as const, reason: 'missing_payment_reference' };
  }
  if (it.status !== 'INITIATED') {
    if (it.status !== mapped || (mapped === 'CAPTURED' && it.transaction_ref !== body.reference.payment)) {
      return { ok: false as const, reason: 'terminal_status_conflict' };
    }
    return { ok: true as const, duplicate: true, status: it.status };
  }
  if (mapped === 'INITIATED') return { ok: true as const, duplicate: false, status: mapped };
  getDatabase().prepare(
    `UPDATE card_terminal_intents SET status = ?, transaction_ref = ?, scheme = ?, last_four = ?, detail = ?, updated_at = CURRENT_TIMESTAMP WHERE intent_id = ? AND status = 'INITIATED'`,
  ).run(mapped, body?.reference?.payment || body?.reference?.transaction || body?.id || null, body?.card?.scheme || null,
    body?.card?.last_four || null, body?.response?.message || null, it.intent_id);
  return { ok: true as const, duplicate: false, status: mapped, transactionRef: body?.reference?.payment || null };
}

/** Simulator only: produce a signed Tap-style webhook for an open intent and process it. */
export function simulateResult(intentId: string, outcome: 'CAPTURED' | 'DECLINED') {
  const cfg = cfgRow();
  if (cfg.mode !== 'simulator') throw new CardTerminalError('Simulation is only available in simulator mode', 409);
  const key = secret() || ensureSimulatorSecret();
  const it = getIntent(intentId);
  if (!it || it.mode !== 'simulator') throw new CardTerminalError('Unknown simulator intent', 404);
  const body = {
    id: it.intent_id, object: 'charge', status: outcome, amount: it.amount, currency: it.currency,
    transaction: { created: String(Date.now()) },
    reference: { gateway: 'SIMGW' + it.id, payment: 'SIMPAY' + String(Date.now()).slice(-9) },
    response: { message: outcome === 'CAPTURED' ? 'Captured (simulated)' : 'Declined (simulated)' },
    card: { scheme: 'KNET', last_four: '0000' },
  };
  return ingestWebhook(body, { hashstring: computeHashstring(body, key) }, true);
}

function ensureSimulatorSecret(): string {
  const s = 'sim_' + randomUUID();
  getDatabase().prepare('UPDATE card_terminal_config SET secret_key_enc = ? WHERE id = 1').run(encryptConfigValue(s));
  return s;
}
