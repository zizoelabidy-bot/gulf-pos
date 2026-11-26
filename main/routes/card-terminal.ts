/** GULF POS - Settings > Payments terminal (Tap SmartPOS). Webhook is hashstring-authenticated, no session. */
import { Router, Request, Response } from 'express';
import { requirePermission } from '../services/authorization';
import * as svc from '../services/tap-smartpos';

const router = Router();
const webhook = Router();

webhook.post('/webhook', (req: Request, res: Response) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
  const r = svc.ingestWebhook(req.body, headers);
  if (!r.ok) return res.status(r.reason === 'signature' ? 401 : 422).json({ ok: false, reason: r.reason });
  return res.status(200).json(r);
});

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
  try { res.json(await fn(req, res)); }
  catch (e) {
    const err = e as { statusCode?: number; message?: string };
    res.status(err.statusCode || 500).json({ error: err.message || 'Error' });
  }
};

router.get('/config', requirePermission('settings.view'), wrap(() => svc.getConfigView()));
router.put('/config', requirePermission('settings.manage'), wrap((req) => svc.saveConfig(req.body || {})));
router.get('/intents', requirePermission('settings.view'), wrap(() => ({ intents: svc.listIntents() })));
router.post('/intents', requirePermission('payments.take'), wrap((req) => svc.createIntent({
  amount: req.body?.amount, orderRef: req.body?.orderRef, currency: req.body?.currency,
})));
router.get('/intents/:id', requirePermission('payments.take'), wrap((req) => svc.getIntent(String(req.params.id)) || { error: 'not found' }));
router.post('/intents/:id/cancel', requirePermission('payments.take'), wrap((req) => svc.cancelIntent(String(req.params.id))));
router.post('/intents/:id/simulate', requirePermission('settings.manage'), wrap((req) =>
  svc.simulateResult(String(req.params.id), req.body?.outcome === 'DECLINED' ? 'DECLINED' : 'CAPTURED')));

export { router as cardTerminalRoutes, webhook as cardTerminalWebhookRoutes };
