/**
 * GULF POS - Settings > Integrations (delivery aggregators).
 * Webhook endpoints are unauthenticated by design: platforms authenticate via
 * the per-platform HMAC webhook secret. Management endpoints require settings permission.
 */
import { Router, Request, Response } from 'express';
import { requirePermission } from '../services/authorization';
import {
  getConfigViews, saveConfig, testConnection, listEvents,
  getItemMap, setItemMapEntry, deleteItemMapEntry,
  ingestWebhook, pushStatus,
} from '../services/aggregators/service';
import { getAdapter } from '../services/aggregators/adapters';

const router = Router();
const webhook = Router();

// ---- webhook ingress (HMAC-authenticated, no session) ----
webhook.post('/webhook/:platform', (req: Request, res: Response) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
  }
  const result = ingestWebhook(String(req.params.platform), req.body, headers);
  if (!result.ok) {
    const code = result.reason === 'signature' ? 401 : result.reason === 'disabled' ? 403 : 422;
    return res.status(code).json({ ok: false, reason: result.reason });
  }
  return res.status(result.duplicate ? 200 : 201).json(result);
});

// ---- management (settings permission) ----
router.get('/aggregators', requirePermission('settings.view'), (_req: Request, res: Response) => {
  res.json({ platforms: getConfigViews() });
});

router.put('/aggregators/:platform', requirePermission('settings.manage'), (req: Request, res: Response) => {
  if (!getAdapter(String(req.params.platform))) return res.status(404).json({ error: 'Unknown platform' });
  const result = saveConfig(String(req.params.platform), req.body || {});
  res.json(result);
});

router.post('/aggregators/:platform/test', requirePermission('settings.manage'), (req: Request, res: Response) => {
  if (!getAdapter(String(req.params.platform))) return res.status(404).json({ error: 'Unknown platform' });
  res.json(testConnection(String(req.params.platform)));
});

router.get('/aggregators/events', requirePermission('settings.view'), (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
  res.json({ events: listEvents(limit) });
});

router.get('/aggregators/:platform/item-map', requirePermission('settings.view'), (req: Request, res: Response) => {
  res.json({ items: getItemMap(String(req.params.platform)) });
});

router.put('/aggregators/:platform/item-map', requirePermission('settings.manage'), (req: Request, res: Response) => {
  const { externalItemId, productId, externalName } = req.body || {};
  if (!externalItemId || !productId) return res.status(400).json({ error: 'externalItemId and productId are required' });
  setItemMapEntry(String(req.params.platform), String(externalItemId), String(productId), externalName ? String(externalName) : null);
  res.json({ ok: true });
});

router.delete('/aggregators/:platform/item-map/:externalItemId', requirePermission('settings.manage'), (req: Request, res: Response) => {
  deleteItemMapEntry(String(req.params.platform), String(req.params.externalItemId));
  res.json({ ok: true });
});

router.post('/aggregators/:platform/orders/:externalOrderId/status', requirePermission('orders.status.update'), (req: Request, res: Response) => {
  const status = (req.body || {}).status;
  if (!['accepted', 'rejected', 'ready', 'dispatched'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted|rejected|ready|dispatched' });
  }
  res.json(pushStatus(String(req.params.platform), String(req.params.externalOrderId), status));
});

export { router as integrationsHubRoutes, webhook as aggregatorWebhookRoutes };
