import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  consumptionReport,
  FoodCostServiceError,
  itemProfitability,
  recipeCostHistory,
} from '../services/food-cost';
import { getRecipe } from '../services/recipes';

export const foodCostRoutes = Router();

function sendError(res: Response, error: unknown): void {
  const details = error as { statusCode?: unknown; message?: unknown };
  const statusCode = Number.isInteger(details.statusCode) ? (details.statusCode as number) : 500;
  if (statusCode >= 500) console.error('[API] Internal error:', error);
  res
    .status(statusCode)
    .json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
}

foodCostRoutes.get('/items', requirePermission('reports.view'), (_req: Request, res: Response) => {
  try {
    res.json({ items: itemProfitability(getDatabase()) });
  } catch (error) {
    sendError(res, error);
  }
});

foodCostRoutes.get('/consumption', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    res.json({ supplies: consumptionReport(getDatabase(), from, to) });
  } catch (error) {
    sendError(res, error);
  }
});

foodCostRoutes.get('/history/:recipeId', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const recipe = getRecipe(getDatabase(), String(req.params.recipeId));
    if (!recipe) throw new FoodCostServiceError(404, 'recipe not found');
    res.json({ history: recipeCostHistory(getDatabase(), recipe.id) });
  } catch (error) {
    sendError(res, error);
  }
});
