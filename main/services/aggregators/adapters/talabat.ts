/**
 * Talabat = Delivery Hero POS Middleware plugin.
 * Docs: https://integration.talabat.com/en/documentation/
 *       https://developers.deliveryhero.com/documentation/pos.html
 * Order Dispatch webhook pushes orders to our endpoint; we acknowledge and
 * later send Update Order Status back. Partner onboarding + NDA required;
 * exact production endpoint URLs come from the partner portal, so outbound
 * status updates are logged until credentials supply them.
 */
import type { CanonicalOrder, PlatformAdapter, StatusUpdate, AggregatorConfig } from '../types';
import { strictNumber, strList } from '../types';
import { verifyHmacHeaders } from './helpers';

function mapInbound(payload: unknown): CanonicalOrder | null {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const order = (root.order && typeof root.order === 'object' ? root.order : root) as Record<string, unknown>;
  const code = strList(order.code, order.id, order.orderId, root.code);
  const itemsRaw = Array.isArray(order.items) ? order.items : null;
  if (!code || !itemsRaw || itemsRaw.length === 0 || itemsRaw.some(i => !i || typeof i !== 'object' || Array.isArray(i))) return null;
  const items = itemsRaw.map((it) => {
    const i = it as Record<string, unknown>;
    return {
      externalItemId: strList(i.sku, i.id, i.externalId),
      name: strList(i.name, i.title) || 'Item',
      quantity: strictNumber(i.quantity),
      unitPrice: strictNumber(i.unitPrice ?? i.price),
    };
  });
  const customer = (order.customer && typeof order.customer === 'object' ? order.customer : {}) as Record<string, unknown>;
  if (items.some(i => !Number.isSafeInteger(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unitPrice))) return null;
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const total = strictNumber(order.totalPrice ?? order.total);
  if (!Number.isFinite(total) || !Number.isFinite(strictNumber(order.tax ?? 0))) return null;
  return {
    externalOrderId: code,
    platform: 'talabat',
    customerName: strList(customer.name),
    customerPhone: strList(customer.phone, customer.mobilePhone),
    note: strList(order.comment, order.note, order.specialInstructions),
    currency: strList(order.currency),
    items,
    subtotal,
    tax: strictNumber(order.tax ?? 0),
    total,
  };
}

export const talabatAdapter: PlatformAdapter = {
  key: 'talabat',
  displayName: 'Talabat',
  docsUrl: 'https://integration.talabat.com/en/documentation/',
  readiness: 'documented',
  partnerRequirements: [
    'Partner application + NDA via integration.talabat.com',
    'Store/vendor ID per branch',
    'Webhook HMAC secret',
    'Onboarding stated ~1-2 weeks when the POS is already pre-integrated',
  ],
  mapInbound,
  verifySignature(rawBody, headers, secret) {
    return verifyHmacHeaders(rawBody, headers, secret, ['webhookhmacauth', 'x-hmac-signature', 'x-signature']);
  },
  buildStatusUpdate(_cfg: AggregatorConfig, externalOrderId: string, status): StatusUpdate {
    const mapped = { accepted: 'ACCEPTED', rejected: 'REJECTED', ready: 'READY_FOR_PICKUP', dispatched: 'DISPATCHED' }[status];
    return { url: null, method: 'POST', body: { order: { code: externalOrderId, status: mapped } } };
  },
  validateConfig(cfg) {
    if (!cfg.storeId) return { ok: false, message: 'Missing Talabat store/vendor ID' };
    if (!cfg.webhookSecret) return { ok: false, message: 'Missing webhook HMAC secret' };
    return { ok: true, message: 'Configuration complete. Live delivery of status updates activates with partner endpoints from the Talabat portal.' };
  },
};
