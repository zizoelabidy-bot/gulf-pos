'use client';

/**
 * Food cost intelligence: per-item profitability (price vs recipe unit cost,
 * margin, food cost %) and theoretical-vs-actual consumption per stock item
 * with variance and waste cost. Inline en/ar dictionary for this release;
 * shared-i18n migration is tracked work.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'use-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

const DICT = {
  en: {
    title: 'Food Cost',
    profitability: 'Profitability',
    consumption: 'Consumption',
    product: 'Product',
    category: 'Category',
    price: 'Price',
    unitCost: 'Recipe cost',
    margin: 'Margin',
    foodCostPct: 'Food cost %',
    noRecipe: 'No recipe',
    costUnknown: 'Cost unknown',
    supply: 'Stock item',
    unit: 'Unit',
    theoretical: 'Theoretical',
    actual: 'Actual',
    variance: 'Variance',
    wasteQty: 'Waste qty',
    wasteCost: 'Waste cost',
    from: 'From',
    to: 'To',
    apply: 'Apply',
    empty: 'Nothing here yet',
    errorGeneric: 'Operation failed',
    none: '-',
  },
  ar: {
    title: 'تكلفة الطعام',
    profitability: 'الربحية',
    consumption: 'الاستهلاك',
    product: 'المنتج',
    category: 'الفئة',
    price: 'السعر',
    unitCost: 'تكلفة الوصفة',
    margin: 'الهامش',
    foodCostPct: 'نسبة التكلفة %',
    noRecipe: 'بدون وصفة',
    costUnknown: 'التكلفة غير معروفة',
    supply: 'صنف المخزون',
    unit: 'الوحدة',
    theoretical: 'النظري',
    actual: 'الفعلي',
    variance: 'الفرق',
    wasteQty: 'كمية الهالك',
    wasteCost: 'تكلفة الهالك',
    from: 'من',
    to: 'إلى',
    apply: 'تطبيق',
    empty: 'لا يوجد بيانات بعد',
    errorGeneric: 'فشلت العملية',
    none: '-',
  },
} as const;

type DictKey = keyof (typeof DICT)['en'];

type ItemRow = {
  product_id: string;
  product_name: string;
  category_name: string | null;
  price: number | null;
  has_recipe: boolean;
  cost_known: boolean;
  unit_cost: number | null;
  margin: number | null;
  food_cost_pct: number | null;
};

type ConsumptionRow = {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  theoretical_qty: number;
  depleted_qty: number;
  restored_qty: number;
  waste_qty: number;
  waste_cost: number;
  actual_net_qty: number;
  variance_qty: number;
};

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function FoodCostPage() {
  const locale = useLocale();
  const t = (k: DictKey): string => (locale.startsWith('ar') ? DICT.ar[k] : DICT.en[k]);
  const formatCurrency = useFormatCurrency();

  const [tab, setTab] = useState<'profitability' | 'consumption'>('profitability');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [from, setFrom] = useState<string>(todayIso());
  const [to, setTo] = useState<string>(todayIso());
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    try {
      const res = await api.get('/food-cost/items');
      setItems(res.data.items ?? []);
      setError(null);
    } catch {
      setError(t('errorGeneric'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadConsumption = useCallback(async (fromDay: string, toDay: string) => {
    try {
      const res = await api.get('/food-cost/consumption', {
        params: { from: `${fromDay}T00:00:00`, to: `${toDay}T23:59:59.999` },
      });
      setRows(res.data.supplies ?? []);
      setError(null);
    } catch {
      setError(t('errorGeneric'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadItems();
    void loadConsumption(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="gulf-management space-y-4">
      <h1 className="gulf-page-heading text-2xl font-bold text-foreground">{t('title')}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="gulf-toolbar flex flex-wrap gap-2">
        <Button
          variant={tab === 'profitability' ? 'default' : 'outline'}
          onClick={() => setTab('profitability')}
        >
          {t('profitability')}
        </Button>
        <Button
          variant={tab === 'consumption' ? 'default' : 'outline'}
          onClick={() => setTab('consumption')}
        >
          {t('consumption')}
        </Button>
      </div>

      {tab === 'profitability' && (
        <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-start">{t('product')}</th>
                <th className="p-2 text-start">{t('category')}</th>
                <th className="p-2 text-end">{t('price')}</th>
                <th className="p-2 text-end">{t('unitCost')}</th>
                <th className="p-2 text-end">{t('margin')}</th>
                <th className="p-2 text-end">{t('foodCostPct')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.product_id} className="border-b last:border-0">
                  <td className="p-2">{item.product_name}</td>
                  <td className="p-2 text-muted-foreground">{item.category_name ?? t('none')}</td>
                  <td className="p-2 text-end">
                    {item.price !== null ? formatCurrency(item.price) : t('none')}
                  </td>
                  <td className="p-2 text-end">
                    {!item.has_recipe ? (
                      <span className="text-muted-foreground">{t('noRecipe')}</span>
                    ) : !item.cost_known ? (
                      <span className="text-amber-600">{t('costUnknown')}</span>
                    ) : (
                      formatCurrency(item.unit_cost ?? 0)
                    )}
                  </td>
                  <td className="p-2 text-end">
                    {item.margin !== null ? formatCurrency(item.margin) : t('none')}
                  </td>
                  <td className="p-2 text-end">
                    {item.food_cost_pct !== null ? `${item.food_cost_pct}%` : t('none')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'consumption' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('from')}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border bg-background px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('to')}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border bg-background px-2 py-1"
              />
            </label>
            <Button onClick={() => void loadConsumption(from, to)}>{t('apply')}</Button>
          </div>
          <div className="gulf-table-panel overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-start">{t('supply')}</th>
                  <th className="p-2 text-start">{t('unit')}</th>
                  <th className="p-2 text-end">{t('theoretical')}</th>
                  <th className="p-2 text-end">{t('actual')}</th>
                  <th className="p-2 text-end">{t('variance')}</th>
                  <th className="p-2 text-end">{t('wasteQty')}</th>
                  <th className="p-2 text-end">{t('wasteCost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.supply_id} className="border-b last:border-0">
                    <td className="p-2">{row.supply_name}</td>
                    <td className="p-2 text-muted-foreground">{row.base_unit}</td>
                    <td className="p-2 text-end">{fmtQty(row.theoretical_qty)}</td>
                    <td className="p-2 text-end">{fmtQty(row.actual_net_qty)}</td>
                    <td
                      className={`p-2 text-end ${
                        Math.abs(row.variance_qty) > 0.0005 ? 'text-amber-600' : ''
                      }`}
                    >
                      {fmtQty(row.variance_qty)}
                    </td>
                    <td className="p-2 text-end">{fmtQty(row.waste_qty)}</td>
                    <td className="p-2 text-end">
                      {row.waste_cost > 0 ? formatCurrency(row.waste_cost) : t('none')}
                    </td>
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
