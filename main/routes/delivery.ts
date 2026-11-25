import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  assignDeliveryOrder,
  DeliveryServiceError,
  driverCashSummary,
  listDeliveryAssignments,
  listDeliveryDrivers,
  listDeliverySettlements,
  listDeliveryZones,
  saveDeliveryDriver,
  saveDeliveryZone,
  settleDriverCash,
  updateDeliveryAssignmentStatus,
} from '../services/delivery';

export const deliveryRoutes = Router();

function actor(req: Request): string | null {
  const u = (req as unknown as { user?: { username?: string; id?: string } }).user;
  return u?.username ?? u?.id ?? null;
}

function sendError(res: Response, error: unknown): void {
  const details = error as { statusCode?: unknown; message?: unknown };
  const statusCode = Number.isInteger(details.statusCode) ? (details.statusCode as number) : 500;
  if (statusCode >= 500) console.error('[API] Internal error:', error);
  res
    .status(statusCode)
    .json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
}

deliveryRoutes.get('/zones', requirePermission('delivery.view'), (_req: Request, res: Response) => {
  try {
    const all = _req.query.all === '1' || _req.query.all === 'true';
    res.json({ zones: listDeliveryZones(getDatabase(), all) });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.post('/zones', requirePermission('delivery.manage'), (req: Request, res: Response) => {
  try {
    res.json({ zone: saveDeliveryZone(getDatabase(), req.body ?? {}) });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.put('/zones/:id', requirePermission('delivery.manage'), (req: Request, res: Response) => {
  try {
    res.json({
      zone: saveDeliveryZone(getDatabase(), { ...(req.body ?? {}), id: String(req.params.id) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.get('/drivers', requirePermission('delivery.view'), (_req: Request, res: Response) => {
  try {
    const all = _req.query.all === '1' || _req.query.all === 'true';
    res.json({ drivers: listDeliveryDrivers(getDatabase(), all) });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.post('/drivers', requirePermission('delivery.manage'), (req: Request, res: Response) => {
  try {
    res.json({ driver: saveDeliveryDriver(getDatabase(), req.body ?? {}) });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.put('/drivers/:id', requirePermission('delivery.manage'), (req: Request, res: Response) => {
  try {
    res.json({
      driver: saveDeliveryDriver(getDatabase(), { ...(req.body ?? {}), id: String(req.params.id) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.get('/assignments', requirePermission('delivery.view'), (req: Request, res: Response) => {
  try {
    res.json({
      assignments: listDeliveryAssignments(getDatabase(), {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        driver_id: typeof req.query.driver_id === 'string' ? req.query.driver_id : undefined,
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.post('/assignments', requirePermission('delivery.assign'), (req: Request, res: Response) => {
  try {
    res.json({
      assignment: assignDeliveryOrder(getDatabase(), {
        ...(req.body ?? {}),
        assigned_by: actor(req),
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.post(
  '/assignments/:id/status',
  requirePermission('delivery.assign'),
  (req: Request, res: Response) => {
    try {
      res.json({
        assignment: updateDeliveryAssignmentStatus(
          getDatabase(),
          Number(req.params.id),
          req.body ?? {},
        ),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

deliveryRoutes.get('/cash/:driverId/:date', requirePermission('delivery.view'), (req: Request, res: Response) => {
  try {
    res.json({
      summary: driverCashSummary(getDatabase(), String(req.params.driverId), String(req.params.date)),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.post('/settlements', requirePermission('delivery.settle'), (req: Request, res: Response) => {
  try {
    res.json({
      settlement: settleDriverCash(getDatabase(), { ...(req.body ?? {}), settled_by: actor(req) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

deliveryRoutes.get('/settlements', requirePermission('delivery.view'), (req: Request, res: Response) => {
  try {
    res.json({
      settlements: listDeliverySettlements(
        getDatabase(),
        typeof req.query.driver_id === 'string' ? req.query.driver_id : undefined,
      ),
    });
  } catch (error) {
    sendError(res, error);
  }
});
