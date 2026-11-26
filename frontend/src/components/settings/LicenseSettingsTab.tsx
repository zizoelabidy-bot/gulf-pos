'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'use-intl';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsTabShell } from '@/components/settings/SettingsTabShell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { isAxiosError } from 'axios';
import type { LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';

// Inline en/ar dictionary: GULF POS commercial licensing is an Arabic-first
// feature and its strings are not part of the upstream 32-locale gate.
const dict = {
  en: {
    title: 'License',
    description: 'GULF POS commercial license, issued and managed by GULF CCTV.',
    status: 'License status',
    type: 'Type',
    customer: 'Licensed to',
    expires: 'Expires',
    graceEnds: 'Grace period ends',
    trialEnds: 'Trial ends',
    devices: 'Devices',
    branches: 'Branches',
    modules: 'Modules',
    allModules: 'All modules',
    fingerprint: 'Device fingerprint',
    fingerprintHint:
      'GULF CCTV may ask for this code when issuing or transferring a license.',
    activateTitle: 'Activate a license key',
    activateHint: 'Paste the license key you received from GULF CCTV.',
    activate: 'Activate',
    activating: 'Activating...',
    activated: 'License activated',
    deactivate: 'Deactivate / transfer',
    deactivateConfirm:
      'Deactivate the license on this device? You will get a transfer receipt to give GULF CCTV so they can issue a key for a new device. Your data is never deleted.',
    cancel: 'Cancel',
    confirmDeactivate: 'Yes, deactivate',
    receiptTitle: 'Transfer receipt',
    receiptHint: 'Send this receipt to GULF CCTV to receive a key for your new device.',
    copied: 'Copied',
    perpetual: 'Perpetual',
    annual: 'Annual',
    trial: 'Trial',
    statusActive: 'Active',
    statusTrial: 'Trial',
    statusGrace: 'Grace period',
    statusExpired: 'Expired',
    expiredNote:
      'Your data, reports and export remain available. New sales are blocked until a license is activated.',
    never: 'Never',
    history: 'License history',
    refresh: 'Refresh',
    loadFailed: 'Could not load license status',
  },
  ar: {
    title: 'الترخيص',
    description: 'ترخيص GULF POS التجاري، يصدره ويديره فريق GULF CCTV.',
    status: 'حالة الترخيص',
    type: 'النوع',
    customer: 'مرخّص إلى',
    expires: 'تاريخ الانتهاء',
    graceEnds: 'تنتهي فترة السماح',
    trialEnds: 'تنتهي النسخة التجريبية',
    devices: 'الأجهزة',
    branches: 'الفروع',
    modules: 'الوحدات',
    allModules: 'كل الوحدات',
    fingerprint: 'بصمة الجهاز',
    fingerprintHint: 'قد يطلبها فريق GULF CCTV عند إصدار ترخيص أو نقله إلى جهاز آخر.',
    activateTitle: 'تفعيل مفتاح الترخيص',
    activateHint: 'الصق مفتاح الترخيص الذي استلمته من GULF CCTV.',
    activate: 'تفعيل',
    activating: 'جارٍ التفعيل...',
    activated: 'تم تفعيل الترخيص',
    deactivate: 'إلغاء التفعيل / نقل الترخيص',
    deactivateConfirm:
      'هل تريد إلغاء تفعيل الترخيص على هذا الجهاز؟ ستحصل على إيصال نقل ترسله إلى GULF CCTV لإصدار مفتاح للجهاز الجديد. بياناتك لن تُحذف أبداً.',
    cancel: 'إلغاء',
    confirmDeactivate: 'نعم، إلغاء التفعيل',
    receiptTitle: 'إيصال نقل الترخيص',
    receiptHint: 'أرسل هذا الإيصال إلى GULF CCTV للحصول على مفتاح للجهاز الجديد.',
    copied: 'تم النسخ',
    perpetual: 'دائم',
    annual: 'سنوي',
    trial: 'تجريبي',
    statusActive: 'مفعّل',
    statusTrial: 'تجريبي',
    statusGrace: 'فترة سماح',
    statusExpired: 'منتهي',
    expiredNote:
      'بياناتك وتقاريرك والتصدير تبقى متاحة دائماً. المبيعات الجديدة متوقفة حتى تفعيل ترخيص.',
    never: 'بدون انتهاء',
    history: 'سجل الترخيص',
    refresh: 'تحديث',
    loadFailed: 'تعذّر تحميل حالة الترخيص',
  },
} as const;

type DictKey = keyof (typeof dict)['en'];

interface LicensePayload {
  lic_id: string;
  customer: string;
  type: 'perpetual' | 'annual' | 'trial';
  issued_at: string;
  expires_at: string | null;
  max_devices: number;
  max_branches: number;
  modules: string[];
  devices: string[];
}

interface LicenseState {
  status: 'active' | 'trial' | 'grace' | 'expired';
  can_write: boolean;
  payload: LicensePayload | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  device_fingerprint: string;
  message: string | null;
}

interface LicenseEvent {
  kind: string;
  lic_id: string | null;
  detail: string | null;
  created_at: string;
}

export function LicenseSettingsTab() {
  const locale = useLocale();
  const t = useCallback(
    (key: DictKey): string => (locale.startsWith('ar') ? dict.ar[key] : dict.en[key]),
    [locale],
  );

  const [state, setState] = useState<LicenseState | null>(null);
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, eventsRes] = await Promise.all([
        api.get('/license/status'),
        api.get('/license/events'),
      ]);
      setState(statusRes.data);
      setEvents(eventsRes.data?.events || []);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const activate = async () => {
    if (!key.trim()) return;
    setActivating(true);
    try {
      const res = await api.post('/license/activate', { key: key.trim() });
      setState(res.data);
      setKey('');
      toast.success(t('activated'));
      load();
    } catch (error: unknown) {
      toast.error((isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined) || 'Activation failed');
    } finally {
      setActivating(false);
    }
  };

  const deactivate = async () => {
    setConfirmOpen(false);
    try {
      const res = await api.post('/license/deactivate');
      setReceipt(res.data?.transfer_receipt || null);
      load();
    } catch (error: unknown) {
      toast.error((isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined) || 'Deactivation failed');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      /* clipboard unavailable */
    }
  };

  const statusMeta: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
    active: {
      label: t('statusActive'),
      className: 'text-emerald-600 dark:text-emerald-400',
      Icon: ShieldCheck,
    },
    trial: { label: t('statusTrial'), className: 'text-sky-600 dark:text-sky-400', Icon: Clock },
    grace: {
      label: t('statusGrace'),
      className: 'text-amber-600 dark:text-amber-400',
      Icon: ShieldAlert,
    },
    expired: {
      label: t('statusExpired'),
      className: 'text-red-600 dark:text-red-400',
      Icon: ShieldAlert,
    },
  };

  const meta = state ? statusMeta[state.status] : null;
  const payload = state?.payload || null;
  const dateOrNever = (iso: string | null) => (iso ? iso.slice(0, 10) : t('never'));

  return (
    <SettingsTabShell>
      <div className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-brand" />
              {t('title')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{t('description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 me-1 ${loading ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </Button>
        </div>

        {loading && !state ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> ...
          </div>
        ) : state && meta ? (
          <>
            <div className="rounded-lg border border-border p-4">
              <div className={`flex items-center gap-2 font-semibold ${meta.className}`}>
                <meta.Icon className="h-5 w-5" />
                {t('status')}: {meta.label}
              </div>
              {state.message && (
                <p className="text-sm text-muted-foreground mt-1">{state.message}</p>
              )}
              {state.status === 'expired' && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">{t('expiredNote')}</p>
              )}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
                {payload && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('type')}</dt>
                      <dd className="font-medium text-foreground">{t(payload.type)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('customer')}</dt>
                      <dd className="font-medium text-foreground">{payload.customer}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('expires')}</dt>
                      <dd className="font-medium text-foreground">
                        {dateOrNever(payload.expires_at)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('devices')}</dt>
                      <dd className="font-medium text-foreground">{payload.max_devices}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('branches')}</dt>
                      <dd className="font-medium text-foreground">{payload.max_branches}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">{t('modules')}</dt>
                      <dd className="font-medium text-foreground">
                        {payload.modules.includes('*')
                          ? t('allModules')
                          : payload.modules.join(', ')}
                      </dd>
                    </div>
                  </>
                )}
                {state.status === 'trial' && state.trial_ends_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('trialEnds')}</dt>
                    <dd className="font-medium text-foreground">{state.trial_ends_at.slice(0, 10)}</dd>
                  </div>
                )}
                {state.status === 'grace' && state.grace_ends_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('graceEnds')}</dt>
                    <dd className="font-medium text-foreground">{state.grace_ends_at.slice(0, 10)}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-lg border border-border p-4">
              <div className="text-sm text-muted-foreground">{t('fingerprint')}</div>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm font-mono text-foreground break-all" dir="ltr">
                  {state.device_fingerprint}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(state.device_fingerprint)}
                  aria-label={t('copied')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('fingerprintHint')}</p>
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3">
              <h3 className="font-medium text-foreground">{t('activateTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('activateHint')}</p>
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                rows={3}
                dir="ltr"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
                placeholder="GPL1...."
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={activate} disabled={activating || !key.trim()}>
                  {activating && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
                  {activating ? t('activating') : t('activate')}
                </Button>
                {state.status !== 'trial' && state.payload && (
                  <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                    {t('deactivate')}
                  </Button>
                )}
              </div>
            </div>

            {events.length > 0 && (
              <div className="rounded-lg border border-border p-4">
                <h3 className="font-medium text-foreground mb-2">{t('history')}</h3>
                <ul className="text-xs text-muted-foreground space-y-1" dir="ltr">
                  {events.slice(0, 20).map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-foreground">{e.created_at.slice(0, 19).replace('T', ' ')}</span>
                      <span>{e.kind}</span>
                      {e.lic_id && <span>{e.lic_id}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deactivate')}</DialogTitle>
            <DialogDescription>{t('deactivateConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={deactivate}>
              {t('confirmDeactivate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receipt} onOpenChange={() => setReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('receiptTitle')}</DialogTitle>
            <DialogDescription>{t('receiptHint')}</DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono break-all rounded-md border border-border bg-background p-3 flex-1" dir="ltr">
                {receipt}
              </code>
              <Button variant="ghost" size="sm" onClick={() => copy(receipt)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setReceipt(null)}>{t('cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsTabShell>
  );
}
