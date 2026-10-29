import { CATEGORIES } from '@/data/categories';
import type { CategoryId, Offer } from '@/types/offer';
import { discountPercent, hoursLeft } from '@/utils/format';

export type SortMode = 'relevance' | 'discount' | 'ending' | 'price' | 'distance';

export interface SearchFilters {
  categories?: CategoryId[];
  maxPrice?: number;
  onlyWithCode?: boolean;
  onlyLocal?: boolean;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9$%\s]/g, ' ');

function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter(Boolean);
}

/** Cheap plural/suffix folding so "sneaker" matches "sneakers", "gifts" matches "gift". */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('es') && /(sh|ch|x|s)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Within edit distance 1 (for typo tolerance on tokens of length >= 5). */
function nearMatch(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

interface Field {
  text: string[];
  weight: number;
}

function fieldsFor(o: Offer): Field[] {
  const cat = CATEGORIES.find((c) => c.id === o.category);
  return [
    { text: tokens(o.title).map(stem), weight: 4 },
    { text: tokens(o.advertiser.name).map(stem), weight: 3 },
    { text: o.tags.flatMap(tokens).map(stem), weight: 3 },
    { text: tokens(`${cat?.name ?? ''} ${o.category}`).map(stem), weight: 2 },
    { text: tokens(`${o.subtitle ?? ''} ${o.promoLabel ?? ''}`).map(stem), weight: 1.5 },
    { text: tokens(o.description).map(stem), weight: 1 },
    { text: tokens(o.location?.placeName ?? '').map(stem), weight: 2 },
  ];
}

/** Returns a relevance score; 0 means "every query token must match" failed. */
export function matchScore(o: Offer, query: string): number {
  const q = tokens(query).map(stem);
  if (q.length === 0) return 1;
  const fields = fieldsFor(o);
  let total = 0;
  for (const qt of q) {
    let best = 0;
    for (const f of fields) {
      for (const t of f.text) {
        let s = 0;
        if (t === qt) s = f.weight;
        else if (t.startsWith(qt) && qt.length >= 2) s = f.weight * 0.75;
        else if (qt.length >= 5 && nearMatch(t, qt)) s = f.weight * 0.5;
        if (s > best) best = s;
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export interface SearchContext {
  now?: Date;
  distanceOf?: (o: Offer) => number | undefined;
}

export function searchOffers(
  offers: Offer[],
  query: string,
  filters: SearchFilters = {},
  sort: SortMode = 'relevance',
  ctx: SearchContext = {},
): Offer[] {
  const now = ctx.now ?? new Date();
  const scored: { o: Offer; s: number }[] = [];
  for (const o of offers) {
    if (filters.categories?.length && !filters.categories.includes(o.category)) continue;
    if (filters.maxPrice != null && (!o.price || o.price.amount > filters.maxPrice)) continue;
    if (filters.onlyWithCode && !o.promoCode) continue;
    if (filters.onlyLocal && !o.location) continue;
    const h = hoursLeft(o, now);
    if (h !== undefined && h <= 0) continue;
    const s = matchScore(o, query);
    if (s > 0) scored.push({ o, s });
  }
  const far = Number.MAX_SAFE_INTEGER;
  const cmp: Record<SortMode, (a: { o: Offer; s: number }, b: { o: Offer; s: number }) => number> = {
    relevance: (a, b) => b.s - a.s,
    discount: (a, b) => (discountPercent(b.o) ?? 0) - (discountPercent(a.o) ?? 0),
    ending: (a, b) => (hoursLeft(a.o, now) ?? far) - (hoursLeft(b.o, now) ?? far),
    price: (a, b) => (a.o.price?.amount ?? far) - (b.o.price?.amount ?? far),
    distance: (a, b) => (ctx.distanceOf?.(a.o) ?? far) - (ctx.distanceOf?.(b.o) ?? far),
  };
  return scored.sort((a, b) => cmp[sort](a, b) || b.s - a.s).map((x) => x.o);
}

export const TRENDING_SEARCHES = ['gift ideas', 'pizza', 'headphones', 'running shoes', 'weekend getaway', 'skincare', 'christmas', 'happy hour'];
