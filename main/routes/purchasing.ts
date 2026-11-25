import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  listSupplierPayments,
  listSuppliers,
  PurchasingServiceError,
  receivePurchaseOrderItems,
  recordSupplierPayment,
  saveSupplier,
  setPurchaseOrderStatus,
  supplierBalance,
} from '../services/purchasing';

export const purchasingRoutes = Router();

function actor(req: Request): string | null {
  const u = (req as unknown as { user?: { username?: string; id?: string } }).user;
  return u?.username ?? u?.id ?? null;
}

function actorUserId(req: Request): string | null {
  const u = (req as unknown as { user?: { id?: string } }).user;
  return u?.id ?? null;
}

function sendError(res: Response, error: unknown): void {
  const details = error as { statusCode?: unknown; message?: unknown };
  const statusCode = Number.isInteger(details.statusCode) ? (details.statusCode as number) : 500;
  if (statusCode >= 500) console.error('[API] Internal error:', error);
  res
    .status(statusCode)
    .json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
}

purchasingRoutes.get('/suppliers', requirePermission('purchasing.view'), (req: Request, res: Response) => {
  try {
    const all = req.query.all === '1' || req.query.all === 'true';
    res.json({ suppliers: listSuppliers(getDatabase(), all) });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.post('/suppliers', requirePermission('purchasing.manage'), (req: Request, res: Response) => {
  try {
    res.json({ supplier: saveSupplier(getDatabase(), req.body ?? {}) });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.put('/suppliers/:id', requirePermission('purchasing.manage'), (req: Request, res: Response) => {
  try {
    res.json({
      supplier: saveSupplier(getDatabase(), { ...(req.body ?? {}), id: String(req.params.id) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.get('/purchase-orders', requirePermission('purchasing.view'), (req: Request, res: Response) => {
  try {
    res.json({
      purchase_orders: listPurchaseOrders(getDatabase(), {
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        supplier_id: typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined,
      }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.post('/purchase-orders', requirePermission('purchasing.manage'), (req: Request, res: Response) => {
  try {
    res.json({
      purchase_order: createPurchaseOrder(getDatabase(), { ...(req.body ?? {}), created_by: actor(req) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.get('/purchase-orders/:id', requirePermission('purchasing.view'), (req: Request, res: Response) => {
  try {
    res.json({ purchase_order: getPurchaseOrder(getDatabase(), Number(req.params.id)) });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.post(
  '/purchase-orders/:id/status',
  requirePermission('purchasing.manage'),
  (req: Request, res: Response) => {
    try {
      res.json({
        purchase_order: setPurchaseOrderStatus(getDatabase(), Number(req.params.id), (req.body ?? {}).status),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

purchasingRoutes.post(
  '/purchase-orders/:id/receive',
  requirePermission('purchasing.receive'),
  (req: Request, res: Response) => {
    try {
      res.json({
        purchase_order: receivePurchaseOrderItems(getDatabase(), Number(req.params.id), {
          ...(req.body ?? {}),
          actor_user_id: actorUserId(req) ?? (req.body ?? {}).actor_user_id,
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

purchasingRoutes.post('/payments', requirePermission('purchasing.pay'), (req: Request, res: Response) => {
  try {
    res.json({
      payment: recordSupplierPayment(getDatabase(), { ...(req.body ?? {}), created_by: actor(req) }),
    });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.get('/payments', requirePermission('purchasing.view'), (req: Request, res: Response) => {
  try {
    res.json({
      payments: listSupplierPayments(
        getDatabase(),
        typeof req.query.supplier_id === 'string' ? req.query.supplier_id : undefined,
      ),
    });
  } catch (error) {
    sendError(res, error);
  }
});

purchasingRoutes.get('/balances/:supplierId', requirePermission('purchasing.view'), (req: Request, res: Response) => {
  try {
    res.json({ balance: supplierBalance(getDatabase(), String(req.params.supplierId)) });
  } catch (error) {
    sendError(res, error);
  }
});
