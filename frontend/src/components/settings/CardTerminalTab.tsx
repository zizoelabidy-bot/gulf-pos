'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from 'use-intl';
import { CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsTabShell } from '@/components/settings/SettingsTabShell';
import { Toggle } from '@/components/settings/Toggle';
import api from '@/lib/api';
import toast from 'react-hot-toast';

// Inline en/ar dictionary (GULF-specific feature, not part of the upstream locale gate).
const dict = {
  en: {
    title: 'Payments terminal (Tap SmartPOS)',
    description: 'Configure and simulate Tap SmartPOS. Live payment initiation is blocked until certified.',
    enable: 'Enable card terminal',
    mode: 'Mode',
    simulator: 'Simulator (no real terminal, for training and testing)',
    live: 'Live configuration (charges blocked)',
    merchantId: 'Tap merchant ID',
    terminalId: 'Terminal ID',
    secretKey: 'Tap secret API key',
    secretSet: 'Saved (enter a new value to replace)',
    webhookBase: 'Public base URL of this POS (for Tap webhooks)',
    webhookHint: 'Tap sends the payment result to this address + /api/card-terminal/webhook. It must be reachable from the internet; localhost does not work.',
    need: 'What you need from Tap',
    needList: ['A Tap merchant account in Kuwait with the SmartPOS API enabled', 'A SmartPOS terminal (PAX A920Pro or A99) linked to that account', 'Your Tap merchant ID, terminal ID and secret API key'],
    liveNote: 'Live charges are blocked pending merchant certification. Use the separate physical card terminal and reconcile payments manually.',
    save: 'Save',
    saved: 'Saved',
    testTitle: 'Simulator test',
    testAmount: 'Amount (KWD)',
    start: 'Start test payment',
    approve: 'Approve (simulate)',
    decline: 'Decline (simulate)',
    cancel: 'Cancel',
    status: 'Status',
    txn: 'Transaction ref',
    loadFailed: 'Could not load terminal settings',
    s_disabled: 'Disabled', s_simulator: 'Simulator', s_configured: 'Configured', s_unverified: 'Not certified', s_incomplete: 'Incomplete',
  },
  ar: {
    title: 'جهاز الدفع بالبطاقات (Tap SmartPOS)',
    description: 'إعداد ومحاكاة Tap SmartPOS. بدء المدفوعات الفعلية محظور حتى الاعتماد.',
    enable: 'تفعيل جهاز البطاقات',
    mode: 'الوضع',
    simulator: 'تجريبي (بدون جهاز حقيقي، للتدريب والاختبار)',
    live: 'إعداد فعلي (الدفع محظور)',
    merchantId: 'معرّف التاجر في Tap',
    terminalId: 'معرّف الجهاز',
    secretKey: 'المفتاح السري لـ Tap (Secret API key)',
    secretSet: 'محفوظ (أدخل قيمة جديدة للاستبدال)',
    webhookBase: 'العنوان العام لنقطة البيع (لاستقبال إشعارات Tap)',
    webhookHint: 'ترسل Tap نتيجة الدفع إلى هذا العنوان + /api/card-terminal/webhook. يجب أن يكون متاحاً من الإنترنت ولا يعمل localhost.',
    need: 'ما تحتاجه من Tap',
    needList: ['حساب تاجر في Tap بالكويت مع تفعيل واجهة SmartPOS', 'جهاز SmartPOS (PAX A920Pro أو A99) مرتبط بالحساب', 'معرّف التاجر ومعرّف الجهاز والمفتاح السري'],
    liveNote: 'الدفع الفعلي محظور حتى اعتماد التكامل مع التاجر. استخدم جهاز الدفع المستقل وطابق المدفوعات يدويًا.',
    save: 'حفظ',
    saved: 'تم الحفظ',
    testTitle: 'اختبار تجريبي',
    testAmount: 'المبلغ (د.ك)',
    start: 'بدء دفعة تجريبية',
    approve: 'موافقة (محاكاة)',
    decline: 'رفض (محاكاة)',
    cancel: 'إلغاء',
    status: 'الحالة',
    txn: 'رقم المعاملة',
    loadFailed: 'تعذّر تحميل إعدادات الجهاز',
    s_disabled: 'معطّل', s_simulator: 'تجريبي', s_configured: 'مُهيّأ', s_unverified: 'غير معتمد', s_incomplete: 'غير مكتمل',
  },
} as const;
type K = keyof (typeof dict)['en'];

interface Cfg { enabled: boolean; mode: 'simulator' | 'live'; merchantId: string | null; terminalId: string | null; secretKeySet: boolean; webhookBaseUrl: string | null; status: string; }
interface Intent { intent_id: string; status: string; amount: number; transaction_ref: string | null; }

export function CardTerminalTab({ isAdmin }: { isAdmin: boolean }) {
  const locale = useLocale();
  const lang = locale.startsWith('ar') ? 'ar' : 'en';
  const t = (k: K) => dict[lang][k] as string;
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [merchantId, setMerchantId] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [webhookBase, setWebhookBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('5.600');
  const [intent, setIntent] = useState<Intent | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/card-terminal/config');
      setCfg(r.data);
      setMerchantId(r.data.merchantId ?? '');
      setTerminalId(r.data.terminalId ?? '');
      setWebhookBase(r.data.webhookBaseUrl ?? '');
    } catch { toast.error(t('loadFailed')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const r = await api.put('/card-terminal/config', patch);
      setCfg(r.data);
      setSecretKey('');
      toast.success(t('saved'));
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  const act = async (fn: () => Promise<any>) => {
    try { const r = await fn(); if (r?.data?.intent_id) setIntent(r.data); else if (intent) { const g = await api.get(`/card-terminal/intents/${intent.intent_id}`); setIntent(g.data); } }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Error'); }
  };

  if (!cfg) return <SettingsTabShell><Loader2 className="h-5 w-5 animate-spin" /></SettingsTabShell>;
  const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  const statusLabel = t(('s_' + cfg.status) as K);

  return (
    <SettingsTabShell title={t('title')}>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <div className="rounded-lg border border-border bg-card p-4 space-y-4" data-testid="card-terminal-settings">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><CreditCard className="h-4 w-4" /><span className="font-medium">{statusLabel}</span></div>
          <Toggle value={cfg.enabled} onChange={(v) => save({ enabled: v })} label={t('enable')} disabled={!isAdmin} dataTestId="card-terminal-enable" />
        </div>
        <div>
          <label className="text-sm font-medium">{t('mode')}</label>
          <select className={inputCls} value={cfg.mode} disabled={!isAdmin} onChange={(e) => save({ mode: e.target.value })}>
            <option value="simulator">{t('simulator')}</option>
            <option value="live">{t('live')}</option>
          </select>
        </div>
        {cfg.mode === 'live' && (
          <>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t('liveNote')}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="text-sm font-medium">{t('merchantId')}</label><input className={inputCls} dir="ltr" value={merchantId} disabled={!isAdmin} onChange={(e) => setMerchantId(e.target.value)} /></div>
              <div><label className="text-sm font-medium">{t('terminalId')}</label><input className={inputCls} dir="ltr" value={terminalId} disabled={!isAdmin} onChange={(e) => setTerminalId(e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="text-sm font-medium">{t('secretKey')}</label><input className={inputCls} dir="ltr" type="password" placeholder={cfg.secretKeySet ? t('secretSet') : ''} value={secretKey} disabled={!isAdmin} onChange={(e) => setSecretKey(e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="text-sm font-medium">{t('webhookBase')}</label><input className={inputCls} dir="ltr" placeholder="https://pos.example.com" value={webhookBase} disabled={!isAdmin} onChange={(e) => setWebhookBase(e.target.value)} /><p className="mt-1 text-xs text-muted-foreground">{t('webhookHint')}</p></div>
            </div>
            <Button disabled={!isAdmin || saving} onClick={() => save({ merchantId, terminalId, webhookBaseUrl: webhookBase, ...(secretKey ? { secretKey } : {}) })}>{t('save')}</Button>
          </>
        )}
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div className="font-medium mb-1">{t('need')}</div>
          <ul className="list-disc ps-5 space-y-0.5">{(dict[lang].needList as readonly string[]).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      {cfg.mode === 'simulator' && cfg.enabled && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="card-terminal-sim">
          <div className="font-medium">{t('testTitle')}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="text-sm">{t('testAmount')}</label><input className={inputCls} dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Button onClick={() => act(() => api.post('/card-terminal/intents', { amount: Number(amount), orderRef: 'TEST' }))}>{t('start')}</Button>
          </div>
          {intent && (
            <div className="space-y-2 text-sm">
              <div>{t('status')}: <b>{intent.status}</b>{intent.transaction_ref ? <> · {t('txn')}: <span dir="ltr">{intent.transaction_ref}</span></> : null}</div>
              {intent.status === 'INITIATED' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => act(() => api.post(`/card-terminal/intents/${intent.intent_id}/simulate`, { outcome: 'CAPTURED' }))}>{t('approve')}</Button>
                  <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/card-terminal/intents/${intent.intent_id}/simulate`, { outcome: 'DECLINED' }))}>{t('decline')}</Button>
                  <Button size="sm" variant="outline" onClick={() => act(() => api.post(`/card-terminal/intents/${intent.intent_id}/cancel`))}>{t('cancel')}</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsTabShell>
  );
}
