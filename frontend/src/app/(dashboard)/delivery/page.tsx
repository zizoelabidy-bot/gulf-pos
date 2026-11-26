'use client';

/**
 * Delivery management: drivers, zones, order assignment workflow and driver
 * COD settlement. Strings use an inline en/ar dictionary for this first
 * release; migration into the shared i18n message files is tracked work.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'use-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

const DICT = {
  en: {
    title: 'Delivery',
    board: 'Deliveries',
    zones: 'Zones',
    drivers: 'Drivers',
    settlements: 'Settlements',
    assignOrder: 'Assign order',
    orderNumber: 'Order number',
    driver: 'Driver',
    zone: 'Zone',
    codAmount: 'COD amount (optional)',
    note: 'Note',
    assign: 'Assign',
    status: 'Status',
    order: 'Order',
    address: 'Address',
    cod: 'COD',
    collected: 'Collected',
    actions: 'Actions',
    markOut: 'Out for delivery',
    markDelivered: 'Delivered',
    markReturned: 'Returned',
    cancelAssignment: 'Cancel',
    collectedAmount: 'Collected amount',
    confirm: 'Confirm',
    close: 'Close',
    addZone: 'Add zone',
    nameAr: 'Name (Arabic)',
    nameEn: 'Name (English)',
    fee: 'Delivery fee',
    save: 'Save',
    inactive: 'Inactive',
    addDriver: 'Add driver',
    name: 'Name',
    phone: 'Phone',
    notes: 'Notes',
    settleDriver: 'Settle driver cash',
    date: 'Date',
    expectedCash: 'Expected',
    collectedCash: 'Collected',
    difference: 'Difference',
    deliveredOrders: 'Delivered orders',
    settle: 'Settle',
    loadSummary: 'Load summary',
    history: 'History',
    assigned: 'Assigned',
    outForDelivery: 'Out for delivery',
    delivered: 'Delivered',
    returned: 'Returned',
    cancelled: 'Cancelled',
    empty: 'Nothing here yet',
    all: 'All',
    errorGeneric: 'Operation failed',
    settledOk: 'Settlement recorded',
  },
  ar: {
    title: 'التوصيل',
    board: 'الطلبات',
    zones: 'المناطق',
    drivers: 'المناديب',
    settlements: 'التسويات',
    assignOrder: 'تخصيص طلب',
    orderNumber: 'رقم الطلب',
    driver: 'المندوب',
    zone: 'المنطقة',
    codAmount: 'مبلغ التحصيل (اختياري)',
    note: 'ملاحظة',
    assign: 'تخصيص',
    status: 'الحالة',
    order: 'الطلب',
    address: 'العنوان',
    cod: 'التحصيل',
    collected: 'المُحصّل',
    actions: 'إجراءات',
    markOut: 'خرج للتوصيل',
    markDelivered: 'تم التوصيل',
    markReturned: 'مرتجع',
    cancelAssignment: 'إلغاء',
    collectedAmount: 'المبلغ المحصّل',
    confirm: 'تأكيد',
    close: 'إغلاق',
    addZone: 'إضافة منطقة',
    nameAr: 'الاسم (عربي)',
    nameEn: 'الاسم (إنجليزي)',
    fee: 'رسوم التوصيل',
    save: 'حفظ',
    inactive: 'غير نشط',
    addDriver: 'إضافة مندوب',
    name: 'الاسم',
    phone: 'الهاتف',
    notes: 'ملاحظات',
    settleDriver: 'تسوية عهدة المندوب',
    date: 'التاريخ',
    expectedCash: 'المتوقع',
    collectedCash: 'المحصّل',
    difference: 'الفرق',
    deliveredOrders: 'طلبات مسلّمة',
    settle: 'تسوية',
    loadSummary: 'عرض الملخص',
    history: 'السجل',
    assigned: 'مُسند',
    outForDelivery: 'خرج للتوصيل',
    delivered: 'تم التوصيل',
    returned: 'مرتجع',
    cancelled: 'ملغي',
    empty: 'لا يوجد بيانات بعد',
    all: 'الكل',
    errorGeneric: 'فشلت العملية',
    settledOk: 'تم تسجيل التسوية',
  },
} as const;

type DictKey = keyof (typeof DICT)['en'];

type Zone = { id: string; name_ar: string; name_en: string | null; fee: number; active: number };
type Driver = { id: string; name: string; phone: string | null; notes: string | null; active: number };
type Assignment = {
  id: number;
  order_id: number;
  order_number: string;
  driver_id: string;
  driver_name: string | null;
  zone_id: string | null;
  status: 'assigned' | 'out_for_delivery' | 'delivered' | 'returned' | 'cancelled';
  cod_amount: number;
  collected_amount: number;
  delivery_address: string | null;
  assigned_at: string;
};
type Settlement = {
  id: number;
  driver_id: string;
  driver_name: string | null;
  business_date: string;
  expected_cash: number;
  collected_cash: number;
  difference: number;
};

const STATUS_KEYS: Record<string, DictKey> = {
  assigned: 'assigned',
  out_for_delivery: 'outForDelivery',
  delivered: 'delivered',
  returned: 'returned',
  cancelled: 'cancelled',
};

export default function DeliveryPage() {
  const locale = useLocale();
  const t = (k: DictKey): string => (locale.startsWith('ar') ? DICT.ar[k] : DICT.en[k]);
  const formatCurrency = useFormatCurrency();

  const [tab, setTab] = useState<'board' | 'zones' | 'drivers' | 'settlements'>('board');
  const [zones, setZones] = useState<Zone[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [orderNumber, setOrderNumber] = useState('');
  const [assignDriver, setAssignDriver] = useState('');
  const [assignZone, setAssignZone] = useState('');
  const [assignCod, setAssignCod] = useState('');
  const [assignNote, setAssignNote] = useState('');

  const [zoneForm, setZoneForm] = useState({ name_ar: '', name_en: '', fee: '' });
  const [driverForm, setDriverForm] = useState({ name: '', phone: '', notes: '' });

  const [settleDriverId, setSettleDriverId] = useState('');
  const [settleDate, setSettleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<{ expected_cash: number; collected_cash: number; delivered_count: number } | null>(null);

  const [deliveringId, setDeliveringId] = useState<number | null>(null);
  const [deliverAmount, setDeliverAmount] = useState('');

  const load = useCallback(async () => {
    try {
      const [z, d, a, s] = await Promise.all([
        api.get('/delivery/zones'),
        api.get('/delivery/drivers'),
        api.get('/delivery/assignments'),
        api.get('/delivery/settlements'),
      ]);
      setZones(z.data.zones ?? []);
      setDrivers(d.data.drivers ?? []);
      setAssignments(a.data.assignments ?? []);
      setSettlements(s.data.settlements ?? []);
      setError(null);
    } catch {
      setError(t('errorGeneric'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const doAssign = async () => {
    try {
      await api.post('/delivery/assignments', {
        order_number: orderNumber.trim(),
        driver_id: assignDriver,
        zone_id: assignZone || null,
        cod_amount: assignCod || undefined,
        note: assignNote || null,
      });
      setOrderNumber('');
      setAssignCod('');
      setAssignNote('');
      await load();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));
    }
  };

  const setStatus = async (id: number, status: string, collected?: number) => {
    try {
      await api.post(`/delivery/assignments/${id}/status`, {
        status,
        collected_amount: collected,
      });
      setDeliveringId(null);
      setDeliverAmount('');
      await load();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));
    }
  };

  const addZone = async () => {
    try {
      await api.post('/delivery/zones', {
        name_ar: zoneForm.name_ar,
        name_en: zoneForm.name_en || null,
        fee: zoneForm.fee || 0,
      });
      setZoneForm({ name_ar: '', name_en: '', fee: '' });
      await load();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));
    }
  };

  const toggleZone = async (z: Zone) => {
    await api.put(`/delivery/zones/${z.id}`, { name_ar: z.name_ar, name_en: z.name_en, fee: z.fee, active: !z.active });
    await load();
  };

  const addDriver = async () => {
    try {
      await api.post('/delivery/drivers', {
        name: driverForm.name,
        phone: driverForm.phone || null,
        notes: driverForm.notes || null,
      });
      setDriverForm({ name: '', phone: '', notes: '' });
      await load();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));
    }
  };

  const toggleDriver = async (d: Driver) => {
    await api.put(`/delivery/drivers/${d.id}`, { name: d.name, phone: d.phone, notes: d.notes, active: !d.active });
    await load();
  };

  const loadSummary = async () => {
    if (!settleDriverId) return;
    const { data } = await api.get(`/delivery/cash/${settleDriverId}/${settleDate}`);
    setSummary(data.summary ?? null);
  };

  const doSettle = async () => {
    try {
      await api.post('/delivery/settlements', { driver_id: settleDriverId, business_date: settleDate });
      setSummary(null);
      setNotice(t('settledOk'));
      await load();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));
    }
  };

  const inputCls =
    'rounded-md border border-border bg-background px-3 py-2 min-h-11 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="gulf-management space-y-4 [&_button]:min-h-11">
      <h1 className="gulf-page-heading text-2xl font-bold text-foreground">{t('title')}</h1>
      <div className="gulf-toolbar flex gap-2 flex-wrap">
        {(['board', 'zones', 'drivers', 'settlements'] as const).map((k) => (
          <Button key={k} variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>
            {t(k)}
          </Button>
        ))}
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md bg-emerald-500/10 text-emerald-600 px-3 py-2 text-sm" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {tab === 'board' && (
        <div className="space-y-4">
          <div className="gulf-panel rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('assignOrder')}</h2>
            <div className="grid gap-2 md:grid-cols-5">
              <input className={inputCls} placeholder={t('orderNumber')} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
              <select className={inputCls} value={assignDriver} onChange={(e) => setAssignDriver(e.target.value)}>
                <option value="">{t('driver')}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select className={inputCls} value={assignZone} onChange={(e) => setAssignZone(e.target.value)}>
                <option value="">{t('zone')}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{locale.startsWith('ar') ? z.name_ar : z.name_en ?? z.name_ar}</option>
                ))}
              </select>
              <input className={inputCls} placeholder={t('codAmount')} value={assignCod} onChange={(e) => setAssignCod(e.target.value)} inputMode="decimal" />
              <input className={inputCls} placeholder={t('note')} value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
            </div>
            <Button onClick={doAssign} disabled={!orderNumber.trim() || !assignDriver}>{t('assign')}</Button>
          </div>

          <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('order')}</th>
                  <th className="p-2 text-start">{t('driver')}</th>
                  <th className="p-2 text-start">{t('address')}</th>
                  <th className="p-2 text-start">{t('status')}</th>
                  <th className="p-2 text-start">{t('cod')}</th>
                  <th className="p-2 text-start">{t('collected')}</th>
                  <th className="p-2 text-start">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
                {assignments.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-2">{a.order_number}</td>
                    <td className="p-2">{a.driver_name}</td>
                    <td className="p-2 max-w-[200px] truncate">{a.delivery_address}</td>
                    <td className="p-2">{t(STATUS_KEYS[a.status] ?? 'assigned')}</td>
                    <td className="p-2">{formatCurrency(a.cod_amount)}</td>
                    <td className="p-2">{formatCurrency(a.collected_amount)}</td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap">
                        {a.status === 'assigned' && (
                          <Button size="sm" variant="outline" onClick={() => void setStatus(a.id, 'out_for_delivery')}>{t('markOut')}</Button>
                        )}
                        {a.status === 'out_for_delivery' && (
                          <>
                            <Button size="sm" onClick={() => { setDeliveringId(a.id); setDeliverAmount(String(a.cod_amount)); }}>{t('markDelivered')}</Button>
                            <Button size="sm" variant="outline" onClick={() => void setStatus(a.id, 'returned')}>{t('markReturned')}</Button>
                          </>
                        )}
                        {(a.status === 'assigned' || a.status === 'out_for_delivery') && (
                          <Button size="sm" variant="ghost" onClick={() => void setStatus(a.id, 'cancelled')}>{t('cancelAssignment')}</Button>
                        )}
                      </div>
                      {deliveringId === a.id && (
                        <div className="mt-2 flex gap-1 items-center">
                          <input className={inputCls} value={deliverAmount} onChange={(e) => setDeliverAmount(e.target.value)} placeholder={t('collectedAmount')} inputMode="decimal" />
                          <Button size="sm" onClick={() => void setStatus(a.id, 'delivered', Number(deliverAmount) || 0)}>{t('confirm')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeliveringId(null)}>{t('close')}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'zones' && (
        <div className="space-y-4">
          <div className="gulf-panel rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('addZone')}</h2>
            <div className="grid gap-2 md:grid-cols-3">
              <input className={inputCls} placeholder={t('nameAr')} value={zoneForm.name_ar} onChange={(e) => setZoneForm({ ...zoneForm, name_ar: e.target.value })} />
              <input className={inputCls} placeholder={t('nameEn')} value={zoneForm.name_en} onChange={(e) => setZoneForm({ ...zoneForm, name_en: e.target.value })} />
              <input className={inputCls} placeholder={t('fee')} value={zoneForm.fee} onChange={(e) => setZoneForm({ ...zoneForm, fee: e.target.value })} inputMode="decimal" />
            </div>
            <Button onClick={addZone} disabled={!zoneForm.name_ar.trim()}>{t('save')}</Button>
          </div>
          <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('nameAr')}</th>
                  <th className="p-2 text-start">{t('nameEn')}</th>
                  <th className="p-2 text-start">{t('fee')}</th>
                  <th className="p-2 text-start">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className="border-t border-border">
                    <td className="p-2">{z.name_ar}</td>
                    <td className="p-2">{z.name_en}</td>
                    <td className="p-2">{formatCurrency(z.fee)}</td>
                    <td className="p-2">
                      <Button size="sm" variant={z.active ? 'outline' : 'ghost'} onClick={() => void toggleZone(z)}>
                        {z.active ? t('status') + ': ✓' : t('inactive')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'drivers' && (
        <div className="space-y-4">
          <div className="gulf-panel rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('addDriver')}</h2>
            <div className="grid gap-2 md:grid-cols-3">
              <input className={inputCls} placeholder={t('name')} value={driverForm.name} onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })} />
              <input className={inputCls} placeholder={t('phone')} value={driverForm.phone} onChange={(e) => setDriverForm({ ...driverForm, phone: e.target.value })} />
              <input className={inputCls} placeholder={t('notes')} value={driverForm.notes} onChange={(e) => setDriverForm({ ...driverForm, notes: e.target.value })} />
            </div>
            <Button onClick={addDriver} disabled={!driverForm.name.trim()}>{t('save')}</Button>
          </div>
          <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('name')}</th>
                  <th className="p-2 text-start">{t('phone')}</th>
                  <th className="p-2 text-start">{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="p-2">{d.name}</td>
                    <td className="p-2">{d.phone}</td>
                    <td className="p-2">
                      <Button size="sm" variant={d.active ? 'outline' : 'ghost'} onClick={() => void toggleDriver(d)}>
                        {d.active ? t('status') + ': ✓' : t('inactive')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settlements' && (
        <div className="space-y-4">
          <div className="gulf-panel rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('settleDriver')}</h2>
            <div className="grid gap-2 md:grid-cols-3">
              <select className={inputCls} value={settleDriverId} onChange={(e) => setSettleDriverId(e.target.value)}>
                <option value="">{t('driver')}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <input className={inputCls} type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void loadSummary()} disabled={!settleDriverId}>{t('loadSummary')}</Button>
                <Button onClick={() => void doSettle()} disabled={!settleDriverId || !summary}>{t('settle')}</Button>
              </div>
            </div>
            {summary && (
              <div className="text-sm text-foreground flex gap-6 flex-wrap">
                <span>{t('expectedCash')}: {formatCurrency(summary.expected_cash)}</span>
                <span>{t('collectedCash')}: {formatCurrency(summary.collected_cash)}</span>
                <span>{t('deliveredOrders')}: {summary.delivered_count}</span>
              </div>
            )}
          </div>
          <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('date')}</th>
                  <th className="p-2 text-start">{t('driver')}</th>
                  <th className="p-2 text-start">{t('expectedCash')}</th>
                  <th className="p-2 text-start">{t('collectedCash')}</th>
                  <th className="p-2 text-start">{t('difference')}</th>
                </tr>
              </thead>
              <tbody>
                {settlements.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
                {settlements.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2">{s.business_date}</td>
                    <td className="p-2">{s.driver_name}</td>
                    <td className="p-2">{formatCurrency(s.expected_cash)}</td>
                    <td className="p-2">{formatCurrency(s.collected_cash)}</td>
                    <td className="p-2">{formatCurrency(s.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
