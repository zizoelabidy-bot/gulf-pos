/**
 * Aggregator integration service: config (encrypted at rest), inbound webhook
 * ingestion into POS orders, item mapping, status push, and the event log.
 */
import { generateOrderNumber, getDatabase, getSettingValue } from '../../db';
import type { AggregatorConfig, CanonicalOrder, PlatformKey } from './types';
import { getAdapter, ADAPTERS, PLATFORM_KEYS } from './adapters';
import { encryptConfigValue, decryptConfigValue } from './crypto';

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface ConfigRow {
  platform: string;
  enabled: number;
  client_id: string | null;
  client_secret_enc: string | null;
  store_id: string | null;
  branch_id: string | null;
  webhook_secret_enc: string | null;
  branch_mapping: string | null;
  auto_accept: number;
  status: string;
  last_error: string | null;
  updated_at: string;
}

export function logEvent(platform: string, kind: string, externalOrderId: string | null, detail: string | null): void {
  getDatabase().prepare(
    'INSERT INTO aggregator_events (platform, kind, external_order_id, detail) VALUES (?, ?, ?, ?)'
  ).run(platform, kind, externalOrderId, detail);
}

export function listEvents(limit = 100): unknown[] {
  return getDatabase().prepare(
    'SELECT id, platform, kind, external_order_id, detail, created_at FROM aggregator_events ORDER BY id DESC LIMIT ?'
  ).all(limit);
}

function rowToConfig(row: ConfigRow): AggregatorConfig {
  return {
    platform: row.platform as PlatformKey,
    enabled: !!row.enabled,
    clientId: row.client_id,
    clientSecret: decryptConfigValue(row.client_secret_enc),
    storeId: row.store_id,
    branchId: row.branch_id,
    webhookSecret: decryptConfigValue(row.webhook_secret_enc),
    branchMapping: row.branch_mapping,
    autoAccept: !!row.auto_accept,
  };
}

export function getConfig(platform: string): (AggregatorConfig & { status: string; lastError: string | null }) | null {
  const row = getDatabase().prepare('SELECT * FROM aggregator_integrations WHERE platform = ?').get(platform) as ConfigRow | undefined;
  if (!row) return null;
  return { ...rowToConfig(row), status: row.status, lastError: row.last_error };
}

/** Configs for the settings UI: secrets are masked, never returned. */
export function getConfigViews(): unknown[] {
  const db = getDatabase();
  return PLATFORM_KEYS.map((key) => {
    const adapter = ADAPTERS[key];
    const row = db.prepare('SELECT * FROM aggregator_integrations WHERE platform = ?').get(key) as ConfigRow | undefined;
    return {
      platform: key,
      displayName: adapter.displayName,
      docsUrl: adapter.docsUrl,
      readiness: adapter.readiness,
      partnerRequirements: adapter.partnerRequirements,
      enabled: row ? !!row.enabled : false,
      clientId: row?.client_id ?? null,
      storeId: row?.store_id ?? null,
      branchId: row?.branch_id ?? null,
      branchMapping: row?.branch_mapping ?? null,
      autoAccept: row ? !!row.auto_accept : false,
      hasClientSecret: !!row?.client_secret_enc,
      hasWebhookSecret: !!row?.webhook_secret_enc,
      status: row?.status ?? 'disabled',
      lastError: row?.last_error ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

export interface SaveConfigInput {
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null; // undefined keeps existing; '' clears
  storeId?: string | null;
  branchId?: string | null;
  webhookSecret?: string | null;
  branchMapping?: string | null;
  autoAccept?: boolean;
}

export function saveConfig(platform: string, input: SaveConfigInput): { ok: boolean; message: string } {
  const db = getDatabase();
  const adapter = getAdapter(platform);
  if (!adapter) return { ok: false, message: `Unknown platform: ${platform}` };
  db.prepare('INSERT OR IGNORE INTO aggregator_integrations (platform) VALUES (?)').run(platform);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };
  if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0);
  if (input.clientId !== undefined) set('client_id', input.clientId);
  if (input.storeId !== undefined) set('store_id', input.storeId);
  if (input.branchId !== undefined) set('branch_id', input.branchId);
  if (input.branchMapping !== undefined) set('branch_mapping', input.branchMapping);
  if (input.autoAccept !== undefined) set('auto_accept', input.autoAccept ? 1 : 0);
  if (input.clientSecret !== undefined) set('client_secret_enc', input.clientSecret ? encryptConfigValue(input.clientSecret) : null);
  if (input.webhookSecret !== undefined) set('webhook_secret_enc', input.webhookSecret ? encryptConfigValue(input.webhookSecret) : null);
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(platform);
    db.prepare(`UPDATE aggregator_integrations SET ${sets.join(', ')} WHERE platform = ?`).run(...params);
  }

  const merged = getConfig(platform)!;
  const validation = adapter.validateConfig(merged);
  const status = !merged.enabled ? 'disabled' : validation.ok ? 'configured' : 'incomplete';
  db.prepare('UPDATE aggregator_integrations SET status = ?, last_error = ? WHERE platform = ?')
    .run(status, merged.enabled && !validation.ok ? validation.message : null, platform);
  return { ok: true, message: validation.message };
}

export function testConnection(platform: string): { ok: boolean; message: string } {
  const adapter = getAdapter(platform);
  const cfg = getConfig(platform);
  if (!adapter || !cfg) return { ok: false, message: `Unknown platform: ${platform}` };
  const validation = adapter.validateConfig(cfg);
  const result = validation.ok
    ? { ok: false, message: 'Local configuration is complete; live connectivity has not been verified.' }
    : validation;
  logEvent(platform, 'configuration_check', null, result.message);
  return result;
}

export function getItemMap(platform: string): unknown[] {
  return getDatabase().prepare(
    'SELECT platform, external_item_id, product_id, external_name FROM aggregator_item_map WHERE platform = ? ORDER BY external_item_id'
  ).all(platform);
}

export function setItemMapEntry(platform: string, externalItemId: string, productId: string, externalName: string | null): void {
  getDatabase().prepare(
    `INSERT INTO aggregator_item_map (platform, external_item_id, product_id, external_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(platform, external_item_id) DO UPDATE SET product_id = excluded.product_id, external_name = excluded.external_name`
  ).run(platform, externalItemId, productId, externalName);
}

export function deleteItemMapEntry(platform: string, externalItemId: string): void {
  getDatabase().prepare('DELETE FROM aggregator_item_map WHERE platform = ? AND external_item_id = ?').run(platform, externalItemId);
}

export interface IngestResult {
  ok: boolean;
  reason?: 'disabled' | 'signature' | 'unmapped';
  duplicate?: boolean;
  orderId?: number;
  orderNumber?: string;
  autoAccepted?: boolean;
}

function insertOnlineOrder(canonical: CanonicalOrder): { orderId: number; orderNumber: string } {
  const db = getDatabase();
  const orderNumber = generateOrderNumber();
  const note = [canonical.note, canonical.customerName ? `Customer: ${canonical.customerName}` : null, canonical.customerPhone ? `Phone: ${canonical.customerPhone}` : null]
    .filter(Boolean).join(' | ') || null;
  const info = db.prepare(
    `INSERT INTO orders (order_number, type, status, special_instructions, subtotal, tax_amount, total, online_platform, external_order_id)
     VALUES (?, 'online', 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(orderNumber, note, round3(canonical.subtotal), round3(canonical.tax), round3(canonical.total), canonical.platform, canonical.externalOrderId);
  const orderId = Number(info.lastInsertRowid);

  const mapStmt = db.prepare('SELECT product_id FROM aggregator_item_map WHERE platform = ? AND external_item_id = ?');
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, tax_amount, total, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending')`
  );
  for (const item of canonical.items) {
    let productId: string | null = null;
    if (item.externalItemId) {
      const m = mapStmt.get(canonical.platform, item.externalItemId) as { product_id: string } | undefined;
      productId = m?.product_id ?? null;
    }
    if (!productId) productId = `ext:${canonical.platform}:${item.externalItemId ?? item.name}`;
    const lineTotal = round3(round3(item.unitPrice) * item.quantity);
    insertItem.run(orderId, productId, item.name, round3(item.unitPrice), item.quantity, lineTotal, lineTotal);
  }
  return { orderId, orderNumber };
}

export function ingestWebhook(platform: string, payload: unknown, headers: Record<string, string>, rawBody = JSON.stringify(payload ?? {})): IngestResult {
  const db = getDatabase();
  const adapter = getAdapter(platform);
  if (!adapter) return { ok: false, reason: 'unmapped' };
  const cfg = getConfig(platform);
  if (!cfg || !cfg.enabled) {
    logEvent(platform, 'webhook_rejected_disabled', null, null);
    return { ok: false, reason: 'disabled' };
  }
  if (!adapter.verifySignature(rawBody, headers, cfg.webhookSecret)) {
    logEvent(platform, 'signature_rejected', null, 'HMAC verification failed or webhook secret not set');
    return { ok: false, reason: 'signature' };
  }
  // Parse the authenticated representation, not a separately supplied object.
  let canonical: CanonicalOrder | null;
  try {
    canonical = adapter.mapInbound(JSON.parse(rawBody));
  } catch {
    canonical = null;
  }
  const money = (n: number) => Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 1000));
  const currency = getSettingValue('currency');
  if (canonical && (
    canonical.platform !== platform ||
    (canonical.currency && (!currency || canonical.currency.toUpperCase() !== currency.toUpperCase())) ||
    !canonical.items.length ||
    canonical.items.some(i => !Number.isSafeInteger(i.quantity) || i.quantity <= 0 || !money(i.unitPrice) || !money(i.unitPrice * i.quantity)) ||
    ![canonical.subtotal, canonical.tax, canonical.total].every(money) ||
    round3(canonical.items.reduce((sum, i) => sum + round3(round3(i.unitPrice) * i.quantity), 0)) !== round3(canonical.subtotal) ||
    round3(canonical.subtotal + canonical.tax) !== round3(canonical.total)
  )) canonical = null;
  if (!canonical) {
    logEvent(platform, 'unmapped_payload', null, 'Invalid or unsupported order payload');
    return { ok: false, reason: 'unmapped' };
  }
  const order = canonical;
  return db.transaction((): IngestResult => {
    const existing = db.prepare(
      'SELECT id, order_number FROM orders WHERE online_platform = ? AND external_order_id = ?'
    ).get(order.platform, order.externalOrderId) as { id: number; order_number: string } | undefined;
    if (existing) {
      logEvent(platform, 'order_duplicate', order.externalOrderId, `existing order ${existing.order_number}`);
      return { ok: true, duplicate: true, orderId: existing.id, orderNumber: existing.order_number };
    }
    const { orderId, orderNumber } = insertOnlineOrder(order);
    logEvent(platform, 'order_received', order.externalOrderId, `POS order ${orderNumber}, ${order.items.length} items, total ${order.total}${order.currency ? ' ' + order.currency : ''}`);
    const autoAccepted = false;
    if (cfg.autoAccept) {
      const update = adapter.buildStatusUpdate(cfg, order.externalOrderId, 'accepted');
      logEvent(platform, 'auto_accept_unavailable', order.externalOrderId, update ? 'Status delivery is not implemented' : 'Partner endpoints required');
    }
    return { ok: true, orderId, orderNumber, autoAccepted };
  }).immediate();
}

export function pushStatus(
  platform: string,
  externalOrderId: string,
  status: 'accepted' | 'rejected' | 'ready' | 'dispatched',
): { delivered: boolean; payload: unknown } {
  const adapter = getAdapter(platform);
  const cfg = getConfig(platform);
  if (!adapter || !cfg || !cfg.enabled) return { delivered: false, payload: null };
  const update = adapter.buildStatusUpdate(cfg, externalOrderId, status);
  if (!update) {
    logEvent(platform, 'status_update_unavailable', externalOrderId, status);
    return { delivered: false, payload: null };
  }
  // Live delivery activates when partner endpoint URLs come with credentials;
  // until then the exact outbound payload is logged.
  logEvent(platform, 'status_update', externalOrderId, JSON.stringify({ status, ...update.body }));
  return { delivered: false, payload: update.body };
}
