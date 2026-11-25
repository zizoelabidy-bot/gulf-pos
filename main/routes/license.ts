import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  activateLicense,
  deactivateLicense,
  getLicenseState,
  LicenseError,
} from '../services/licensing';

export const licenseRoutes = Router();

function sendError(res: Response, error: unknown): void {
  const statusCode = error instanceof LicenseError ? error.statusCode : 500;
  if (statusCode >= 500) console.error('[API] Internal error:', error);
  res
    .status(statusCode)
    .json({ error: statusCode >= 500 ? 'Internal server error' : (error as Error).message });
}

licenseRoutes.get('/status', requirePermission('settings.view'), (_req: Request, res: Response) => {
  try {
    res.json(getLicenseState(getDatabase()));
  } catch (error) {
    sendError(res, error);
  }
});

licenseRoutes.post('/activate', requirePermission('settings.manage'), (req: Request, res: Response) => {
  try {
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!key.trim()) return res.status(400).json({ error: 'License key required' });
    res.json(activateLicense(getDatabase(), key));
  } catch (error) {
    sendError(res, error);
  }
});

licenseRoutes.post(
  '/deactivate',
  requirePermission('settings.manage'),
  (_req: Request, res: Response) => {
    try {
      res.json(deactivateLicense(getDatabase()));
    } catch (error) {
      sendError(res, error);
    }
  },
);

licenseRoutes.get('/events', requirePermission('settings.view'), (_req: Request, res: Response) => {
  try {
    const rows = getDatabase()
      .prepare('SELECT kind, lic_id, detail, created_at FROM license_events ORDER BY created_at DESC LIMIT 100')
      .all();
    res.json({ events: rows });
  } catch (error) {
    sendError(res, error);
  }
});
