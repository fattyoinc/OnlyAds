import { resolveConfig } from '@/config';
import { buildSampleOffers } from '@/data/sampleOffers';
import { bucket, setAnalyticsSink, track } from '@/services/analytics';
import { getJson, HttpError, TimeoutError, describeError } from '@/services/http';
import { recentErrors, reportError, scrub, setErrorSink } from '@/services/monitoring';
import { backendProvider, defaultProviders } from '@/services/providers';
import { hostMatchesDomain, isSafeHttpsUrl, parseSafeHttpsUrl } from '@/services/urlSafety';
import { decodeCache, encodeCache } from '@/state/offerCache';
import { decode, LIMITS, sanitize, SCHEMA_VERSION } from '@/state/persistence';

const NOW = new Date('2026-11-15T12:00:00Z');
const noSleep = () => Promise.resolve();

describe('URL safety', () => {
  it.each([
    ['https://shop.example.com/p?x=1', true],
    ['HTTPS://Shop.Example.com', true],
    ['https://xn--bcher-kva.example/p', true],
    ['http://shop.example.com', false],
    ['javascript:alert(1)', false],
    ['https://user:pass@shop.example.com', false],
    ['https://evil.com@shop.example.com', false],
    ['https://192.168.1.10/admin', false],
    ['https://127.0.0.1', false],
    ['https://0x7f000001', false],
    ['https://[::1]/', false],
    ['https://localhost/x', false],
    ['https://printer.local/x', false],
    ['https://shop.example.com:8443/x', false],
    ['https://shop.example.com\\@evil.com', false],
    ['https://exa mple.com', false],
    ['https://-bad-.example.com', false],
    ['https://example', false],
    [`https://e.com/${'a'.repeat(2100)}`, false],
    [42, false],
  ])('%s → %s', (url, ok) => {
    expect(isSafeHttpsUrl(url)).toBe(ok);
  });
  it('allows explicit ports only when asked (API base URLs)', () => {
    expect(parseSafeHttpsUrl('https://api.example.com:8443', { allowPort: true })?.port).toBe(8443);
  });
  it('matches advertiser domains without suffix tricks', () => {
    expect(hostMatchesDomain('shop.acme.com', 'acme.com')).toBe(true);
    expect(hostMatchesDomain('acme.com', 'acme.com')).toBe(true);
    expect(hostMatchesDomain('evilacme.com', 'acme.com')).toBe(false);
    expect(hostMatchesDomain('acme.com.evil.io', 'acme.com')).toBe(false);
  });
});

describe('config (environment separation)', () => {
  it('never enables the demo catalog in production', () => {
    const prod = resolveConfig({ APP_ENV: 'production', OFFERS_API_URL: 'https://api.onlyads.app', isDevBuild: false });
    expect(prod.demoCatalog).toBe(false);
    expect(defaultProviders(prod).map((p) => p.id)).toEqual(['backend']);
  });
  it('defaults release builds with no env to production (safe default)', () => {
    expect(resolveConfig({ isDevBuild: false }).env).toBe('production');
    expect(resolveConfig({ isDevBuild: true }).env).toBe('development');
  });
  it('rejects non-https API URLs outside local development', () => {
    const prod = resolveConfig({ APP_ENV: 'production', OFFERS_API_URL: 'http://api.onlyads.app', isDevBuild: false });
    expect(prod.apiUrl).toBeUndefined();
    expect(prod.warnings.join(' ')).toMatch(/https/);
    const dev = resolveConfig({ APP_ENV: 'development', OFFERS_API_URL: 'http://localhost:8787/', isDevBuild: true });
    expect(dev.apiUrl).toBe('http://localhost:8787');
    expect(resolveConfig({ APP_ENV: 'production', OFFERS_API_URL: 'http://localhost:8787', isDevBuild: false }).apiUrl).toBeUndefined();
  });
  it('warns when production has no API', () => {
    expect(resolveConfig({ APP_ENV: 'production', isDevBuild: false }).warnings.length).toBeGreaterThan(0);
  });
});

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k: string) => headers[k] ?? null } } as unknown as Response;
}

describe('http: timeouts and retries', () => {
  it('retries 5xx then succeeds', async () => {
    const f = jest.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { ok: 1 }));
    await expect(getJson('https://api.example.com/x', { fetchImpl: f, sleep: noSleep })).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not retry 4xx', async () => {
    const f = jest.fn().mockResolvedValue(res(404));
    await expect(getJson('https://api.example.com/x', { fetchImpl: f, sleep: noSleep })).rejects.toBeInstanceOf(HttpError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('honors Retry-After on 429', async () => {
    const sleep = jest.fn(noSleep);
    const f = jest.fn().mockResolvedValueOnce(res(429, {}, { 'Retry-After': '2' })).mockResolvedValueOnce(res(200, []));
    await getJson('https://api.example.com/x', { fetchImpl: f, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it('gives up after bounded retries on network failure', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(getJson('https://api.example.com/x', { fetchImpl: f, sleep: noSleep, retries: 2 })).rejects.toThrow('Network request failed');
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('times out a hanging request', async () => {
    const hanging = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    await expect(getJson('https://api.example.com/x', { fetchImpl: hanging as typeof fetch, timeoutMs: 20, retries: 0 })).rejects.toBeInstanceOf(TimeoutError);
  });
  it('produces user-safe messages without URLs', () => {
    expect(describeError(new TimeoutError(10))).not.toMatch(/http/);
    expect(describeError(new TypeError('Network request failed to https://secret'))).not.toMatch(/secret/);
  });
});

describe('backend provider', () => {
  it('paginates, validates every item, and routes clicks via the redirect', async () => {
    const page1 = { offers: [{ id: 'a1', title: 'A', url: 'https://acme.com/a', category: 'tech', advertiser: { id: 'acme', name: 'Acme' } }, { id: 'bad', title: 'x', url: 'javascript:x', category: 'tech', advertiser: { id: 'z', name: 'Z' } }], nextCursor: 'c1' };
    const page2 = { offers: [{ id: 'a2', title: 'B', url: 'https://acme.com/b', category: 'home', advertiser: { id: 'acme', name: 'Acme' } }], nextCursor: null };
    const f = jest.fn().mockResolvedValueOnce(res(200, page1)).mockResolvedValueOnce(res(200, page2));
    const p = backendProvider('https://api.onlyads.app', { fetchImpl: f, sleep: noSleep });
    const ctx = { now: NOW, location: { lat: 25.76171234, lng: -80.19181234 } };
    const first = await p.fetchPage!(ctx);
    expect(first.offers.map((o) => o.id)).toEqual(['a1']); // unsafe item dropped
    expect(first.offers[0].clickUrl).toBe('https://api.onlyads.app/v1/click/a1');
    expect(f.mock.calls[0][0] as string).toContain('lat=25.76&lng=-80.19'); // coarse location only
    const second = await p.fetchPage!(ctx, first.nextCursor);
    expect(second.offers.map((o) => o.id)).toEqual(['a2']);
    expect(f.mock.calls[1][0]).toContain('cursor=c1');
    expect(second.nextCursor).toBeUndefined();
  });
  it('omits location entirely when the user has not opted in', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { offers: [] }));
    await backendProvider('https://api.onlyads.app', { fetchImpl: f }).fetchOffers({ now: NOW });
    expect(f.mock.calls[0][0]).not.toMatch(/lat=|lng=/);
  });
});

describe('persistence: migration and corruption', () => {
  it('returns null (→ defaults) for corrupt JSON', () => {
    expect(decode('{not json')).toBeNull();
    expect(decode(null)).toBeNull();
  });
  it('sanitizes wrong types without crashing', () => {
    const s = sanitize({ onboarded: 'yes', profile: { interests: 'food', categoryAffinity: { food: 'x', nope: 3, tech: 2 } }, savedOrder: 7, recentSearches: [1, 'pizza'] });
    expect(s.onboarded).toBe(false);
    expect(s.profile.interests).toEqual([]);
    expect(s.profile.categoryAffinity).toEqual({ tech: 2 });
    expect(s.savedOrder).toEqual([]);
    expect(s.recentSearches).toEqual(['pizza']);
  });
  it('migrates v1 MVP data (no version) and keeps valid saves', () => {
    const offer = buildSampleOffers(NOW)[0];
    const v1 = { onboarded: true, profile: { interests: ['food'], categoryAffinity: {}, tagAffinity: {}, advertiserAffinity: {}, hiddenOfferIds: [], mutedAdvertiserIds: [], location: { lat: 25.761712, lng: -80.191812 } }, saved: { [offer.id]: offer }, savedOrder: [offer.id], recentSearches: [], locationEnabled: true };
    const s = sanitize(v1, NOW);
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.onboarded).toBe(true);
    expect(s.savedOrder).toEqual([offer.id]);
    expect(s.saved[offer.id].source).toBe('sample');
    expect(s.profile.location).toEqual({ lat: 25.76, lng: -80.19 }); // re-coarsened
  });
  it('drops location if the toggle is off, and caps list sizes', () => {
    const s = sanitize({ profile: { location: { lat: 1, lng: 2 }, hiddenOfferIds: Array.from({ length: 900 }, (_, i) => `o${i}`) }, locationEnabled: false });
    expect(s.profile.location).toBeUndefined();
    expect(s.profile.hiddenOfferIds).toHaveLength(LIMITS.hiddenOffers);
    expect(s.profile.hiddenOfferIds.at(-1)).toBe('o899'); // keeps most recent
  });
  it('drops saved snapshots that fail validation', () => {
    const s = sanitize({ saved: { x: { id: 'x', title: 'T', url: 'javascript:1' } }, savedOrder: ['x'] });
    expect(s.savedOrder).toEqual([]);
  });
});

describe('offline cache', () => {
  const live = { id: 'a1', source: 'direct' as const, kind: 'product' as const, category: 'tech' as const, title: 'A', description: 'A', advertiser: { id: 'acme', name: 'Acme', verified: true }, creative: { colors: ['#000000', '#ffffff'] as [string, string], icon: 'tag' }, ctaLabel: 'Shop', url: 'https://acme.com/a', clickUrl: 'https://api.onlyads.app/v1/click/a1', tags: [], sponsored: false, createdAt: NOW.toISOString() };
  it('round-trips, never caches demo offers, and drops expired/stale data', () => {
    const json = encodeCache([live, buildSampleOffers(NOW)[0], { ...live, id: 'old', expiresAt: '2026-11-15T11:00:00Z' }], NOW.getTime());
    const back = decodeCache(json, NOW)!;
    expect(back.offers.map((o) => o.id)).toEqual(['a1']);
    expect(back.offers[0].clickUrl).toBe(live.clickUrl);
    expect(decodeCache(json, new Date(NOW.getTime() + 25 * 3600_000))).toBeNull();
    expect(decodeCache('garbage', NOW)).toBeNull();
  });
});

describe('monitoring & analytics privacy', () => {
  it('scrubs coordinates, emails, tokens and query strings', () => {
    const out = scrub('fail https://api.onlyads.app/v1/offers?lat=25.76&lng=-80.19 for jane@doe.com at 25.761712,-80.191812 token abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).not.toMatch(/lat=|jane@|25\.7617|abcdefghij/);
    expect(out).toContain('https://api.onlyads.app/v1/offers?…');
  });
  it('forwards scrubbed reports to the sink and keeps a bounded buffer', () => {
    const sink = jest.fn();
    setErrorSink(sink);
    for (let i = 0; i < 30; i++) reportError(new Error(`x ${i} user@example.com`), 'test');
    setErrorSink(null);
    expect(sink).toHaveBeenCalledTimes(30);
    expect(sink.mock.calls[0][0].message).toContain('[email]');
    expect(recentErrors().length).toBeLessThanOrEqual(20);
  });
  it('only sends allow-listed events and properties', () => {
    const sink = jest.fn();
    setAnalyticsSink(sink);
    track('offer_click', { category: 'tech', source: 'direct', userId: 'u1', query: 'secret' });
    track('not_an_event' as never, {});
    setAnalyticsSink(null);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][1]).toEqual({ category: 'tech', source: 'direct' });
    expect(bucket(0)).toBe('0');
    expect(bucket(37)).toBe('21+');
  });
});
