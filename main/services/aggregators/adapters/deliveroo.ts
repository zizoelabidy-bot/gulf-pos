/**
 * Deliveroo Partner Platform Suite: https://developers.deliveroo.com/
 * Public developer portal with sandbox; registration/approval required.
 * NOTE: Deliveroo exited Kuwait in 2020 - relevant only for other markets.
 */
import type { CanonicalOrder, PlatformAdapter, StatusUpdate, AggregatorConfig } from '../types';
import { num, str, strList } from '../types';
import { verifyHmacHeaders } from './helpers';

function mapInbound(payload: unknown): CanonicalOrder | null {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const body = (root.body && typeof root.body === 'object' ? root.body : root) as Record<string, unknown>;
  const order = (body.order && typeof body.order === 'object' ? body.order : body) as Record<string, unknown>;
  const id = strList(order.id, order.order_id, order.orderId);
  const itemsRaw = Array.isArray(order.items) ? order.items : null;
  if (!id || !itemsRaw || itemsRaw.length === 0) return null;
  const items = itemsRaw.map((it) => {
    const i = it as Record<string, unknown>;
    return {
      externalItemId: strList(i.pos_item_id, i.posId, i.id),
      name: strList(i.name) || 'Item',
      quantity: Math.max(1, Math.round(num(i.quantity) || 1)),
      unitPrice: num(i.unit_price) || num(i.unitPrice) || num(i.price),
    };
  });
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const total = num(order.total_price) || num(order.total) || subtotal;
  return {
    externalOrderId: id,
    platform: 'deliveroo',
    customerName: strList((order.customer as Record<string, unknown> | undefined)?.name),
    customerPhone: null,
    note: strList(order.notes, order.comment),
    currency: strList(order.currency),
    items,
    subtotal,
    tax: Math.max(0, total - subtotal),
    total,
  };
}

export const deliverooAdapter: PlatformAdapter = {
  key: 'deliveroo',
  displayName: 'Deliveroo',
  docsUrl: 'https://developers.deliveroo.com/',
  readiness: 'partner-portal',
  partnerRequirements: [
    'Developer account + application approval at developers.deliveroo.com (sandbox available)',
    'Partner API credentials and per-site webhook registration',
    'Deliveroo does not currently operate in Kuwait',
  ],
  mapInbound,
  verifySignature(rawBody, headers, secret) {
    return verifyHmacHeaders(rawBody, headers, secret, ['x-deliveroo-hmac-sha256', 'x-signature']);
  },
  buildStatusUpdate(_cfg: AggregatorConfig, externalOrderId: string, status): StatusUpdate {
    const mapped = { accepted: 'accepted', rejected: 'rejected', ready: 'ready_for_collection', dispatched: 'collected' }[status];
    return { url: null, method: 'POST', body: { endpoint: `/order/${externalOrderId}/status`, status: mapped } };
  },
  validateConfig(cfg) {
    if (!cfg.clientId || !cfg.clientSecret) return { ok: false, message: 'Missing Deliveroo client id/secret' };
    if (!cfg.storeId) return { ok: false, message: 'Missing Deliveroo site id' };
    return { ok: true, message: 'Configuration complete. Test against the Deliveroo sandbox first.' };
  },
};
