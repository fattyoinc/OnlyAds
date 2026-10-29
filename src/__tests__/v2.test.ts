import { _bufferSizes, _resetAnalytics, configureAnalytics, flushAnalytics, httpTransport, track, trackImpression, type Transport } from '@/services/analytics';
import { daysSinceBucket, dimsKey, sanitizeEvent } from '@/services/analyticsSchema';
import { backendProvider, mergeOffers, MAX_OFFERS_IN_MEMORY } from '@/services/providers';
import { validateOffer } from '@/services/offerValidation';
import { sanitize } from '@/state/persistence';
import type { Offer } from '@/types/offer';
import { isAvailableIn, verifiedLabel } from '@/utils/format';

const NOW = new Date('2026-11-15T12:00:00Z');
const raw = (id: string, extra: object = {}) => ({ id, title: `T ${id}`, url: 'https://acme.com/x', category: 'tech', advertiser: { id: 'acme', name: 'Acme' }, ...extra });
const ok = (id: string) => validateOffer(raw(id), NOW)!;
const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } }) as unknown as Response;

describe('ad model v2 validation', () => {
  it('accepts availability, verification time and campaign; normalizes and drops junk', () => {
    const o = validateOffer(raw('a', { availability: { countries: ['us', 'CO', 'USA', 7, 'us'], online: true }, verifiedAt: '2026-11-15T10:00:00Z', campaign: { id: 'xmas-26', network: 'awin', secret: 'x' } }), NOW)!;
    expect(o.availability).toEqual({ countries: ['US', 'CO'], online: true });
    expect(o.verifiedAt).toBe('2026-11-15T10:00:00.000Z');
    expect(o.campaign).toEqual({ id: 'xmas-26', network: 'awin' });
  });
  it('handles missing or malformed optional fields gracefully', () => {
    const o = validateOffer(raw('b', { availability: 'everywhere', verifiedAt: 'yesterday', campaign: { id: 'has spaces', network: 'Bad Net' } }), NOW)!;
    expect(o.availability).toBeUndefined();
    expect(o.verifiedAt).toBeUndefined();
    expect(o.campaign).toBeUndefined();
  });
  it('ignores verification times in the future (clock/feed errors)', () => {
    expect(validateOffer(raw('c', { verifiedAt: '2027-01-01T00:00:00Z' }), NOW)!.verifiedAt).toBeUndefined();
  });
});

describe('availability and verification rules', () => {
  it('hides offers restricted to other countries; unknown country or no restriction → shown', () => {
    const us: Pick<Offer, 'availability'> = { availability: { countries: ['US'] } };
    expect(isAvailableIn(us, 'US')).toBe(true);
    expect(isAvailableIn(us, 'co')).toBe(false);
    expect(isAvailableIn(us, undefined)).toBe(true);
    expect(isAvailableIn({}, 'CO')).toBe(true);
  });
  it('labels verification age', () => {
    expect(verifiedLabel({ verifiedAt: '2026-11-15T09:00:00Z' }, NOW)).toBe('Checked 3h ago');
    expect(verifiedLabel({ verifiedAt: '2026-11-10T12:00:00Z' }, NOW)).toBe('Checked 5 days ago');
    expect(verifiedLabel({}, NOW)).toBeUndefined();
  });
});

describe('pagination', () => {
  it('merges pages without duplicates and keeps memory bounded', () => {
    const a = [ok('1'), ok('2')];
    expect(mergeOffers(a, [ok('2'), ok('3'), ok('3')]).map((o) => o.id)).toEqual(['1', '2', '3']);
    const many = Array.from({ length: MAX_OFFERS_IN_MEMORY + 10 }, (_, i) => ok(`m${i}`));
    const merged = mergeOffers([], many);
    expect(merged).toHaveLength(MAX_OFFERS_IN_MEMORY);
    expect(merged.at(-1)!.id).toBe(`m${MAX_OFFERS_IN_MEMORY + 9}`);
  });
  it('requests one page at a time with country + cursor, and rejects malformed cursors', async () => {
    const f = jest.fn().mockResolvedValueOnce(res({ offers: [raw('1')], nextCursor: 'abc_-1' })).mockResolvedValueOnce(res({ offers: [raw('2')], nextCursor: '../../etc' }));
    const p = backendProvider('https://api.onlyads.app', { fetchImpl: f });
    const first = await p.fetchPage!({ now: NOW, country: 'CO' });
    expect(first.nextCursor).toBe('abc_-1');
    expect(f.mock.calls[0][0]).toBe('https://api.onlyads.app/v1/feed?country=CO&limit=40');
    const second = await p.fetchPage!({ now: NOW, country: 'CO' }, first.nextCursor);
    expect(f.mock.calls[1][0]).toContain('cursor=abc_-1');
    expect(second.nextCursor).toBeUndefined();
  });
});

describe('analytics: consent, buffering, transport', () => {
  const mk = () => {
    const t = { sendEvents: jest.fn(async () => {}), sendImpressions: jest.fn(async () => {}) } satisfies Transport;
    return t;
  };
  beforeEach(() => _resetAnalytics());

  it('buffers before the choice is known, then sends on opt-in', async () => {
    track('app_open', { returning: false, days_since: 'first' });
    track('onboarding_complete', { interests_count: 2, location_enabled: false });
    expect(_bufferSizes().events).toBe(2);
    const t = mk();
    configureAnalytics({ enabled: true, transport: t });
    await flushAnalytics();
    expect(t.sendEvents).toHaveBeenCalledTimes(1);
    expect((t.sendEvents.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(2);
  });

  it('discards everything and sends nothing on opt-out', async () => {
    track('app_open', {});
    trackImpression('o1', false);
    const t = mk();
    configureAnalytics({ enabled: false, transport: t });
    track('search', { results_bucket: '1-5' });
    await flushAnalytics();
    expect(t.sendEvents).not.toHaveBeenCalled();
    expect(t.sendImpressions).not.toHaveBeenCalled();
    expect(_bufferSizes()).toEqual({ events: 0, impressions: 0 });
  });

  it('counts each impression once per session and never sends demo offers', async () => {
    const t = mk();
    configureAnalytics({ enabled: true, transport: t });
    trackImpression('o1', false);
    trackImpression('o1', false);
    trackImpression('sample-x', true);
    await flushAnalytics();
    expect(t.sendImpressions).toHaveBeenCalledWith(['o1']);
  });

  it('strips non-allow-listed properties before anything leaves the app', async () => {
    const t = mk();
    configureAnalytics({ enabled: true, transport: t });
    track('search', { results_bucket: '1-5', query: 'divorce lawyer', has_filters: true });
    await flushAnalytics();
    expect((t.sendEvents.mock.calls[0] as unknown as [unknown[]])[0]).toEqual([{ name: 'search', props: { results_bucket: '1-5', has_filters: true } }]);
  });

  it('http transport posts JSON to the first-party endpoints', async () => {
    const f = jest.fn(async () => ({ ok: true }) as Response);
    const t = httpTransport('https://api.onlyads.app', f as unknown as typeof fetch);
    await t.sendEvents([{ name: 'app_open', props: {} }]);
    await t.sendImpressions(['o1']);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://api.onlyads.app/v1/events');
    expect(calls[1][0]).toBe('https://api.onlyads.app/v1/impressions');
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ offerIds: ['o1'] });
  });
});

describe('analytics schema (shared by app and server)', () => {
  it('rejects unknown events, free text and identifiers', () => {
    expect(sanitizeEvent('hack', {})).toBeNull();
    expect(sanitizeEvent('error', { context: 'TypeError: cannot read x of user jane@doe.com' })!.props).toEqual({});
    expect(sanitizeEvent('category_select', { category: 'food', surface: 'discover', extra: 1 })!.props).toEqual({ category: 'food', surface: 'discover' });
    expect(sanitizeEvent('onboarding_complete', { interests_count: 99999 })!.props).toEqual({});
  });
  it('aggregation key is order-independent', () => {
    expect(dimsKey({ b: 1, a: 'x' })).toBe(dimsKey({ a: 'x', b: 1 }));
  });
  it('buckets return visits without timestamps', () => {
    expect(daysSinceBucket(undefined)).toBe('first');
    expect(daysSinceBucket(3 * 3600_000)).toBe('0');
    expect(daysSinceBucket(5 * 86_400_000)).toBe('2-7');
    expect(daysSinceBucket(90 * 86_400_000)).toBe('31+');
  });
});

describe('persistence of new settings', () => {
  it('defaults analytics consent to on, keeps an explicit opt-out, and ignores future timestamps', () => {
    expect(sanitize({}).analyticsConsent).toBe(true);
    expect(sanitize({ analyticsConsent: false }).analyticsConsent).toBe(false);
    expect(sanitize({ lastOpenAt: Date.now() + 1e9 }).lastOpenAt).toBeUndefined();
  });
});
