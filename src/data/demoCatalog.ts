import type { GeoPoint, Offer } from '@/types/offer';

type Builder = (now: Date, anchor?: GeoPoint) => Offer[];

/**
 * Loads the fictional demo catalog. The env check is a literal comparison so the
 * production minifier removes the branch — and with it the demo data — from
 * production bundles (verified by grepping the export in CI: see e2e/check-bundle.js).
 */
export function loadDemoCatalog(): Builder | null {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'production') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional require lets the minifier drop demo data
  return (require('./sampleOffers') as { buildSampleOffers: Builder }).buildSampleOffers;
}
