/**
 * Production replacement for ./sampleOffers (swapped in by metro.config.js when
 * EXPO_PUBLIC_APP_ENV=production) so no fictional ads ship in release binaries.
 */
import type { GeoPoint, Offer } from '@/types/offer';

export { DEFAULT_ANCHOR } from './defaults';

export function buildSampleOffers(_now?: Date, _anchor?: GeoPoint): Offer[] {
  return [];
}
