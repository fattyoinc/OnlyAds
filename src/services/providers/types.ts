import type { GeoPoint, Offer } from '@/types/offer';

/**
 * - `simulated`: bundled demo data, no network.
 * - `live`: real network integration, implemented and enabled by config.
 * - `disabled`: implemented but not configured (missing URL/credentials).
 */
export type ProviderStatus = 'simulated' | 'live' | 'disabled';

export interface ProviderContext {
  now: Date;
  /** User's coarse location, only when they opted in. */
  location?: GeoPoint;
  /** Device region (ISO alpha-2) to request only offers redeemable there. */
  country?: string;
  signal?: AbortSignal;
  /** Coarse preferences for server-side ranking (see feedPreferences). Not stored by the server. */
  preferences?: { interests: string[]; affinity: string };
}

export interface OfferProvider {
  id: string;
  label: string;
  status: ProviderStatus;
  /** One-line, user-facing explanation (shown in Profile → Data sources). */
  description: string;
  fetchOffers(ctx: ProviderContext): Promise<Offer[]>;
  /** Cursor-paginated providers: one page per call. `cursor` undefined = first page. */
  fetchPage?(ctx: ProviderContext, cursor?: string): Promise<OfferPage>;
}

export interface OfferPage {
  offers: Offer[];
  nextCursor?: string;
}
