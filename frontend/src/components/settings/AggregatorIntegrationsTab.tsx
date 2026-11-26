'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'use-intl';
import { Plug, Loader2, RefreshCw, Trash2, Plus, ExternalLink, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsTabShell } from '@/components/settings/SettingsTabShell';
import { Toggle } from '@/components/settings/Toggle';
import api from '@/lib/api';
import { isAxiosError } from 'axios';
import toast from 'react-hot-toast';

// Inline en/ar dictionary: aggregator integrations are an Arabic-first GULF POS
// feature and its strings are not part of the upstream 32-locale gate.
const dict = {
  en: {
    title: 'Delivery platform integrations',
    description: 'Receive orders from Talabat, Keeta, Deliveroo and Jahez directly into the POS.',
    enable: 'Enabled',
    autoAccept: 'Auto-accept new orders',
    clientId: 'Client ID',
    clientSecret: 'Client secret',
    storeId: 'Store / vendor ID',
    branchId: 'Branch ID',
    webhookSecret: 'Webhook secret',
    branchMapping: 'Branch mapping',
    secretSet: 'Saved (enter a new value to replace)',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Integration settings saved',
    test: 'Test connection',
    testing: 'Testing...',
    statusConfigured: 'Configured',
    statusIncomplete: 'Incomplete',
    statusDisabled: 'Disabled',
    readinessDocumented: 'Ready - public API (needs your platform credentials)',
    readinessPortal: 'Developer portal registration required',
    readinessPartner: 'Needs partnership with the platform first',
    requirements: 'What you need from the platform',
    docs: 'Platform documentation',
    webhookUrl: 'Webhook URL to give the platform',
    webhookHint: 'The platform pushes new orders to this address. It must be reachable from the internet (public URL or tunnel).',
    events: 'Integration log',
    noEvents: 'No events yet',
    itemMap: 'Item mapping (platform item ID -> POS product ID)',
    externalId: 'Platform item ID',
    productId: 'POS product ID',
    addMapping: 'Add',
    mappingSaved: 'Mapping saved',
    loadFailed: 'Could not load integrations',
    refresh: 'Refresh',
    copy: 'Copy',
    copied: 'Copied',
    colTime: 'Time',
    colPlatform: 'Platform',
    colEvent: 'Event',
    colOrder: 'Order',
    colDetail: 'Detail',
  },
  ar: {
    title: 'ربط منصات التوصيل',
    description: 'استقبال طلبات طلبات وكيتا وديليفرو وجاهز مباشرة داخل نقطة البيع.',
    enable: 'مفعّل',
    autoAccept: 'قبول الطلبات الجديدة تلقائياً',
    clientId: 'معرّف العميل (Client ID)',
    clientSecret: 'سر العميل (Client Secret)',
    storeId: 'معرّف المتجر / البائع',
    branchId: 'معرّف الفرع',
    webhookSecret: 'سر الويب هوك (Webhook Secret)',
    branchMapping: 'ربط الفروع',
    secretSet: 'محفوظ (أدخل قيمة جديدة للاستبدال)',
    save: 'حفظ',
    saving: 'جارٍ الحفظ...',
    saved: 'تم حفظ إعدادات التكامل',
    test: 'اختبار الاتصال',
    testing: 'جارٍ الاختبار...',
    statusConfigured: 'مكتمل',
    statusIncomplete: 'ناقص',
    statusDisabled: 'معطّل',
    readinessDocumented: 'جاهز - واجهة برمجية عامة (يحتاج بيانات اعتمادك من المنصة)',
    readinessPortal: 'يتطلب التسجيل في بوابة المطورين',
    readinessPartner: 'يتطلب شراكة مع المنصة أولاً',
    requirements: 'ما تحتاجه من المنصة',
    docs: 'وثائق المنصة',
    webhookUrl: 'عنوان الويب هوك الذي تعطيه للمنصة',
    webhookHint: 'المنصة ترسل الطلبات الجديدة إلى هذا العنوان. يجب أن يكون متاحاً من الإنترنت (عنوان عام أو نفق).',
    events: 'سجل التكامل',
    noEvents: 'لا أحداث بعد',
    itemMap: 'ربط الأصناف (معرّف الصنف في المنصة <- معرّف المنتج في نقطة البيع)',
    externalId: 'معرّف الصنف في المنصة',
    productId: 'معرّف المنتج في نقطة البيع',
    addMapping: 'إضافة',
    mappingSaved: 'تم حفظ الربط',
    loadFailed: 'تعذّر تحميل إعدادات التكامل',
    refresh: 'تحديث',
    copy: 'نسخ',
    copied: 'تم النسخ',
    colTime: 'الوقت',
    colPlatform: 'المنصة',
    colEvent: 'الحدث',
    colOrder: 'الطلب',
    colDetail: 'التفاصيل',
  },
} as const;

type DictKey = keyof (typeof dict)['en'];

interface PlatformView {
  platform: string;
  displayName: string;
  docsUrl: string;
  readiness: 'documented' | 'partner-portal' | 'needs-partner';
  partnerRequirements: string[];
  enabled: boolean;
  clientId: string | null;
  storeId: string | null;
  branchId: string | null;
  branchMapping: string | null;
  autoAccept: boolean;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  status: string;
  lastError: string | null;
}

interface EventRow {
  id: number;
  platform: string;
  kind: string;
  external_order_id: string | null;
  detail: string | null;
  created_at: string;
}

interface MapRow {
  external_item_id: string;
  product_id: string;
  external_name: string | null;
}

interface DraftState {
  enabled: boolean;
  autoAccept: boolean;
  clientId: string;
  clientSecret: string;
  storeId: string;
  branchId: string;
  webhookSecret: string;
  branchMapping: string;
}

function draftFrom(p: PlatformView): DraftState {
  return {
    enabled: p.enabled,
    autoAccept: p.autoAccept,
    clientId: p.clientId ?? '',
    clientSecret: '',
    storeId: p.storeId ?? '',
    branchId: p.branchId ?? '',
    webhookSecret: '',
    branchMapping: p.branchMapping ?? '',
  };
}

export function AggregatorIntegrationsTab({ isAdmin = true }: { isAdmin?: boolean }) {
  const locale = useLocale();
  const t = useCallback((k: DictKey) => (locale.startsWith('ar') ? dict.ar[k] : dict.en[k]), [locale]);

  const [platforms, setPlatforms] = useState<PlatformView[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [maps, setMaps] = useState<Record<string, MapRow[]>>({});
  const [newMap, setNewMap] = useState<Record<string, { externalItemId: string; productId: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfgRes, evRes] = await Promise.all([
        api.get('/integrations/aggregators'),
        api.get('/integrations/aggregators/events'),
      ]);
      const plats: PlatformView[] = cfgRes.data.platforms ?? [];
      setPlatforms(plats);
      setEvents(evRes.data.events ?? []);
      setDrafts(Object.fromEntries(plats.map((pp) => [pp.platform, draftFrom(pp)])));
      const mapEntries = await Promise.all(
        plats.map((p) => api.get(`/integrations/aggregators/${p.platform}/item-map`).then((r) => [p.platform, r.data.items ?? []] as const))
      );
      setMaps(Object.fromEntries(mapEntries));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const patch = (platform: string, partial: Partial<DraftState>) =>
    setDrafts((d) => ({ ...d, [platform]: { ...d[platform], ...partial } }));

  const save = async (p: PlatformView) => {
    const d = drafts[p.platform];
    if (!d) return;
    setSaving(p.platform);
    try {
      await api.put(`/integrations/aggregators/${p.platform}`, {
        enabled: d.enabled,
        autoAccept: d.autoAccept,
        clientId: d.clientId || null,
        storeId: d.storeId || null,
        branchId: d.branchId || null,
        branchMapping: d.branchMapping || null,
        ...(d.clientSecret ? { clientSecret: d.clientSecret } : {}),
        ...(d.webhookSecret ? { webhookSecret: d.webhookSecret } : {}),
      });
      toast.success(t('saved'));
      await load();
    } catch (e: unknown) {
      toast.error((isAxiosError<{ error?: string }>(e) ? e.response?.data?.error : undefined) ?? t('loadFailed'));
    } finally {
      setSaving(null);
    }
  };

  const test = async (p: PlatformView) => {
    setTesting(p.platform);
    try {
      const res = await api.post(`/integrations/aggregators/${p.platform}/test`);
      if (res.data.ok) toast.success(res.data.message); else toast.error(res.data.message);
      await load();
    } catch (e: unknown) {
      toast.error((isAxiosError<{ error?: string }>(e) ? e.response?.data?.error : undefined) ?? t('loadFailed'));
    } finally {
      setTesting(null);
    }
  };

  const addMapping = async (platform: string) => {
    const nm = newMap[platform];
    if (!nm?.externalItemId || !nm?.productId) return;
    await api.put(`/integrations/aggregators/${platform}/item-map`, nm);
    toast.success(t('mappingSaved'));
    setNewMap((m) => ({ ...m, [platform]: { externalItemId: '', productId: '' } }));
    await load();
  };

  const removeMapping = async (platform: string, externalItemId: string) => {
    await api.delete(`/integrations/aggregators/${platform}/item-map/${encodeURIComponent(externalItemId)}`);
    await load();
  };

  const copyWebhook = (platform: string) => {
    const url = `${window.location.origin}/api/integrations/webhook/${platform}`;
    navigator.clipboard.writeText(url);
    toast.success(t('copied'));
  };

  const readinessLabel = (r: PlatformView['readiness']) =>
    r === 'documented' ? t('readinessDocumented') : r === 'partner-portal' ? t('readinessPortal') : t('readinessPartner');
  const statusLabel = (s: string) =>
    s === 'configured' ? t('statusConfigured') : s === 'incomplete' ? t('statusIncomplete') : t('statusDisabled');

  const inputCls =
    'w-full min-h-[44px] rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60';
  const labelCls = 'block text-sm font-medium text-muted-foreground mb-1';

  if (loading) {
    return (
      <SettingsTabShell title={t('title')}>
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={18} /></div>
      </SettingsTabShell>
    );
  }

  return (
    <SettingsTabShell title={t('title')} maxWidth="wide">
      <p className="text-sm text-muted-foreground">{t('description')}</p>

      {platforms.map((p) => {
        const d = drafts[p.platform];
        if (!d) return null;
        const statusColor =
          p.status === 'configured' ? 'text-green-600' : p.status === 'incomplete' ? 'text-amber-600' : 'text-muted-foreground';
        return (
          <section key={p.platform} className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid={`aggregator-card-${p.platform}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Plug size={20} className="text-brand" />
                <h3 className="text-base font-semibold">{p.displayName}</h3>
                <span className={`text-sm font-medium ${statusColor}`}>{statusLabel(p.status)}</span>
                <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{readinessLabel(p.readiness)}</span>
              </div>
              <Toggle value={d.enabled} onChange={(v) => patch(p.platform, { enabled: v })} label={`${t('enable')} ${p.displayName}`} disabled={!isAdmin} dataTestId={`aggregator-enable-${p.platform}`} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('clientId')}</label>
                <input className={inputCls} value={d.clientId} disabled={!isAdmin} onChange={(e) => patch(p.platform, { clientId: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className={labelCls}>{t('clientSecret')}</label>
                <input className={inputCls} type="password" placeholder={p.hasClientSecret ? t('secretSet') : ''} value={d.clientSecret} disabled={!isAdmin} onChange={(e) => patch(p.platform, { clientSecret: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className={labelCls}>{t('storeId')}</label>
                <input className={inputCls} value={d.storeId} disabled={!isAdmin} onChange={(e) => patch(p.platform, { storeId: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className={labelCls}>{t('branchId')}</label>
                <input className={inputCls} value={d.branchId} disabled={!isAdmin} onChange={(e) => patch(p.platform, { branchId: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className={labelCls}>{t('webhookSecret')}</label>
                <input className={inputCls} type="password" placeholder={p.hasWebhookSecret ? t('secretSet') : ''} value={d.webhookSecret} disabled={!isAdmin} onChange={(e) => patch(p.platform, { webhookSecret: e.target.value })} dir="ltr" />
              </div>
              <div>
                <label className={labelCls}>{t('branchMapping')}</label>
                <input className={inputCls} value={d.branchMapping} disabled={!isAdmin} onChange={(e) => patch(p.platform, { branchMapping: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Toggle value={d.autoAccept} onChange={(v) => patch(p.platform, { autoAccept: v })} label={t('autoAccept')} disabled={!isAdmin} />
                {t('autoAccept')}
              </label>
            </div>

            <div className="rounded-md bg-muted p-3 text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{t('webhookUrl')}:</span>
                <code dir="ltr" className="select-all">{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/integrations/webhook/${p.platform}`}</code>
                <button type="button" className="text-brand hover:underline" onClick={() => copyWebhook(p.platform)}>{t('copy')}</button>
              </div>
              <p className="text-muted-foreground">{t('webhookHint')}</p>
            </div>

            {p.lastError && <p className="text-sm text-amber-600">{p.lastError}</p>}

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t('requirements')}</summary>
              <ul className="list-disc ps-5 mt-1 space-y-0.5 text-muted-foreground">
                {p.partnerRequirements.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {p.docsUrl && (
                <a href={p.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand hover:underline" dir="ltr">
                  <ExternalLink size={14} /> {t('docs')}
                </a>
              )}
            </details>

            <div className="flex gap-2">
              <Button onClick={() => save(p)} disabled={!isAdmin || saving === p.platform} className="min-h-[44px]">
                {saving === p.platform ? t('saving') : t('save')}
              </Button>
              <Button variant="outline" onClick={() => test(p)} disabled={testing === p.platform} className="min-h-[44px]">
                {testing === p.platform ? <Loader2 className="animate-spin" size={16} /> : p.status === 'configured' ? <Wifi size={16} /> : <WifiOff size={16} />}
                <span className="ms-2">{testing === p.platform ? t('testing') : t('test')}</span>
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t('itemMap')}</h4>
              {(maps[p.platform] ?? []).map((m) => (
                <div key={m.external_item_id} className="flex items-center gap-2 text-sm">
                  <code dir="ltr" className="rounded bg-muted px-2 py-1">{m.external_item_id}</code>
                  <span>&rarr;</span>
                  <code dir="ltr" className="rounded bg-muted px-2 py-1">{m.product_id}</code>
                  {isAdmin && (
                    <button type="button" className="text-red-500 hover:text-red-600" onClick={() => removeMapping(p.platform, m.external_item_id)} aria-label="remove">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputCls} w-48`}
                    placeholder={t('externalId')}
                    dir="ltr"
                    value={newMap[p.platform]?.externalItemId ?? ''}
                    onChange={(e) => setNewMap((m) => ({ ...m, [p.platform]: { externalItemId: e.target.value, productId: m[p.platform]?.productId ?? '' } }))}
                  />
                  <input
                    className={`${inputCls} w-48`}
                    placeholder={t('productId')}
                    dir="ltr"
                    value={newMap[p.platform]?.productId ?? ''}
                    onChange={(e) => setNewMap((m) => ({ ...m, [p.platform]: { externalItemId: m[p.platform]?.externalItemId ?? '', productId: e.target.value } }))}
                  />
                  <Button variant="outline" className="min-h-[44px]" onClick={() => addMapping(p.platform)}>
                    <Plus size={16} /> <span className="ms-1">{t('addMapping')}</span>
                  </Button>
                </div>
              )}
            </div>
          </section>
        );
      })}

      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{t('events')}</h3>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} /> <span className="ms-1">{t('refresh')}</span></Button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noEvents')}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-muted-foreground">
                  <th className="text-start py-1">{t('colTime')}</th>
                  <th className="text-start">{t('colPlatform')}</th>
                  <th className="text-start">{t('colEvent')}</th>
                  <th className="text-start">{t('colOrder')}</th>
                  <th className="text-start">{t('colDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-1 pe-2 whitespace-nowrap" dir="ltr">{e.created_at}</td>
                    <td className="pe-2">{e.platform}</td>
                    <td className="pe-2" dir="ltr">{e.kind}</td>
                    <td className="pe-2" dir="ltr">{e.external_order_id ?? '-'}</td>
                    <td className="max-w-xs truncate" title={e.detail ?? ''} dir="ltr">{e.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SettingsTabShell>
  );
}
