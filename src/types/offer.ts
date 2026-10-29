/**
 * Normalized offer model. Every source (sample data, merchant product feeds,
 * affiliate networks, direct advertisers) is mapped into this one shape so the
 * UI, search and ranking never care where an ad came from.
 */

export type CategoryId =
  | 'food'
  | 'fashion'
  | 'sneakers'
  | 'tech'
  | 'home'
  | 'beauty'
  | 'travel'
  | 'fitness'
  | 'gifts'
  | 'entertainment'
  | 'grocery'
  | 'kids';

/**
 * Where an offer came from. `sample` = bundled demo data (simulated).
 * The others correspond to provider adapters in src/services/providers.
 */
export type OfferSource = 'sample' | 'merchant_feed' | 'affiliate' | 'direct';

export type OfferKind = 'product' | 'deal' | 'local' | 'service' | 'experience';

export interface Money {
  amount: number;
  currency: string; // ISO 4217
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Advertiser {
  id: string;
  name: string;
  verified: boolean;
}

/** Art direction for offers without a photo (all bundled sample data). */
export interface Creative {
  colors: [string, string];
  icon: string; // MaterialCommunityIcons glyph name
  accent?: string;
}

export interface Offer {
  id: string;
  source: OfferSource;
  kind: OfferKind;
  category: CategoryId;
  title: string;
  subtitle?: string;
  description: string;
  advertiser: Advertiser;
  imageUrl?: string;
  creative: Creative;
  price?: Money;
  originalPrice?: Money;
  /** Free-form promo text when there is no price, e.g. "Buy 1 get 1 free". */
  promoLabel?: string;
  promoCode?: string;
  /** ISO timestamps. */
  startsAt?: string;
  expiresAt?: string;
  ctaLabel: string;
  /** Advertiser landing page. Validated https URL. */
  url: string;
  /**
   * Server redirect used for click-out (`/v1/click/:id`). When present the app
   * opens this instead of `url`, so links can be re-validated and revoked centrally.
   */
  clickUrl?: string;
  tags: string[];
  location?: GeoPoint & { address: string; placeName: string };
  /** True when the advertiser paid for placement. Always disclosed in UI. */
  sponsored: boolean;
  /** Affiliate offers are disclosed as such (FTC endorsement guides). */
  affiliate?: boolean;
  /** Fictional/test content even though it arrived over a live integration. */
  demo?: boolean;
  rating?: number;
  createdAt: string;
  /**
   * Where the offer can be redeemed. Missing = no restriction known.
   * `countries`: ISO 3166-1 alpha-2 codes. `online`: redeemable online.
   */
  availability?: { countries?: string[]; online?: boolean };
  /** When a source last confirmed this offer (price, link, expiry). ISO timestamp. */
  verifiedAt?: string;
  /**
   * Attribution metadata for authorized affiliate/advertiser campaigns. The app
   * never builds tracking URLs itself — the server's click redirect does, and
   * only for advertisers that enabled attribution.
   */
  campaign?: { id?: string; network?: string };
  /**
   * 0..1 percentile of recent click-through rate across the catalog (server-computed from
   * aggregate counts, smoothed). Absent when there isn't enough data — never invented.
   */
  popularity?: number;
}

export interface Category {
  id: CategoryId;
  name: string;
  icon: string;
  colors: [string, string];
  blurb: string;
}
