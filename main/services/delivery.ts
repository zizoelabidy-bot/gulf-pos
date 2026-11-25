/**
 * Delivery management: zones, drivers, order assignment workflow, and
 * driver cash (COD) settlement.
 *
 * Money is stored in major currency units and rounded to the tenant
 * currency's fraction digits (3 for KWD) with Decimal half-up, the same
 * policy the supplies ledger uses.
 */
import { randomBytes } from 'crypto';
import Decimal from 'decimal.js';
import { getDatabase, now, withTxn } from '../db';
import { getCurrencyFractionDigits } from '../countries';
import { getTenantCurrency } from './refund';

export class DeliveryServiceError extends Error {
  statusCode: number;
  diagnosticCode?: string;
  constructor(statusCode: number, message: string, diagnosticCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.diagnosticCode = diagnosticCode;
  }
}

export type DeliveryAssignmentStatus =
  | 'assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned'
  | 'cancelled';

const OPEN_STATUSES: DeliveryAssignmentStatus[] = ['assigned', 'out_for_delivery'];

function roundMoney(db: ReturnType<typeof getDatabase>, value: number | Decimal): number {
  let digits = 2;
  try {
    digits = getCurrencyFractionDigits(getTenantCurrency(db));
  } catch {
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'currency'")
        .get() as { value?: string | null } | undefined;
      digits = getCurrencyFractionDigits(row?.value || '');
    } catch {
      digits = 2;
    }
  }
  const rounded = new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toNumber();
  return Object.is(rounded, -0) ? 0 : rounded;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function cleanText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new DeliveryServiceError(400, 'text fields must be strings');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new DeliveryServiceError(400, `text exceeds ${max} characters`);
  return trimmed;
}

function cleanAmount(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1_000_000) {
    throw new DeliveryServiceError(400, `${field} must be a number between 0 and 1000000`);
  }
  return num;
}

// ── Zones ──────────────────────────────────────────────────────────────────

export function listDeliveryZones(db: ReturnType<typeof getDatabase>, includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM delivery_zones ORDER BY name_ar COLLATE NOCASE, id'
    : 'SELECT * FROM delivery_zones WHERE active = 1 ORDER BY name_ar COLLATE NOCASE, id';
  return db.prepare(sql).all();
}

export function saveDeliveryZone(
  db: ReturnType<typeof getDatabase>,
  input: { id?: string; name_ar?: unknown; name_en?: unknown; fee?: unknown; active?: unknown },
) {
  const nameAr = cleanText(input.name_ar, 120);
  if (!nameAr) throw new DeliveryServiceError(400, 'zone name (Arabic) is required');
  const nameEn = cleanText(input.name_en, 120);
  const fee = roundMoney(db, cleanAmount(input.fee, 'fee'));
  const ts = now();
  if (input.id) {
    const existing = db.prepare('SELECT id FROM delivery_zones WHERE id = ?').get(input.id);
    if (!existing) throw new DeliveryServiceError(404, 'zone not found');
    const active = input.active === undefined ? undefined : input.active ? 1 : 0;
    if (active === undefined) {
      db.prepare(
        'UPDATE delivery_zones SET name_ar = ?, name_en = ?, fee = ?, updated_at = ? WHERE id = ?',
      ).run(nameAr, nameEn, fee, ts, input.id);
    } else {
      db.prepare(
        'UPDATE delivery_zones SET name_ar = ?, name_en = ?, fee = ?, active = ?, updated_at = ? WHERE id = ?',
      ).run(nameAr, nameEn, fee, active, ts, input.id);
    }
    return db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(input.id);
  }
  const id = newId('zone');
  db.prepare(
    'INSERT INTO delivery_zones (id, name_ar, name_en, fee, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
  ).run(id, nameAr, nameEn, fee, ts, ts);
  return db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(id);
}

// ── Drivers ────────────────────────────────────────────────────────────────

export function listDeliveryDrivers(db: ReturnType<typeof getDatabase>, includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM delivery_drivers ORDER BY name COLLATE NOCASE, id'
    : 'SELECT * FROM delivery_drivers WHERE active = 1 ORDER BY name COLLATE NOCASE, id';
  return db.prepare(sql).all();
}

export function saveDeliveryDriver(
  db: ReturnType<typeof getDatabase>,
  input: { id?: string; name?: unknown; phone?: unknown; notes?: unknown; active?: unknown },
) {
  const name = cleanText(input.name, 120);
  if (!name) throw new DeliveryServiceError(400, 'driver name is required');
  const phone = cleanText(input.phone, 40);
  const notes = cleanText(input.notes, 500);
  const ts = now();
  if (input.id) {
    const existing = db.prepare('SELECT id FROM delivery_drivers WHERE id = ?').get(input.id);
    if (!existing) throw new DeliveryServiceError(404, 'driver not found');
    const active = input.active === undefined ? undefined : input.active ? 1 : 0;
    if (active === undefined) {
      db.prepare(
        'UPDATE delivery_drivers SET name = ?, phone = ?, notes = ?, updated_at = ? WHERE id = ?',
      ).run(name, phone, notes, ts, input.id);
    } else {
      db.prepare(
        'UPDATE delivery_drivers SET name = ?, phone = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?',
      ).run(name, phone, notes, active, ts, input.id);
    }
    return db.prepare('SELECT * FROM delivery_drivers WHERE id = ?').get(input.id);
  }
  const id = newId('drv');
  db.prepare(
    'INSERT INTO delivery_drivers (id, name, phone, active, notes, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run(id, name, phone, notes, ts, ts);
  return db.prepare('SELECT * FROM delivery_drivers WHERE id = ?').get(id);
}

// ── Assignments ────────────────────────────────────────────────────────────

export function listDeliveryAssignments(
  db: ReturnType<typeof getDatabase>,
  filter: { status?: string; driver_id?: string; date?: string },
) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push('a.status = ?');
    args.push(filter.status);
  }
  if (filter.driver_id) {
    where.push('a.driver_id = ?');
    args.push(filter.driver_id);
  }
  if (filter.date) {
    where.push('substr(a.assigned_at, 1, 10) = ?');
    args.push(filter.date);
  }
  const sql = `
    SELECT a.*, o.order_number, o.total, o.delivery_address, o.delivery_note,
           d.name AS driver_name, z.name_ar AS zone_name_ar, z.name_en AS zone_name_en
    FROM delivery_assignments a
    JOIN orders o ON o.id = a.order_id
    LEFT JOIN delivery_drivers d ON d.id = a.driver_id
    LEFT JOIN delivery_zones z ON z.id = a.zone_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC
    LIMIT 500`;
  return db.prepare(sql).all(...args);
}

export function assignDeliveryOrder(
  db: ReturnType<typeof getDatabase>,
  input: {
    order_id?: unknown;
    driver_id?: unknown;
    zone_id?: unknown;
    cod_amount?: unknown;
    note?: unknown;
    assigned_by?: string | null;
  },
) {
  let orderId = Number(input.order_id);
  if ((!Number.isInteger(orderId) || orderId <= 0) && (input as { order_number?: unknown }).order_number) {
    const byNumber = db
      .prepare('SELECT id FROM orders WHERE order_number = ?')
      .get(String((input as { order_number?: unknown }).order_number).trim()) as
      | { id: number }
      | undefined;
    if (byNumber) orderId = byNumber.id;
  }
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new DeliveryServiceError(400, 'order_id or order_number is required');
  }
  const driverId = cleanText(input.driver_id, 80);
  if (!driverId) throw new DeliveryServiceError(400, 'driver_id is required');
  const zoneId = cleanText(input.zone_id, 80);
  const note = cleanText(input.note, 500);

  return withTxn(() => {
    const order = db
      .prepare('SELECT id, type, status, total FROM orders WHERE id = ?')
      .get(orderId) as { id: number; type: string; status: string; total: number } | undefined;
    if (!order) throw new DeliveryServiceError(404, 'order not found');
    if (order.type !== 'delivery') {
      throw new DeliveryServiceError(400, 'only delivery orders can be assigned', 'not_delivery_order');
    }
    const driver = db
      .prepare('SELECT id, active FROM delivery_drivers WHERE id = ?')
      .get(driverId) as { id: string; active: number } | undefined;
    if (!driver) throw new DeliveryServiceError(404, 'driver not found');
    if (!driver.active) throw new DeliveryServiceError(400, 'driver is inactive');
    if (zoneId) {
      const zone = db.prepare('SELECT id FROM delivery_zones WHERE id = ?').get(zoneId);
      if (!zone) throw new DeliveryServiceError(404, 'zone not found');
    }
    const open = db
      .prepare(
        `SELECT id FROM delivery_assignments WHERE order_id = ? AND status IN ('assigned','out_for_delivery')`,
      )
      .get(orderId);
    if (open) {
      throw new DeliveryServiceError(409, 'order already has an open delivery assignment', 'already_assigned');
    }
    const cod = roundMoney(db, input.cod_amount === undefined || input.cod_amount === null || input.cod_amount === '' ? order.total : cleanAmount(input.cod_amount, 'cod_amount'));
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO delivery_assignments
          (order_id, driver_id, zone_id, status, cod_amount, note, assigned_by, assigned_at, created_at, updated_at)
         VALUES (?, ?, ?, 'assigned', ?, ?, ?, ?, ?, ?)`,
      )
      .run(orderId, driverId, zoneId, cod, note, input.assigned_by ?? null, ts, ts, ts);
    return db
      .prepare('SELECT * FROM delivery_assignments WHERE id = ?')
      .get(Number(result.lastInsertRowid));
  });
}

const STATUS_TRANSITIONS: Record<DeliveryAssignmentStatus, DeliveryAssignmentStatus[]> = {
  assigned: ['out_for_delivery', 'cancelled', 'returned'],
  out_for_delivery: ['delivered', 'returned', 'cancelled'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function updateDeliveryAssignmentStatus(
  db: ReturnType<typeof getDatabase>,
  assignmentId: number,
  input: { status?: unknown; collected_amount?: unknown },
) {
  const next = input.status as DeliveryAssignmentStatus;
  const valid: DeliveryAssignmentStatus[] = ['assigned', 'out_for_delivery', 'delivered', 'returned', 'cancelled'];
  if (!valid.includes(next)) throw new DeliveryServiceError(400, 'invalid status');
  return withTxn(() => {
    const row = db
      .prepare('SELECT * FROM delivery_assignments WHERE id = ?')
      .get(assignmentId) as
      | { id: number; status: DeliveryAssignmentStatus; settlement_id: number | null }
      | undefined;
    if (!row) throw new DeliveryServiceError(404, 'assignment not found');
    if (row.settlement_id) throw new DeliveryServiceError(409, 'assignment is already settled');
    if (!STATUS_TRANSITIONS[row.status].includes(next)) {
      throw new DeliveryServiceError(
        409,
        `cannot move from ${row.status} to ${next}`,
        'invalid_transition',
      );
    }
    const ts = now();
    let collected: number | null = null;
    if (next === 'delivered') {
      collected = roundMoney(db, cleanAmount(input.collected_amount, 'collected_amount'));
      db.prepare(
        `UPDATE delivery_assignments SET status = ?, collected_amount = ?, delivered_at = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
      ).run(next, collected, ts, ts, ts, assignmentId);
    } else if (next === 'out_for_delivery') {
      db.prepare(
        `UPDATE delivery_assignments SET status = ?, out_at = ?, updated_at = ? WHERE id = ?`,
      ).run(next, ts, ts, assignmentId);
    } else {
      db.prepare(
        `UPDATE delivery_assignments SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
      ).run(next, ts, ts, assignmentId);
    }
    return db.prepare('SELECT * FROM delivery_assignments WHERE id = ?').get(assignmentId);
  });
}

// ── Settlements ────────────────────────────────────────────────────────────

export function driverCashSummary(db: ReturnType<typeof getDatabase>, driverId: string, date: string) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'delivered' AND settlement_id IS NULL THEN cod_amount ELSE 0 END), 0) AS expected_cash,
         COALESCE(SUM(CASE WHEN status = 'delivered' AND settlement_id IS NULL THEN collected_amount ELSE 0 END), 0) AS collected_cash,
         COUNT(CASE WHEN status = 'delivered' AND settlement_id IS NULL THEN 1 END) AS delivered_count
       FROM delivery_assignments
       WHERE driver_id = ? AND substr(assigned_at, 1, 10) = ?`,
    )
    .get(driverId, date) as { expected_cash: number; collected_cash: number; delivered_count: number };
  return {
    driver_id: driverId,
    business_date: date,
    expected_cash: roundMoney(db, row.expected_cash),
    collected_cash: roundMoney(db, row.collected_cash),
    delivered_count: row.delivered_count,
  };
}

export function settleDriverCash(
  db: ReturnType<typeof getDatabase>,
  input: { driver_id?: unknown; business_date?: unknown; settled_by?: string | null },
) {
  const driverId = cleanText(input.driver_id, 80);
  if (!driverId) throw new DeliveryServiceError(400, 'driver_id is required');
  const date = cleanText(input.business_date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new DeliveryServiceError(400, 'business_date must be YYYY-MM-DD');
  }
  return withTxn(() => {
    const existing = db
      .prepare('SELECT id FROM delivery_settlements WHERE driver_id = ? AND business_date = ?')
      .get(driverId, date);
    if (existing) throw new DeliveryServiceError(409, 'driver already settled for this date', 'already_settled');
    const summary = driverCashSummary(db, driverId, date);
    const difference = roundMoney(db, new Decimal(summary.collected_cash).minus(summary.expected_cash));
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO delivery_settlements
          (driver_id, business_date, expected_cash, collected_cash, difference, status, settled_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'settled', ?, ?)`,
      )
      .run(driverId, date, summary.expected_cash, summary.collected_cash, difference, input.settled_by ?? null, ts);
    const settlementId = Number(result.lastInsertRowid);
    db.prepare(
      `UPDATE delivery_assignments SET settlement_id = ?, updated_at = ?
       WHERE driver_id = ? AND substr(assigned_at, 1, 10) = ? AND status = 'delivered' AND settlement_id IS NULL`,
    ).run(settlementId, ts, driverId, date);
    return db.prepare('SELECT * FROM delivery_settlements WHERE id = ?').get(settlementId);
  });
}

export function listDeliverySettlements(db: ReturnType<typeof getDatabase>, driverId?: string) {
  if (driverId) {
    return db
      .prepare(
        `SELECT s.*, d.name AS driver_name FROM delivery_settlements s
         LEFT JOIN delivery_drivers d ON d.id = s.driver_id
         WHERE s.driver_id = ? ORDER BY s.business_date DESC, s.id DESC LIMIT 200`,
      )
      .all(driverId);
  }
  return db
    .prepare(
      `SELECT s.*, d.name AS driver_name FROM delivery_settlements s
       LEFT JOIN delivery_drivers d ON d.id = s.driver_id
       ORDER BY s.business_date DESC, s.id DESC LIMIT 200`,
    )
    .all();
}
