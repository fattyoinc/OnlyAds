import { config as appConfig, type AppConfig } from '@/config';
import { loadDemoCatalog } from '@/data/demoCatalog';
import type { Offer } from '@/types/offer';
import { describeError, getJson, type RequestOptions } from '../http';
import { validateOffer } from '../offerValidation';
import type { OfferPage, OfferProvider, ProviderContext } from './types';

export * from './types';
export { validateOffer };

/** Bundled, fictional demo catalog. Enabled only in development/staging builds. */
export const sampleProvider: OfferProvider = {
  id: 'sample',
  label: 'Demo catalog',
  status: 'simulated',
  description: 'Fictional brands and offers for testing. Not included in production builds.',
  async fetchOffers(ctx) {
    return loadDemoCatalog()?.(ctx.now, ctx.location) ?? [];
  },
};

/** Offers per request. Further pages load as the user scrolls (see AppState.loadMore). */
export const PAGE_SIZE = 40;
/** Upper bound on offers kept in memory; older pages are dropped beyond this. */
export const MAX_OFFERS_IN_MEMORY = 600;

interface OffersPage {
  offers?: unknown[];
  nextCursor?: string | null;
}

/**
 * Only Ads API, ranked server-side over the whole catalog (/v1/feed). Affiliate networks, merchant feeds and direct advertisers are
 * ingested and moderated server-side; the app only ever talks to this API.
 * Coordinates are rounded to 2 decimals (~1 km) before leaving the device.
 */
export function backendProvider(baseUrl: string | undefined, http: Pick<RequestOptions, 'fetchImpl' | 'sleep' | 'timeoutMs'> = {}): OfferProvider {
  const fetchPage = async (ctx: ProviderContext, cursor?: string): Promise<OfferPage> => {
    const params = [
      ctx.location ? `lat=${ctx.location.lat.toFixed(2)}&lng=${ctx.location.lng.toFixed(2)}` : '',
      ctx.country && /^[A-Z]{2}$/.test(ctx.country) ? `country=${ctx.country}` : '',
      ctx.preferences?.interests.length ? `interests=${ctx.preferences.interests.map(encodeURIComponent).join(',')}` : '',
      ctx.preferences?.affinity ? `affinity=${encodeURIComponent(ctx.preferences.affinity)}` : '',
      `limit=${PAGE_SIZE}`,
      cursor ? `cursor=${encodeURIComponent(cursor)}` : '',
    ].filter(Boolean);
    const body = await getJson<OffersPage>(`${baseUrl}/v1/feed?${params.join('&')}`, { signal: ctx.signal, ...http });
    const offers: Offer[] = [];
    for (const raw of Array.isArray(body?.offers) ? body.offers : []) {
      const o = validateOffer(raw, ctx.now);
      // Click-outs go through our redirect so bad links can be revoked centrally.
      if (o) offers.push({ ...o, clickUrl: `${baseUrl}/v1/click/${encodeURIComponent(o.id)}` });
    }
    const next = typeof body?.nextCursor === 'string' && body.nextCursor.length < 200 && /^[A-Za-z0-9_-]+$/.test(body.nextCursor) ? body.nextCursor : undefined;
    return { offers, nextCursor: next };
  };
  return {
    id: 'backend',
    label: 'Only Ads offers',
    status: baseUrl ? 'live' : 'disabled',
    description: baseUrl ? 'Offers from verified advertisers and affiliate partners.' : 'Offers API not configured in this build.',
    fetchPage,
    async fetchOffers(ctx: ProviderContext) {
      return (await fetchPage(ctx)).offers;
    },
  };
}

/**
 * Append a new page to what's loaded: first occurrence of an id wins (no
 * duplicates across pages or providers) and memory stays bounded.
 */
export function mergeOffers(existing: Offer[], incoming: Offer[], max = MAX_OFFERS_IN_MEMORY): Offer[] {
  const seen = new Set(existing.map((o) => o.id));
  const merged = existing.concat(incoming.filter((o) => !seen.has(o.id) && (seen.add(o.id), true)));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function defaultProviders(cfg: AppConfig = appConfig): OfferProvider[] {
  return [...(cfg.demoCatalog ? [sampleProvider] : []), backendProvider(cfg.apiUrl)];
}

export interface AggregateResult {
  offers: Offer[];
  errors: { providerId: string; message: string }[];
  /** Next-page cursors for paginated providers that have more. */
  cursors: Record<string, string>;
}

/** Fetch from all enabled providers; one failing source never breaks the feed. */
export async function aggregateOffers(providers: OfferProvider[], ctx: ProviderContext): Promise<AggregateResult> {
  const enabled = providers.filter((p) => p.status !== 'disabled');
  const settled = await Promise.allSettled(enabled.map((p): Promise<OfferPage> => (p.fetchPage ? p.fetchPage(ctx) : p.fetchOffers(ctx).then((offers) => ({ offers })))));
  const byId = new Map<string, Offer>();
  const errors: AggregateResult['errors'] = [];
  const cursors: Record<string, string> = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      r.value.offers.forEach((o) => byId.has(o.id) || byId.set(o.id, o));
      if (r.value.nextCursor) cursors[enabled[i].id] = r.value.nextCursor;
    } else errors.push({ providerId: enabled[i].id, message: describeError(r.reason) });
  });
  return { offers: [...byId.values()], errors, cursors };
}
