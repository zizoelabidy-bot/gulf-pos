import type { PlatformAdapter, PlatformKey } from '../types';
import { talabatAdapter } from './talabat';
import { keetaAdapter } from './keeta';
import { deliverooAdapter } from './deliveroo';
import { jahezAdapter } from './jahez';

export const ADAPTERS: Record<PlatformKey, PlatformAdapter> = {
  talabat: talabatAdapter,
  keeta: keetaAdapter,
  deliveroo: deliverooAdapter,
  jahez: jahezAdapter,
};

export const PLATFORM_KEYS = Object.keys(ADAPTERS) as PlatformKey[];

export function getAdapter(key: string): PlatformAdapter | null {
  return Object.hasOwn(ADAPTERS, key) ? ADAPTERS[key as PlatformKey] : null;
}
