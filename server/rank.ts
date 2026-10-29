/**
 * Server-side ranking over the WHOLE serving catalog (the app can only rank what
 * it has downloaded). Same scoring function as the app (src/services/ranking.ts)
 * so results are consistent, plus an aggregate popularity signal.
 *
 * Inputs are what the app chooses to send per request — picked interests and a
 * coarse (bucketed) category preference — never stored, logged, or linked to a
 * person. Popularity comes from anonymous daily counts (clicks / impressions).
 *
 * Cost model: one SQL snapshot of serving offers per CATALOG_TTL_MS, scored in
 * memory per distinct query (cached). Fine to ~50k offers on one instance; past
 * that, pre-filter candidates per category before scoring.
 */
import type { CategoryId, Offer } from '@/types/offer';
import { EMPTY_PROFILE, rankFeed, type UserProfile } from '@/services/ranking';
import { distanceKm, isAvailableIn } from '@/utils/format';
import type { DB } from './db';

export const POPULARITY_WINDOW_DAYS = 14;
/** Offers need this many impressions before their click-through rate means anything. */
export const MIN_IMPRESSIONS = 20;
/** Bayesian smoothing strength (pseudo-impressions at the catalog-wide rate). */
const SMOOTHING = 100;
/** Fewer qualified offers than this → no popularity at all (percentiles would be noise). */
const MIN_QUALIFIED = 5;
/** Ranked results kept per query; matches what the app holds in memory. */
export const MAX_RANKED = 600;
const LOCAL_RADIUS_KM = 50;

/** Category preference buckets the app may send: coarse on purpose. */
export const AFFINITY_BUCKETS: Record<string, number> = { '-2': -8, '-1': -2, '1': 2, '2': 6, '3': 20 };

/**
 * Percentile (0..1) of smoothed click-through rate among offers with enough
 * impressions. Clicks alone are never treated as conversions or revenue.
 */
export function computePopularity(db: DB, now: Date): Map<string, number> {
  const since = new Date(now.getTime() - POPULARITY_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT i.offer_id AS id, SUM(i.count) AS imps,
              COALESCE((SELECT SUM(c.count) FROM click_counts c WHERE c.offer_id = i.offer_id AND c.day >= ?), 0) AS clicks
       FROM impression_counts i WHERE i.day >= ? GROUP BY i.offer_id`,
    )
    .all(since, since) as { id: string; imps: number; clicks: number }[];
  const totalImps = rows.reduce((s, r) => s + r.imps, 0);
  const totalClicks = rows.reduce((s, r) => s + Math.min(r.clicks, r.imps), 0);
  const prior = totalImps > 0 ? totalClicks / totalImps : 0;
  const qualified = rows
    .filter((r) => r.imps >= MIN_IMPRESSIONS)
    // Clicks are counted for everyone, impressions only for users who allow usage stats: cap CTR at 1.
    .map((r) => ({ id: r.id, ctr: (Math.min(r.clicks, r.imps) + SMOOTHING * prior) / (r.imps + SMOOTHING) }));
  const out = new Map<string, number>();
  if (qualified.length < MIN_QUALIFIED) return out;
  qualified.sort((a, b) => a.ctr - b.ctr);
  // Ties share the lower rank, so identical rates get identical popularity.
  let rank = 0;
  qualified.forEach((q, i) => {
    if (i > 0 && q.ctr > qualified[i - 1].ctr) rank = i;
    out.set(q.id, Math.round((rank / (qualified.length - 1)) * 100) / 100);
  });
  return out;
}

export interface FeedQuery {
  lat?: number;
  lng?: number;
  country?: string;
  category?: CategoryId;
  interests: CategoryId[];
  affinity: Partial<Record<CategoryId, number>>;
  limit: number;
  offset: number;
}

/** Rank the catalog for one query. Offers with a location only appear when the user shared theirs and is within range. */
export function rankCatalog(offers: Offer[], q: Omit<FeedQuery, 'limit' | 'offset'>, now: Date): Offer[] {
  const loc = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
  const candidates = offers.filter(
    (o) =>
      (!q.category || o.category === q.category) &&
      isAvailableIn(o, q.country) &&
      (!o.location || (loc !== undefined && distanceKm(loc, o.location) <= LOCAL_RADIUS_KM)),
  );
  const profile: UserProfile = { ...EMPTY_PROFILE, interests: q.interests, categoryAffinity: q.affinity, location: loc };
  return rankFeed(candidates, profile, now)
    .slice(0, MAX_RANKED)
    .map((s) => s.offer);
}

interface Snapshot {
  version: string;
  offers: Offer[];
  expires: number;
}

/** In-memory snapshot of everything servable, with popularity attached. */
export class Catalog {
  private snap?: Snapshot;
  private ranked = new Map<string, { version: string; offers: Offer[] }>();

  constructor(
    private db: DB,
    private opts: { feedStaleHours: number; includeDemo: boolean; ttlMs: number },
  ) {}

  snapshot(now: Date): Snapshot {
    if (this.snap && this.snap.expires > now.getTime()) return this.snap;
    const nowIso = now.toISOString();
    const freshAfter = new Date(now.getTime() - this.opts.feedStaleHours * 3600_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT json_set(o.payload, '$.verifiedAt', o.last_seen_at) AS payload FROM offers o
         JOIN advertisers a ON a.id = o.advertiser_id
         LEFT JOIN feeds f ON f.id = o.feed_id
         WHERE o.status = 'active' AND a.status = 'active'
           AND (o.expires_at IS NULL OR o.expires_at > ?)
           AND (o.starts_at IS NULL OR o.starts_at <= ?)
           AND (o.feed_id IS NULL OR (f.enabled = 1 AND f.last_success_at > ?))
           AND (? = 1 OR a.is_demo = 0)`,
      )
      .all(nowIso, nowIso, freshAfter, this.opts.includeDemo ? 1 : 0) as { payload: string }[];
    const popularity = computePopularity(this.db, now);
    const offers = rows.map((r) => {
      const o = JSON.parse(r.payload) as Offer;
      const p = popularity.get(o.id);
      return p === undefined ? o : { ...o, popularity: p };
    });
    this.snap = { version: now.getTime().toString(36), offers, expires: now.getTime() + this.opts.ttlMs };
    this.ranked.clear();
    return this.snap;
  }

  /** One page of the ranked catalog. The cursor is an offset into a ranking cached for the snapshot. */
  page(q: FeedQuery, now: Date): { offers: Offer[]; nextOffset: number | null } {
    const snap = this.snapshot(now);
    const { limit, offset, ...rest } = q;
    const key = JSON.stringify(rest);
    let ranked = this.ranked.get(key);
    if (!ranked || ranked.version !== snap.version) {
      ranked = { version: snap.version, offers: rankCatalog(snap.offers, rest, now) };
      this.ranked.set(key, ranked);
      if (this.ranked.size > 200) this.ranked.delete(this.ranked.keys().next().value!);
    }
    // An offer may have expired since the snapshot; never serve it.
    const slice = ranked.offers.slice(offset, offset + limit).filter((o) => !o.expiresAt || Date.parse(o.expiresAt) > now.getTime());
    const next = offset + limit;
    return { offers: slice, nextOffset: next < ranked.offers.length ? next : null };
  }

  /** Drop caches (e.g. after an advertiser is suspended via the admin CLI in-process, or in tests). */
  invalidate(): void {
    this.snap = undefined;
    this.ranked.clear();
  }
}
