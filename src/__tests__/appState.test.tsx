/**
 * Integration tests: the real AppStateProvider (persistence, loading, pagination,
 * lifecycle, analytics wiring) with injected offer providers.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { _resetAnalytics, setAnalyticsSink } from '@/services/analytics';
import { validateOffer } from '@/services/offerValidation';
import type { OfferProvider } from '@/services/providers';
import { AppStateProvider, useApp } from '@/state/AppState';
import { CACHE_KEY } from '@/state/offerCache';
import { STORAGE_KEY } from '@/state/persistence';
import type { Offer } from '@/types/offer';

jest.mock('@/services/region', () => ({ deviceRegion: () => 'US' }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })), getCurrentPositionAsync: jest.fn(), Accuracy: { Low: 2 } }));

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const mk = (id: string, extra: Partial<Offer> & Record<string, unknown> = {}): Offer =>
  validateOffer({ id, title: `Offer ${id}`, url: 'https://acme.com/x', category: 'tech', advertiser: { id: 'acme', name: 'Acme' }, source: 'direct', ...extra })!;

function backend(pages: Offer[][], opts: { fail?: boolean } = {}): OfferProvider & { calls: (string | undefined)[] } {
  const calls: (string | undefined)[] = [];
  return {
    id: 'backend',
    label: 'test',
    status: 'live',
    description: '',
    calls,
    async fetchOffers() {
      return pages[0];
    },
    async fetchPage(_ctx, cursor) {
      calls.push(cursor);
      if (opts.fail) throw new TypeError('Network request failed');
      const i = cursor ? Number(cursor.slice(1)) : 0;
      return { offers: pages[i], nextCursor: i + 1 < pages.length ? `p${i + 1}` : undefined };
    },
  };
}

async function setup(providers: OfferProvider[]) {
  const wrapper = ({ children }: { children: ReactNode }) => <AppStateProvider providers={providers}>{children}</AppStateProvider>;
  return await renderHook(() => useApp(), { wrapper });
}

async function ready(result: { current: ReturnType<typeof useApp> }) {
  await waitFor(() => expect(result.current.firstLoadPending).toBe(false));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  _resetAnalytics();
});

describe('favorites', () => {
  it('saves, persists to storage, and survives an app restart', async () => {
    const providers = [backend([[mk('a'), mk('b')]])];
    const first = await setup(providers);
    await ready(first.result);
    await act(async () => first.result.current.toggleSave(first.result.current.offers[0]));
    expect(first.result.current.isSaved('a')).toBe(true);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!).savedOrder).toEqual(['a']));
    await first.unmount();

    const second = await setup(providers);
    await waitFor(() => expect(second.result.current.hydrated).toBe(true));
    expect(second.result.current.isSaved('a')).toBe(true);
    expect(second.result.current.savedOrder).toEqual(['a']);
    await act(async () => second.result.current.toggleSave(second.result.current.saved.a));
    expect(second.result.current.isSaved('a')).toBe(false);
  });

  it('keeps a saved snapshot even after the offer leaves the feed', async () => {
    const r = await setup([backend([[mk('gone')]])]);
    await ready(r.result);
    await act(async () => r.result.current.toggleSave(r.result.current.offers[0]));
    await r.unmount();
    const r2 = await setup([backend([[mk('other')]])]);
    await ready(r2.result);
    expect(r2.result.current.getOffer('gone')?.title).toBe('Offer gone');
  });
});

describe('feed loading', () => {
  it('loads the first page, then more on demand without duplicates', async () => {
    const p = backend([[mk('1'), mk('2')], [mk('2'), mk('3')], [mk('4')]]);
    const { result } = await setup([p]);
    await ready(result);
    expect(result.current.offers.map((o) => o.id)).toEqual(['1', '2']);
    expect(result.current.hasMore).toBe(true);
    await act(async () => result.current.loadMore());
    expect(result.current.offers.map((o) => o.id)).toEqual(['1', '2', '3']);
    await act(async () => result.current.loadMore());
    expect(result.current.offers.map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    expect(result.current.hasMore).toBe(false);
    await act(async () => result.current.loadMore()); // no-op at the end
    expect(p.calls).toEqual([undefined, 'p1', 'p2']);
  });

  it('never presents expired offers, and hides offers not redeemable in the user’s country', async () => {
    const { result } = await setup([backend([[mk('live', { expiresAt: hours(5) }), mk('dead', { expiresAt: hours(-1) }), mk('co', { availability: { countries: ['CO'] } }), mk('us', { availability: { countries: ['US'] } })]])]);
    await ready(result);
    const ids = result.current.feed.map((s) => s.offer.id).sort();
    expect(ids).toEqual(['live', 'us']);
  });

  it('shows an error (not an empty success) when the API fails and nothing is cached', async () => {
    const { result } = await setup([backend([[mk('a')]], { fail: true })]);
    await ready(result);
    expect(result.current.status).toBe('error');
    expect(result.current.offers).toEqual([]);
    expect(result.current.providerErrors[0].message).toMatch(/connection/i);
  });

  it('falls back to the last good offers when offline', async () => {
    const good = await setup([backend([[mk('cached')]])]);
    await ready(good.result);
    await waitFor(async () => expect(await AsyncStorage.getItem(CACHE_KEY)).toContain('cached'));
    await good.unmount();
    const offline = await setup([backend([[mk('x')]], { fail: true })]);
    await ready(offline.result);
    expect(offline.result.current.showingCache).toBe(true);
    expect(offline.result.current.offers.map((o) => o.id)).toEqual(['cached']);
  });
});

describe('preferences and privacy', () => {
  it('interest changes persist; "Not interested" removes the offer from the feed', async () => {
    const { result, unmount } = await setup([backend([[mk('a'), mk('b')]])]);
    await ready(result);
    await act(async () => result.current.toggleInterest('food'));
    await act(async () => result.current.track(result.current.offers[0], 'dismiss'));
    expect(result.current.feed.map((s) => s.offer.id)).toEqual(['b']);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!).profile.interests).toEqual(['food']));
    await unmount();
  });

  it('erase all data clears storage and the offline cache', async () => {
    const { result } = await setup([backend([[mk('a')]])]);
    await ready(result);
    await act(async () => result.current.toggleSave(result.current.offers[0]));
    await act(async () => result.current.resetAll());
    expect(result.current.savedOrder).toEqual([]);
    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}').savedOrder ?? []).toEqual([]));
  });

  it('opting out of usage stats means no events are recorded after the choice', async () => {
    const seen: string[] = [];
    setAnalyticsSink((e) => seen.push(e));
    const { result } = await setup([backend([[mk('a')]])]);
    await ready(result);
    await act(async () => result.current.setAnalyticsConsent(false));
    await act(async () => result.current.completeOnboarding());
    await waitFor(() => expect(result.current.onboarded).toBe(true));
    const before = seen.length;
    await act(async () => result.current.toggleSave(result.current.offers[0]));
    await act(async () => result.current.track(result.current.offers[0], 'click'));
    expect(seen.length).toBe(before);
  });
});
