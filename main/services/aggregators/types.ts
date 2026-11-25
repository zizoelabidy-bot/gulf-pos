/**
 * GULF POS - aggregator integration framework.
 * One adapter per delivery platform. Adapters map platform payloads to a
 * canonical order, verify inbound webhook signatures, and describe outbound
 * status payloads. Adapters never read the database or perform network I/O;
 * the service layer owns persistence and delivery.
 */
export type PlatformKey = 'talabat' | 'keeta' | 'deliveroo' | 'jahez';

export type AdapterReadiness =
  | 'documented' // public API docs; code-complete, needs merchant credentials
  | 'partner-portal' // public developer portal, registration required
  | 'needs-partner'; // no public docs; platform partnership required

export interface CanonicalItem {
  externalItemId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CanonicalOrder {
  externalOrderId: string;
  platform: PlatformKey;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  currency: string | null;
  items: CanonicalItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface AggregatorConfig {
  platform: PlatformKey;
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  storeId: string | null;
  branchId: string | null;
  webhookSecret: string | null;
  branchMapping: string | null;
  autoAccept: boolean;
}

export interface StatusUpdate {
  // null url means the platform endpoint is not publicly documented;
  // the service logs the payload instead of delivering it.
  url: string | null;
  method: 'POST' | 'PUT';
  body: Record<string, unknown>;
}

export interface PlatformAdapter {
  key: PlatformKey;
  displayName: string;
  docsUrl: string;
  readiness: AdapterReadiness;
  // What the owner must obtain from the platform before this adapter goes live.
  partnerRequirements: string[];
  mapInbound(payload: unknown): CanonicalOrder | null;
  verifySignature(rawBody: string, headers: Record<string, string>, secret: string | null): boolean;
  buildStatusUpdate(cfg: AggregatorConfig, externalOrderId: string, status: 'accepted' | 'rejected' | 'ready' | 'dispatched'): StatusUpdate | null;
  validateConfig(cfg: AggregatorConfig): { ok: boolean; message: string };
}

export function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function strList(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}
