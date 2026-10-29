/**
 * On-device personalization. Ranking uses ONLY signals the user gave us in this
 * app (chosen interests, saves, taps, "not interested") plus optional location.
 * No third-party ad profile is read — see docs/INTEGRATIONS.md for why.
 */
import type { CategoryId, GeoPoint, Offer } from '@/types/offer';
import { discountPercent, distanceKm, hoursLeft, isExpired } from '@/utils/format';

export type SignalType = 'view' | 'open' | 'save' | 'click' | 'dismiss';

export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  view: 0.1,
  open: 1,
  save: 3,
  click: 4,
  dismiss: -4,
};

export interface UserProfile {
  interests: CategoryId[];
  categoryAffinity: Partial<Record<CategoryId, number>>;
  tagAffinity: Record<string, number>;
  advertiserAffinity: Record<string, number>;
  hiddenOfferIds: string[];
  mutedAdvertiserIds: string[];
  location?: GeoPoint;
}

export const EMPTY_PROFILE: UserProfile = {
  interests: [],
  categoryAffinity: {},
  tagAffinity: {},
  advertiserAffinity: {},
  hiddenOfferIds: [],
  mutedAdvertiserIds: [],
};

/** Pure reducer: fold one engagement signal into the profile. */
export function applySignal(p: UserProfile, offer: Offer, type: SignalType): UserProfile {
  const w = SIGNAL_WEIGHTS[type];
  const clamp = (n: number) => Math.max(-10, Math.min(50, n));
  const tagAffinity = { ...p.tagAffinity };
  for (const t of offer.tags) tagAffinity[t] = clamp((tagAffinity[t] ?? 0) + w * 0.5);
  return {
    ...p,
    categoryAffinity: { ...p.categoryAffinity, [offer.category]: clamp((p.categoryAffinity[offer.category] ?? 0) + w) },
    tagAffinity,
    advertiserAffinity: {
      ...p.advertiserAffinity,
      [offer.advertiser.id]: clamp((p.advertiserAffinity[offer.advertiser.id] ?? 0) + w),
    },
    hiddenOfferIds: type === 'dismiss' && !p.hiddenOfferIds.includes(offer.id) ? [...p.hiddenOfferIds, offer.id].slice(-500) : p.hiddenOfferIds,
  };
}

export interface ScoredOffer {
  offer: Offer;
  score: number;
  reasons: string[];
  distanceKm?: number;
}

/** Soft log for signed affinity values. */
const slog = (n: number) => Math.sign(n) * Math.log1p(Math.abs(n));

export function scoreOffer(offer: Offer, p: UserProfile, now: Date = new Date()): ScoredOffer {
  const reasons: string[] = [];
  let score = 0;

  if (p.interests.includes(offer.category)) {
    score += 3;
    reasons.push('Matches an interest you picked');
  }
  const cat = p.categoryAffinity[offer.category] ?? 0;
  if (cat !== 0) {
    score += slog(cat) * 1.2;
    if (cat > 2) reasons.push('Similar to offers you saved or opened');
  }
  const tagSum = offer.tags.reduce((s, t) => s + (p.tagAffinity[t] ?? 0), 0);
  if (tagSum !== 0) score += slog(tagSum) * 0.6;
  const adv = p.advertiserAffinity[offer.advertiser.id] ?? 0;
  if (adv !== 0) {
    score += slog(adv) * 0.8;
    if (adv > 2) reasons.push(`You’ve engaged with ${offer.advertiser.name} before`);
  }

  const pct = discountPercent(offer);
  if (pct) {
    score += Math.min(pct, 60) / 40; // up to +1.5
    if (pct >= 30) reasons.push(`Big discount (${pct}% off)`);
  } else if (offer.promoLabel) {
    score += 0.5;
  }

  const h = hoursLeft(offer, now);
  if (h !== undefined && h > 0 && h <= 48) {
    score += 0.6 * (1 - h / 48) + 0.2;
    reasons.push('Ending soon');
  }

  const ageH = (now.getTime() - new Date(offer.createdAt).getTime()) / 3600_000;
  if (ageH >= 0 && ageH < 24) {
    score += 0.4;
    reasons.push('New today');
  }

  let dist: number | undefined;
  if (offer.location && p.location) {
    dist = distanceKm(p.location, offer.location);
    if (dist < 10) {
      score += 1.2 * (1 - dist / 10);
      reasons.push('Near you');
    }
  }

  if (offer.rating) score += (offer.rating - 4) * 0.4;
  // Aggregate, anonymous click-through percentile. Helps most when we know little about the user.
  if (offer.popularity !== undefined) {
    score += offer.popularity * 0.9;
    if (offer.popularity >= 0.8) reasons.push('Popular right now');
  }
  // Paid placement is a small tie-breaker only: relevance always dominates.
  if (offer.sponsored) score += 0.25;

  if (reasons.length === 0) reasons.push('Recommended for everyone');
  return { offer, score, reasons, distanceKm: dist };
}

export function isEligible(offer: Offer, p: UserProfile, now: Date = new Date()): boolean {
  return !isExpired(offer, now) && !p.hiddenOfferIds.includes(offer.id) && !p.mutedAdvertiserIds.includes(offer.advertiser.id);
}

/**
 * Rank for the "For You" feed: score, then greedily re-rank so one category
 * can't flood the top of the feed (diversity penalty per prior same-category pick).
 */
export function rankFeed(offers: Offer[], p: UserProfile, now: Date = new Date(), diversity = 1.2): ScoredOffer[] {
  const pool = offers.filter((o) => isEligible(o, p, now)).map((o) => scoreOffer(o, p, now));
  pool.sort((a, b) => b.score - a.score);
  const out: ScoredOffer[] = [];
  const seen: Record<string, number> = {};
  while (pool.length) {
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 12); i++) {
      const v = pool[i].score - diversity * (seen[pool[i].offer.category] ?? 0);
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    const [pick] = pool.splice(best, 1);
    seen[pick.offer.category] = (seen[pick.offer.category] ?? 0) + 1;
    out.push(pick);
  }
  return out;
}

/**
 * Coarse category preferences for server-side ranking: a few buckets per category,
 * never raw counts, tags, advertisers, or history. Interests are sent as picked.
 */
export function feedPreferences(p: Pick<UserProfile, 'interests' | 'categoryAffinity'>): { interests: CategoryId[]; affinity: string } {
  const bucket = (v: number) => (v <= -5 ? -2 : v < 0 ? -1 : v === 0 ? 0 : v < 4 ? 1 : v < 12 ? 2 : 3);
  const affinity = Object.entries(p.categoryAffinity)
    .map(([c, v]) => [c, bucket(v ?? 0)] as const)
    .filter(([, b]) => b !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([c, b]) => `${c}:${b}`)
    .join(',');
  return { interests: [...p.interests].sort(), affinity };
}
