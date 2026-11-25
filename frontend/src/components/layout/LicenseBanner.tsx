'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'use-intl';
import { ShieldAlert, Clock } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// Inline en/ar: licensing strings live outside the upstream locale gate.
const strings = {
  en: {
    trial: (d: string) => `GULF POS trial ends ${d}. Contact GULF CCTV to activate a license.`,
    grace: (d: string) =>
      `Your license has expired. Grace period ends ${d}; after that new sales stop. Contact GULF CCTV.`,
    expired:
      'License expired. New sales are blocked; reports and export remain available. Contact GULF CCTV to renew.',
  },
  ar: {
    trial: (d: string) =>
      `النسخة التجريبية من GULF POS تنتهي في ${d}. تواصل مع GULF CCTV لتفعيل الترخيص.`,
    grace: (d: string) =>
      `انتهى الترخيص. فترة السماح تنتهي في ${d} وبعدها تتوقف المبيعات الجديدة. تواصل مع GULF CCTV.`,
    expired:
      'انتهى الترخيص. المبيعات الجديدة متوقفة، والتقارير والتصدير ما زالت متاحة. تواصل مع GULF CCTV للتجديد.',
  },
};

interface LicenseStatus {
  status: 'active' | 'trial' | 'grace' | 'expired';
  trial_ends_at: string | null;
  grace_ends_at: string | null;
}

export default function LicenseBanner() {
  const locale = useLocale();
  const token = useAuthStore((s) => s.token);
  const [state, setState] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = () =>
      api
        .get('/license/status')
        .then((res) => {
          if (active) setState(res.data);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 30 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token]);

  if (!state || state.status === 'active') return null;
  // Trial only nags during its final 5 days.
  if (state.status === 'trial' && state.trial_ends_at) {
    const daysLeft = (new Date(state.trial_ends_at).getTime() - Date.now()) / 864e5;
    if (daysLeft > 5) return null;
  }

  const ar = locale.startsWith('ar');
  const s = ar ? strings.ar : strings.en;
  const text =
    state.status === 'trial'
      ? s.trial((state.trial_ends_at || '').slice(0, 10))
      : state.status === 'grace'
        ? s.grace((state.grace_ends_at || '').slice(0, 10))
        : s.expired;
  const hard = state.status !== 'trial';

  return (
    <Link
      href="/settings?tab=license"
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium shrink-0 ${
        hard
          ? 'bg-red-600 text-white hover:bg-red-700'
          : 'bg-amber-500 text-white hover:bg-amber-600'
      }`}
    >
      {hard ? <ShieldAlert className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
      <span>{text}</span>
    </Link>
  );
}
