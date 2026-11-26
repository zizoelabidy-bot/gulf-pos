/**
 * Keeta Open Delivery API (public docs: https://api-docs.mykeeta.com/apis/opendelivery/integrating-with-keeta-api).
 * Flow: OAuth token -> merchantOnboarding registers webhook URLs -> order
 * CREATED event -> fetch order details -> /confirm or /requestCancellation
 * -> /readyForPickup / /dispatch. Keeta launched in Kuwait Sept 2025.
 * Endpoint paths are documented; the base URL/token come from Keeta partner
 * onboarding, so outbound calls are logged until credentials are in place.
 */
import type { CanonicalOrder, PlatformAdapter, StatusUpdate, AggregatorConfig } from '../types';
import { strictNumber, strList } from '../types';
import { verifyHmacHeaders } from './helpers';

function mapInbound(payload: unknown): CanonicalOrder | null {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  // Keeta webhook events wrap the order; also accept a bare order object.
  const order = (root.order && typeof root.order === 'object' ? root.order : root) as Record<string, unknown>;
  const orderId = strList(order.orderId, order.id, root.orderId);
  const itemsRaw = Array.isArray(order.items) ? order.items : null;
  if (!orderId || !itemsRaw || itemsRaw.length === 0 || itemsRaw.some(i => !i || typeof i !== 'object' || Array.isArray(i))) return null;
  const items = itemsRaw.map((it) => {
    const i = it as Record<string, unknown>;
    return {
      externalItemId: strList(i.skuId, i.id, i.sku),
      name: strList(i.name, i.skuName) || 'Item',
      quantity: strictNumber(i.quantity),
      unitPrice: strictNumber(i.price ?? i.unitPrice),
    };
  });
  if (items.some(i => !Number.isSafeInteger(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unitPrice))) return null;
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const total = strictNumber(order.total ?? order.totalPrice);
  if (!Number.isFinite(total) || !Number.isFinite(strictNumber(order.tax ?? 0))) return null;
  return {
    externalOrderId: orderId,
    platform: 'keeta',
    customerName: strList(order.customerName, (order.recipient as Record<string, unknown> | undefined)?.name),
    customerPhone: strList(order.customerPhone, (order.recipient as Record<string, unknown> | undefined)?.phone),
    note: strList(order.remark, order.note),
    currency: strList(order.currency),
    items,
    subtotal,
    tax: strictNumber(order.tax ?? 0),
    total,
  };
}

export const keetaAdapter: PlatformAdapter = {
  key: 'keeta',
  displayName: 'Keeta',
  docsUrl: 'https://api-docs.mykeeta.com/apis/opendelivery/integrating-with-keeta-api',
  readiness: 'documented',
  partnerRequirements: [
    'Keeta merchant/partner credentials (client id + secret) from Keeta partner onboarding',
    'keetaMerchantId linked to our store id (merchantOnboarding call)',
    'Test flow with the Keeta Test App before going live',
  ],
  mapInbound,
  verifySignature(rawBody, headers, secret) {
    return verifyHmacHeaders(rawBody, headers, secret, ['x-keeta-signature', 'x-signature', 'authorization-sign']);
  },
  buildStatusUpdate(_cfg: AggregatorConfig, externalOrderId: string, status): StatusUpdate {
    const path = { accepted: 'confirm', rejected: 'requestCancellation', ready: 'readyForPickup', dispatched: 'dispatch' }[status];
    return { url: null, method: 'POST', body: { endpoint: `/v1/orders/${externalOrderId}/${path}`, orderId: externalOrderId } };
  },
  validateConfig(cfg) {
    if (!cfg.clientId || !cfg.clientSecret) return { ok: false, message: 'Missing Keeta client id/secret' };
    if (!cfg.storeId) return { ok: false, message: 'Missing Keeta merchant id (store mapping)' };
    return { ok: true, message: 'Configuration complete. Order flow follows the documented Keeta lifecycle.' };
  },
};
