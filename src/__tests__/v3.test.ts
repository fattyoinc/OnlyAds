import { backendProvider } from '@/services/providers';
import { validateOffer } from '@/services/offerValidation';
import { EMPTY_PROFILE, feedPreferences, rankFeed, scoreOffer } from '@/services/ranking';

const NOW = new Date('2026-11-15T12:00:00Z');
const raw = (id: string, extra: object = {}) => ({ id, title: `T ${id}`, url: 'https://acme.com/x', category: 'tech', advertiser: { id: 'acme', name: 'Acme' }, ...extra });
const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } }) as unknown as Response;

describe('full-catalog ranking: client side', () => {
  it('sends only interests and coarse category buckets — never tags, advertisers, hidden ids or raw counts', () => {
    const prefs = feedPreferences({
      ...EMPTY_PROFILE,
      interests: ['food', 'beauty'],
      categoryAffinity: { tech: 37, fashion: 5, home: 1.5, travel: -1, pets: -9, food: 0 },
      tagAffinity: { secret: 9 },
      advertiserAffinity: { acme: 9 },
      hiddenOfferIds: ['x'],
    } as never);
    expect(prefs).toEqual({ interests: ['beauty', 'food'], affinity: 'fashion:2,home:1,pets:-2,tech:3,travel:-1' });
  });

  it('requests /v1/feed with the preferences', async () => {
    const f = jest.fn().mockResolvedValue(res({ offers: [], nextCursor: null }));
    await backendProvider('https://api.onlyads.app', { fetchImpl: f }).fetchPage!({ now: NOW, country: 'US', preferences: { interests: ['food', 'tech'], affinity: 'home:1,pets:-2' } });
    expect(f.mock.calls[0][0]).toBe('https://api.onlyads.app/v1/feed?country=US&interests=food,tech&affinity=home%3A1%2Cpets%3A-2&limit=40');
  });

  it('accepts server popularity in 0..1 only', () => {
    expect(validateOffer(raw('a', { popularity: 0.734 }), NOW)!.popularity).toBe(0.73);
    expect(validateOffer(raw('b', { popularity: 3 }), NOW)!.popularity).toBeUndefined();
    expect(validateOffer(raw('c', { popularity: '1' }), NOW)!.popularity).toBeUndefined();
  });

  it('popularity helps cold start but never outweighs a picked interest', () => {
    const popular = validateOffer(raw('pop', { popularity: 1 }), NOW)!;
    const plain = validateOffer(raw('plain', { createdAt: '2026-11-01T00:00:00Z' }), NOW)!;
    const liked = validateOffer(raw('liked', { category: 'food' }), NOW)!;
    expect(rankFeed([plain, popular], EMPTY_PROFILE, NOW)[0].offer.id).toBe('pop');
    expect(scoreOffer(popular, EMPTY_PROFILE, NOW).reasons).toContain('Popular right now');
    expect(rankFeed([popular, liked], { ...EMPTY_PROFILE, interests: ['food'] }, NOW)[0].offer.id).toBe('liked');
    expect(scoreOffer(plain, EMPTY_PROFILE, NOW).reasons).toEqual(['Recommended for everyone']);
  });
});
