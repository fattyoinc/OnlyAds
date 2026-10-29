/**
 * Last-known-good offers from the network, so the app is useful offline and on
 * flaky connections. Demo offers are never cached (they're rebuilt locally).
 * Entries older than MAX_AGE are discarded; expired offers are filtered on read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { validateOffer } from '@/services/offerValidation';
import type { Offer } from '@/types/offer';
import { isExpired } from '@/utils/format';

export const CACHE_KEY = 'onlyads:offers-cache:v1';
export const MAX_AGE_MS = 24 * 3600_000;

export interface CachedOffers {
  savedAt: number;
  offers: Offer[];
}

export function encodeCache(offers: Offer[], now: number): string {
  return JSON.stringify({ savedAt: now, offers: offers.filter((o) => o.source !== 'sample') });
}

export function decodeCache(json: string | null, now: Date = new Date()): CachedOffers | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { savedAt?: unknown; offers?: unknown };
    if (typeof raw.savedAt !== 'number' || now.getTime() - raw.savedAt > MAX_AGE_MS || !Array.isArray(raw.offers)) return null;
    const offers = raw.offers
      .map((o) => validateOffer(o, now))
      .filter((o): o is Offer => !!o && !isExpired(o, now));
    return { savedAt: raw.savedAt, offers };
  } catch {
    return null;
  }
}

export async function readCache(now?: Date): Promise<CachedOffers | null> {
  try {
    return decodeCache(await AsyncStorage.getItem(CACHE_KEY), now);
  } catch {
    return null;
  }
}

/** Bumped by clearCache so a write that was already in flight can't resurrect erased data. */
let generation = 0;

export async function writeCache(offers: Offer[]): Promise<void> {
  const gen = generation;
  try {
    await AsyncStorage.setItem(CACHE_KEY, encodeCache(offers, Date.now()));
    if (gen !== generation) await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage full or unavailable: caching is best-effort.
  }
}

export async function clearCache(): Promise<void> {
  generation++;
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
