import { readFileSync } from 'fs';
import { join } from 'path';

import { CATEGORIES } from '@/data/categories';
import { buildSampleOffers, DEFAULT_ANCHOR } from '@/data/sampleOffers';
import { aggregateOffers, backendProvider, sampleProvider, validateOffer, type OfferProvider } from '@/services/providers';
import { feedRowsToOffers, mapCategory, parseDelimited, parseEffectiveDate, parsePrice } from '@/services/providers/productFeed';
import { applySignal, EMPTY_PROFILE, rankFeed, scoreOffer, type UserProfile } from '@/services/ranking';
import { matchScore, searchOffers } from '@/services/search';
import { dealBadge, discountPercent, distanceKm, expiryLabel, formatMoney, isExpired } from '@/utils/format';

const NOW = new Date('2026-11-15T12:00:00Z');
const offers = buildSampleOffers(NOW);
const byId = (id: string) => offers.find((o) => o.id === `sample-${id}`)!;

describe('sample catalog', () => {
  it('has unique ids, valid categories and covers every category', () => {
    expect(new Set(offers.map((o) => o.id)).size).toBe(offers.length);
    const cats = new Set(offers.map((o) => o.category));
    for (const c of CATEGORIES) expect(cats.has(c.id)).toBe(true);
  });
  it('is fully disclosed as simulated and points at a non-routable demo domain', () => {
    for (const o of offers) {
      expect(o.source).toBe('sample');
      expect(o.url.startsWith('https://example.com/')).toBe(true);
    }
  });
  it('never ships an offer that is already expired at build time', () => {
    expect(offers.filter((o) => isExpired(o, NOW))).toHaveLength(0);
  });
  it('places local offers relative to the anchor', () => {
    const nyc = { lat: 40.71, lng: -74.0 };
    const moved = buildSampleOffers(NOW, nyc).filter((o) => o.location);
    expect(moved.length).toBeGreaterThan(5);
    for (const o of moved) expect(distanceKm(nyc, o.location!)).toBeLessThan(6);
  });
});

describe('format utils', () => {
  it('computes discounts and badges', () => {
    expect(discountPercent({ price: { amount: 58, currency: 'USD' }, originalPrice: { amount: 90, currency: 'USD' } })).toBe(36);
    expect(discountPercent({ price: { amount: 90, currency: 'USD' }, originalPrice: { amount: 58, currency: 'USD' } })).toBeUndefined();
    expect(discountPercent({ price: { amount: 5, currency: 'USD' }, originalPrice: { amount: 9, currency: 'EUR' } })).toBeUndefined();
    expect(dealBadge(byId('s2'))).toBe('-36%');
    expect(dealBadge(byId('f1'))).toBe('2 for 1');
  });
  it('formats money', () => {
    expect(formatMoney({ amount: 49, currency: 'USD' })).toBe('$49');
    expect(formatMoney({ amount: 59.99, currency: 'USD' })).toBe('$59.99');
  });
  it('labels expiry', () => {
    const at = (h: number) => ({ expiresAt: new Date(NOW.getTime() + h * 3600_000).toISOString() });
    expect(expiryLabel(at(5), NOW)).toBe('Ends in 5h');
    expect(expiryLabel(at(24 * 4), NOW)).toBe('Ends in 4 days');
    expect(expiryLabel(at(-1), NOW)).toBe('Expired');
    expect(expiryLabel({}, NOW)).toBeUndefined();
  });
  it('computes haversine distance', () => {
    // Miami → Fort Lauderdale is roughly 40 km.
    expect(distanceKm(DEFAULT_ANCHOR, { lat: 26.1224, lng: -80.1373 })).toBeGreaterThan(38);
    expect(distanceKm(DEFAULT_ANCHOR, { lat: 26.1224, lng: -80.1373 })).toBeLessThan(42);
  });
});

describe('ranking', () => {
  const profile: UserProfile = { ...EMPTY_PROFILE, interests: ['sneakers'] };

  it('boosts chosen interests', () => {
    const sneaker = scoreOffer(byId('s2'), profile, NOW);
    const noInterest = scoreOffer(byId('s2'), EMPTY_PROFILE, NOW);
    expect(sneaker.score).toBeGreaterThan(noInterest.score + 2);
    expect(sneaker.reasons).toContain('Matches an interest you picked');
  });

  it('learns from saves and dismissals', () => {
    let p = applySignal(EMPTY_PROFILE, byId('h2'), 'save');
    p = applySignal(p, byId('h3'), 'save');
    expect(p.categoryAffinity.home).toBe(6);
    const after = scoreOffer(byId('h5'), p, NOW).score;
    expect(after).toBeGreaterThan(scoreOffer(byId('h5'), EMPTY_PROFILE, NOW).score);

    const dismissed = applySignal(EMPTY_PROFILE, byId('t5'), 'dismiss');
    expect(dismissed.hiddenOfferIds).toContain(byId('t5').id);
    expect(rankFeed(offers, dismissed, NOW).some((s) => s.offer.id === byId('t5').id)).toBe(false);
  });

  it('excludes muted advertisers and expired offers', () => {
    const muted = { ...EMPTY_PROFILE, mutedAdvertiserIds: [byId('a2').advertiser.id] };
    expect(rankFeed(offers, muted, NOW).some((s) => s.offer.advertiser.id === byId('a2').advertiser.id)).toBe(false);
    const later = new Date(NOW.getTime() + 24 * 3600_000 * 40);
    expect(rankFeed(offers, EMPTY_PROFILE, later)).toHaveLength(0);
  });

  it('keeps the feed diverse: no category dominates the top 6', () => {
    const p = { ...EMPTY_PROFILE, interests: ['food' as const] };
    const top = rankFeed(offers, p, NOW).slice(0, 6);
    const food = top.filter((s) => s.offer.category === 'food').length;
    expect(food).toBeGreaterThanOrEqual(1);
    expect(food).toBeLessThanOrEqual(3);
  });

  it('ranks nearby local offers higher and explains why', () => {
    const p = { ...EMPTY_PROFILE, location: DEFAULT_ANCHOR };
    const s = scoreOffer(byId('f5'), p, NOW);
    expect(s.distanceKm).toBeLessThan(2);
    expect(s.reasons).toContain('Near you');
  });

  it('sponsored placement is only a tie-breaker, never beats a chosen interest', () => {
    const p = { ...EMPTY_PROFILE, interests: ['grocery' as const] };
    const organic = scoreOffer(byId('r3'), p, NOW); // grocery, not sponsored
    const paid = scoreOffer(byId('t5'), p, NOW); // tech, sponsored
    expect(organic.score).toBeGreaterThan(paid.score);
  });
});

describe('search', () => {
  it('matches title, tags and brand, with plural folding', () => {
    expect(searchOffers(offers, 'pizza', {}, 'relevance', { now: NOW })[0].id).toBe('sample-f1');
    expect(searchOffers(offers, 'sneakers', {}, 'relevance', { now: NOW }).length).toBeGreaterThan(3);
    expect(searchOffers(offers, 'Sonora', {}, 'relevance', { now: NOW })[0].id).toBe('sample-t1');
  });
  it('tolerates a single typo on longer words', () => {
    expect(matchScore(byId('t1'), 'hedphones')).toBeGreaterThan(0);
    expect(matchScore(byId('t1'), 'pizza')).toBe(0);
  });
  it('requires every token to match', () => {
    expect(searchOffers(offers, 'gift coffee', {}, 'relevance', { now: NOW }).map((o) => o.id)).toContain('sample-g5');
    expect(searchOffers(offers, 'gift zzzz', {}, 'relevance', { now: NOW })).toHaveLength(0);
  });
  it('filters and sorts', () => {
    const cheap = searchOffers(offers, '', { maxPrice: 50 }, 'price', { now: NOW });
    expect(cheap.every((o) => o.price!.amount <= 50)).toBe(true);
    expect(cheap[0].price!.amount).toBeLessThanOrEqual(cheap[cheap.length - 1].price!.amount);
    expect(searchOffers(offers, '', { onlyWithCode: true }, 'relevance', { now: NOW }).every((o) => !!o.promoCode)).toBe(true);
    const ending = searchOffers(offers, '', {}, 'ending', { now: NOW });
    expect(new Date(ending[0].expiresAt!).getTime()).toBeLessThanOrEqual(new Date(ending[1].expiresAt!).getTime());
  });
});

describe('product feed (Merchant Center / Meta catalog format)', () => {
  const tsv = readFileSync(join(__dirname, 'fixtures/merchant-feed.tsv'), 'utf8');

  it('parses TSV and quoted CSV', () => {
    expect(parseDelimited(tsv)).toHaveLength(5);
    const csv = 'id,title,price\n1,"Mug, ""Large""",12 USD\r\n2,Plate,8 USD\n';
    const rows = parseDelimited(csv);
    expect(rows[0].title).toBe('Mug, "Large"');
    expect(rows[1].price).toBe('8 USD');
  });
  it('parses prices and effective dates', () => {
    expect(parsePrice('15.00 USD')).toEqual({ amount: 15, currency: 'USD' });
    expect(parsePrice('USD 1,299.50')).toEqual({ amount: 1299.5, currency: 'USD' });
    expect(parsePrice('free')).toBeUndefined();
    const [a, b] = parseEffectiveDate('2026-11-01T00:00-0800/2026-11-30T23:59-0800');
    expect(a).toBe('2026-11-01T08:00:00.000Z');
    expect(b).toBe('2026-12-01T07:59:00.000Z');
  });
  it('maps rows to offers, skipping out-of-stock and non-https rows, and honoring sale windows', () => {
    const result = feedRowsToOffers(parseDelimited(tsv), { feedId: 'exampleco', advertiserName: 'ExampleCo' }, NOW);
    expect(result.map((o) => o.title)).toEqual(['Trail Runner X', 'Wireless Earbuds', 'Expired Sale Lamp']);
    const [shoe, buds, lamp] = result;
    expect(shoe.category).toBe('sneakers');
    expect(shoe.price).toEqual({ amount: 84, currency: 'USD' });
    expect(shoe.originalPrice).toEqual({ amount: 120, currency: 'USD' });
    expect(shoe.imageUrl).toBe('https://img.example.com/1.jpg');
    expect(shoe.source).toBe('merchant_feed');
    expect(buds.category).toBe('tech');
    expect(buds.originalPrice).toBeUndefined();
    // Sale ended in January, so the regular price applies.
    expect(lamp.price).toEqual({ amount: 80, currency: 'USD' });
    expect(lamp.originalPrice).toBeUndefined();
    expect(mapCategory({ custom_label_0: 'beauty' })).toBe('beauty');
  });
});

describe('providers', () => {
  const ctx = { now: NOW, location: DEFAULT_ANCHOR };

  it('reports an unconfigured API as disabled rather than pretending', () => {
    expect(backendProvider(undefined).status).toBe('disabled');
    expect(sampleProvider.status).toBe('simulated');
  });

  it('rejects unsafe or malformed offers from the network', () => {
    const base = { id: 'x', title: 'T', url: 'https://shop.example.com/p', category: 'tech', advertiser: { id: 'a', name: 'A' } };
    expect(validateOffer({ ...base, url: 'javascript:alert(1)' })).toBeUndefined();
    expect(validateOffer({ ...base, url: 'http://shop.example.com' })).toBeUndefined();
    expect(validateOffer({ ...base, category: 'nope' })).toBeUndefined();
    expect(validateOffer({ ...base, advertiser: { name: 'A' } })).toBeUndefined();
    const ok = validateOffer({ ...base, source: 'sample', tags: 'not-an-array', price: { amount: 'free' }, imageUrl: 'file:///etc/passwd', creative: { colors: ['red'] }, extra: { evil: true } });
    expect(ok).toBeDefined();
    expect(ok!.source).toBe('direct'); // "sample" can never come from the network
    expect(ok!.tags).toEqual([]);
    expect(ok!.price).toBeUndefined();
    expect(ok!.imageUrl).toBeUndefined();
    expect(ok!.creative.colors).toHaveLength(2);
    expect((ok as unknown as Record<string, unknown>).extra).toBeUndefined();
  });

  it('aggregates, de-duplicates, and survives a failing provider', async () => {
    const failing: OfferProvider = { id: 'bad', label: 'bad', status: 'live', description: '', fetchOffers: async () => { throw new Error('boom'); } };
    const dup: OfferProvider = { ...sampleProvider, id: 'dup' };
    const res = await aggregateOffers([sampleProvider, dup, failing, backendProvider(undefined)], ctx);
    expect(res.offers).toHaveLength(offers.length);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].providerId).toBe('bad');
  });
});
