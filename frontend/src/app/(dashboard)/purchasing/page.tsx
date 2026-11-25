'use client';

/**
 * Purchasing & suppliers: supplier records, purchase orders with goods
 * receiving into inventory, supplier payments and balances. Inline en/ar
 * dictionary for this release; shared-i18n migration is tracked work.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'use-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

const DICT = {
  en: {
    title: 'Purchasing',
    suppliers: 'Suppliers',
    orders: 'Purchase Orders',
    payments: 'Payments',
    addSupplier: 'Add supplier',
    name: 'Name',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    save: 'Save',
    inactive: 'Inactive',
    newOrder: 'New purchase order',
    supplier: 'Supplier',
    expectedDate: 'Expected date',
    notes: 'Notes',
    items: 'Items',
    item: 'Item',
    supplyItem: 'Stock item (optional)',
    description: 'Description',
    quantity: 'Qty',
    unitCost: 'Unit cost',
    addLine: 'Add line',
    create: 'Create order',
    status: 'Status',
    total: 'Total',
    actions: 'Actions',
    send: 'Send',
    cancel: 'Cancel',
    receive: 'Receive',
    receiveQty: 'Qty received',
    confirm: 'Confirm',
    recordPayment: 'Record payment',
    amount: 'Amount',
    date: 'Date',
    method: 'Method',
    reference: 'Reference',
    receivedTotal: 'Received',
    paidTotal: 'Paid',
    balanceDue: 'Balance',
    draft: 'Draft',
    sent: 'Sent',
    partiallyReceived: 'Partially received',
    received: 'Received',
    cancelled: 'Cancelled',
    empty: 'Nothing here yet',
    errorGeneric: 'Operation failed',
    none: '-',
  },
  ar: {
    title: 'المشتريات',
    suppliers: 'الموردون',
    orders: 'أوامر الشراء',
    payments: 'المدفوعات',
    addSupplier: 'إضافة مورد',
    name: 'الاسم',
    phone: 'الهاتف',
    email: 'البريد',
    address: 'العنوان',
    save: 'حفظ',
    inactive: 'غير نشط',
    newOrder: 'أمر شراء جديد',
    supplier: 'المورد',
    expectedDate: 'تاريخ التوريد',
    notes: 'ملاحظات',
    items: 'الأصناف',
    item: 'الصنف',
    supplyItem: 'صنف مخزون (اختياري)',
    description: 'الوصف',
    quantity: 'الكمية',
    unitCost: 'سعر الوحدة',
    addLine: 'إضافة سطر',
    create: 'إنشاء الأمر',
    status: 'الحالة',
    total: 'الإجمالي',
    actions: 'إجراءات',
    send: 'إرسال',
    cancel: 'إلغاء',
    receive: 'استلام',
    receiveQty: 'الكمية المستلمة',
    confirm: 'تأكيد',
    recordPayment: 'تسجيل دفعة',
    amount: 'المبلغ',
    date: 'التاريخ',
    method: 'طريقة الدفع',
    reference: 'المرجع',
    receivedTotal: 'المستلم',
    paidTotal: 'المدفوع',
    balanceDue: 'الرصيد',
    draft: 'مسودة',
    sent: 'مُرسل',
    partiallyReceived: 'استلام جزئي',
    received: 'مستلم',
    cancelled: 'ملغي',
    empty: 'لا يوجد بيانات بعد',
    errorGeneric: 'فشلت العملية',
    none: '-',
  },
} as const;

type DictKey = keyof (typeof DICT)['en'];

type Supplier = { id: string; name: string; phone: string | null; active: number };
type Supply = { id: string; name: string; base_unit: string };
type PoItem = { id: number; supply_id: string | null; description: string; quantity: number; unit: string | null; unit_cost: number; received_quantity: number };
type Po = { id: number; po_number: string; supplier_id: string; supplier_name: string | null; status: string; total: number; expected_date: string | null; items?: PoItem[] };

const STATUS_KEYS: Record<string, DictKey> = {
  draft: 'draft',
  sent: 'sent',
  partially_received: 'partiallyReceived',
  received: 'received',
  cancelled: 'cancelled',
};

export default function PurchasingPage() {
  const locale = useLocale();
  const t = (k: DictKey): string => (locale.startsWith('ar') ? DICT.ar[k] : DICT.en[k]);
  const formatCurrency = useFormatCurrency();

  const [tab, setTab] = useState<'suppliers' | 'orders' | 'payments'>('orders');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [orders, setOrders] = useState<Po[]>([]);
  const [payments, setPayments] = useState<{ id: number; supplier_name: string | null; amount: number; payment_date: string; method: string | null }[]>([]);
  const [balances, setBalances] = useState<Record<string, { received_total: number; paid_total: number; balance: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', email: '', address: '' });
  const [poSupplier, setPoSupplier] = useState('');
  const [poDate, setPoDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [lines, setLines] = useState<{ supply_id: string; description: string; quantity: string; unit_cost: string }[]>([
    { supply_id: '', description: '', quantity: '', unit_cost: '' },
  ]);
  const [openPo, setOpenPo] = useState<Po | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<number, string>>({});
  const [payForm, setPayForm] = useState({ supplier_id: '', amount: '', payment_date: new Date().toISOString().slice(0, 10), method: '', reference: '' });

  const inputCls =
    'rounded-md border border-border bg-background px-3 py-2 min-h-11 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  const err = (e: unknown) =>
    setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('errorGeneric'));

  const load = useCallback(async () => {
    try {
      const [s, po, sp, pay] = await Promise.all([
        api.get('/purchasing/suppliers'),
        api.get('/purchasing/purchase-orders'),
        api.get('/supplies'),
        api.get('/purchasing/payments'),
      ]);
      setSuppliers(s.data.suppliers ?? []);
      setOrders(po.data.purchase_orders ?? []);
      setSupplies(sp.data.supplies ?? sp.data ?? []);
      setPayments(pay.data.payments ?? []);
      setError(null);
    } catch (e) {
      err(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'payments') return;
    void (async () => {
      const map: Record<string, { received_total: number; paid_total: number; balance: number }> = {};
      for (const s of suppliers) {
        try {
          const { data } = await api.get(`/purchasing/balances/${s.id}`);
          map[s.id] = data.balance;
        } catch {
          /* balance stays hidden on error */
        }
      }
      setBalances(map);
    })();
  }, [tab, suppliers]);

  const addSupplier = async () => {
    try {
      await api.post('/purchasing/suppliers', supplierForm);
      setSupplierForm({ name: '', phone: '', email: '', address: '' });
      await load();
    } catch (e) {
      err(e);
    }
  };

  const createPo = async () => {
    try {
      await api.post('/purchasing/purchase-orders', {
        supplier_id: poSupplier,
        expected_date: poDate || null,
        notes: poNotes || null,
        items: lines
          .filter((l) => l.description.trim() || l.supply_id)
          .map((l) => ({
            supply_id: l.supply_id || null,
            description: l.description || null,
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_cost) || 0,
          })),
      });
      setPoSupplier('');
      setPoDate('');
      setPoNotes('');
      setLines([{ supply_id: '', description: '', quantity: '', unit_cost: '' }]);
      await load();
    } catch (e) {
      err(e);
    }
  };

  const poAction = async (id: number, action: string) => {
    try {
      await api.post(`/purchasing/purchase-orders/${id}/status`, { status: action });
      await load();
    } catch (e) {
      err(e);
    }
  };

  const openReceive = async (id: number) => {
    try {
      const { data } = await api.get(`/purchasing/purchase-orders/${id}`);
      setOpenPo(data.purchase_order);
      setReceiveQtys({});
    } catch (e) {
      err(e);
    }
  };

  const doReceive = async () => {
    if (!openPo) return;
    try {
      const receipts = (openPo.items ?? [])
        .map((i) => ({ item_id: i.id, quantity: Number(receiveQtys[i.id]) || 0 }))
        .filter((r) => r.quantity > 0);
      await api.post(`/purchasing/purchase-orders/${openPo.id}/receive`, { receipts });
      setOpenPo(null);
      await load();
    } catch (e) {
      err(e);
    }
  };

  const recordPayment = async () => {
    try {
      await api.post('/purchasing/payments', {
        ...payForm,
        amount: Number(payForm.amount),
        method: payForm.method || null,
        reference: payForm.reference || null,
      });
      setPayForm({ ...payForm, amount: '', reference: '' });
      await load();
      setBalances({});
    } catch (e) {
      err(e);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 [&_button]:min-h-11">
      <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
      <div className="flex gap-2 flex-wrap">
        {(['orders', 'suppliers', 'payments'] as const).map((k) => (
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

      {tab === 'orders' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('newOrder')}</h2>
            <div className="grid gap-2 md:grid-cols-3">
              <select className={inputCls} value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)}>
                <option value="">{t('supplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input className={inputCls} type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              <input className={inputCls} placeholder={t('notes')} value={poNotes} onChange={(e) => setPoNotes(e.target.value)} />
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="grid gap-2 md:grid-cols-4">
                  <select
                    className={inputCls}
                    value={l.supply_id}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx].supply_id = e.target.value;
                      const sp = supplies.find((x) => x.id === e.target.value);
                      if (sp && !next[idx].description) next[idx].description = sp.name;
                      setLines(next);
                    }}
                  >
                    <option value="">{t('supplyItem')}</option>
                    {supplies.map((sp) => (
                      <option key={sp.id} value={sp.id}>{sp.name}</option>
                    ))}
                  </select>
                  <input className={inputCls} placeholder={t('description')} value={l.description} onChange={(e) => { const next = [...lines]; next[idx].description = e.target.value; setLines(next); }} />
                  <input className={inputCls} placeholder={t('quantity')} value={l.quantity} onChange={(e) => { const next = [...lines]; next[idx].quantity = e.target.value; setLines(next); }} inputMode="decimal" />
                  <input className={inputCls} placeholder={t('unitCost')} value={l.unit_cost} onChange={(e) => { const next = [...lines]; next[idx].unit_cost = e.target.value; setLines(next); }} inputMode="decimal" />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLines([...lines, { supply_id: '', description: '', quantity: '', unit_cost: '' }])}>{t('addLine')}</Button>
              <Button onClick={createPo} disabled={!poSupplier || !lines.some((l) => (l.description.trim() || l.supply_id) && Number(l.quantity) > 0)}>{t('create')}</Button>
            </div>
          </div>

          {openPo && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <h2 className="font-semibold text-foreground">{t('receive')} {openPo.po_number}</h2>
              {(openPo.items ?? []).map((i) => (
                <div key={i.id} className="grid gap-2 md:grid-cols-4 items-center">
                  <span className="text-sm text-foreground">{i.description}</span>
                  <span className="text-sm text-muted-foreground">{i.received_quantity} / {i.quantity} {i.unit}</span>
                  <input
                    className={inputCls}
                    placeholder={t('receiveQty')}
                    value={receiveQtys[i.id] ?? ''}
                    onChange={(e) => setReceiveQtys({ ...receiveQtys, [i.id]: e.target.value })}
                    inputMode="decimal"
                  />
                  <span className="text-sm">{formatCurrency(i.unit_cost)}</span>
                </div>
              ))}
              <div className="flex gap-2">
                <Button onClick={doReceive}>{t('confirm')}</Button>
                <Button variant="ghost" onClick={() => setOpenPo(null)}>{t('cancel')}</Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('item')}</th>
                  <th className="p-2 text-start">{t('supplier')}</th>
                  <th className="p-2 text-start">{t('status')}</th>
                  <th className="p-2 text-start">{t('total')}</th>
                  <th className="p-2 text-start">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="p-2">{o.po_number}</td>
                    <td className="p-2">{o.supplier_name}</td>
                    <td className="p-2">{t(STATUS_KEYS[o.status] ?? 'draft')}</td>
                    <td className="p-2">{formatCurrency(o.total)}</td>
                    <td className="p-2">
                      <div className="flex gap-1 flex-wrap">
                        {o.status === 'draft' && <Button size="sm" variant="outline" onClick={() => void poAction(o.id, 'sent')}>{t('send')}</Button>}
                        {(o.status === 'sent' || o.status === 'partially_received') && (
                          <Button size="sm" onClick={() => void openReceive(o.id)}>{t('receive')}</Button>
                        )}
                        {(o.status === 'draft' || o.status === 'sent' || o.status === 'partially_received') && (
                          <Button size="sm" variant="ghost" onClick={() => void poAction(o.id, 'cancelled')}>{t('cancel')}</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('addSupplier')}</h2>
            <div className="grid gap-2 md:grid-cols-4">
              <input className={inputCls} placeholder={t('name')} value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              <input className={inputCls} placeholder={t('phone')} value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              <input className={inputCls} placeholder={t('email')} value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} />
              <input className={inputCls} placeholder={t('address')} value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} />
            </div>
            <Button onClick={addSupplier} disabled={!supplierForm.name.trim()}>{t('save')}</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('name')}</th>
                  <th className="p-2 text-start">{t('phone')}</th>
                  <th className="p-2 text-start">{t('receivedTotal')}</th>
                  <th className="p-2 text-start">{t('paidTotal')}</th>
                  <th className="p-2 text-start">{t('balanceDue')}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2">{s.name}</td>
                    <td className="p-2">{s.phone ?? t('none')}</td>
                    <td className="p-2">{balances[s.id] ? formatCurrency(balances[s.id].received_total) : t('none')}</td>
                    <td className="p-2">{balances[s.id] ? formatCurrency(balances[s.id].paid_total) : t('none')}</td>
                    <td className="p-2">{balances[s.id] ? formatCurrency(balances[s.id].balance) : t('none')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h2 className="font-semibold text-foreground">{t('recordPayment')}</h2>
            <div className="grid gap-2 md:grid-cols-5">
              <select className={inputCls} value={payForm.supplier_id} onChange={(e) => setPayForm({ ...payForm, supplier_id: e.target.value })}>
                <option value="">{t('supplier')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input className={inputCls} placeholder={t('amount')} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} inputMode="decimal" />
              <input className={inputCls} type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} />
              <input className={inputCls} placeholder={t('method')} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} />
              <input className={inputCls} placeholder={t('reference')} value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
            </div>
            <Button onClick={recordPayment} disabled={!payForm.supplier_id || !(Number(payForm.amount) > 0)}>{t('save')}</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t('date')}</th>
                  <th className="p-2 text-start">{t('supplier')}</th>
                  <th className="p-2 text-start">{t('amount')}</th>
                  <th className="p-2 text-start">{t('method')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">{t('empty')}</td></tr>
                )}
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-2">{p.payment_date}</td>
                    <td className="p-2">{p.supplier_name}</td>
                    <td className="p-2">{formatCurrency(p.amount)}</td>
                    <td className="p-2">{p.method ?? t('none')}</td>
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
