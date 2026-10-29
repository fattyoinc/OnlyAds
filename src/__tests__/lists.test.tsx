/**
 * Shopping lists, saved-deal reminders and server-ranking preferences, through
 * the real AppStateProvider.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { _resetAnalytics } from '@/services/analytics';
import { validateOffer } from '@/services/offerValidation';
import type { OfferProvider, ProviderContext } from '@/services/providers';
import { MAX_REMINDERS, planReminders, syncReminders } from '@/services/reminders';
import { AppStateProvider, useApp } from '@/state/AppState';
import { CACHE_KEY } from '@/state/offerCache';
import { decode, LIMITS, sanitize, STORAGE_KEY } from '@/state/persistence';
import type { Offer } from '@/types/offer';

jest.mock('@/services/region', () => ({ deviceRegion: () => 'US' }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Low: 2 } }));

const mockScheduled: { content: { data: Record<string, unknown> }; identifier: string; trigger: { date: Date } }[] = [];
let mockPermission = { granted: false, canAskAgain: true };
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => mockPermission),
  requestPermissionsAsync: jest.fn(async () => (mockPermission = { granted: true, canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockScheduled.map((s) => ({ ...s, content: { ...s.content } }))),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const i = mockScheduled.findIndex((s) => s.identifier === id);
    if (i >= 0) mockScheduled.splice(i, 1);
  }),
  scheduleNotificationAsync: jest.fn(async (req: { content: { data: Record<string, unknown> }; trigger: { date: Date } }) => {
    const identifier = `n${mockScheduled.length}-${Math.random()}`;
    mockScheduled.push({ ...req, identifier });
    return identifier;
  }),
  setNotificationChannelAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const NOW = new Date('2026-11-15T12:00:00Z');
const hoursFrom = (base: Date, h: number) => new Date(base.getTime() + h * 3600_000).toISOString();
const mk = (id: string, extra: Record<string, unknown> = {}): Offer =>
  validateOffer({ id, title: `Offer ${id}`, url: 'https://acme.com/x', category: 'tech', advertiser: { id: 'acme', name: 'Acme' }, source: 'direct', ...extra })!;

function backend(offers: Offer[]): OfferProvider & { contexts: ProviderContext[] } {
  const contexts: ProviderContext[] = [];
  return {
    id: 'backend',
    label: 'test',
    status: 'live',
    description: '',
    contexts,
    async fetchOffers() {
      return offers;
    },
    async fetchPage(ctx) {
      contexts.push(ctx);
      return { offers };
    },
  };
}

async function setup(providers: OfferProvider[]) {
  const wrapper = ({ children }: { children: ReactNode }) => <AppStateProvider providers={providers}>{children}</AppStateProvider>;
  const r = await renderHook(() => useApp(), { wrapper });
  await waitFor(() => expect(r.result.current.firstLoadPending).toBe(false));
  return r;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  _resetAnalytics();
  mockScheduled.length = 0;
  mockPermission = { granted: false, canAskAgain: true };
});

describe('shopping lists', () => {
  it('create, add (saving if needed), remove, rename, delete — and persist', async () => {
    const a = mk('a');
    const b = mk('b');
    const { result, unmount } = await setup([backend([a, b])]);
    let id: string | undefined;
    await act(async () => {
      id = result.current.createList('  Gifts   for Mom ', a);
    });
    expect(result.current.lists).toEqual([{ id, name: 'Gifts for Mom', offerIds: ['a'] }]);
    expect(result.current.isSaved('a')).toBe(true);
    await act(async () => result.current.toggleInList(id!, b));
    expect(result.current.lists[0].offerIds).toEqual(['b', 'a']);
    expect(result.current.isSaved('b')).toBe(true);
    await act(async () => result.current.toggleInList(id!, b));
    expect(result.current.lists[0].offerIds).toEqual(['a']);
    expect(result.current.isSaved('b')).toBe(true);
    await act(async () => result.current.renameList(id!, 'Mom'));
    expect(result.current.lists[0].name).toBe('Mom');
    await act(async () => result.current.renameList(id!, '   '));
    expect(result.current.lists[0].name).toBe('Mom');
    // Unsaving an offer removes it from every list.
    await act(async () => result.current.toggleSave(a));
    expect(result.current.lists[0].offerIds).toEqual([]);
    await unmount();
    const stored = decode(await AsyncStorage.getItem(STORAGE_KEY));
    expect(stored?.lists).toEqual([{ id, name: 'Mom', offerIds: [] }]);
    const again = await setup([backend([a, b])]);
    await act(async () => again.result.current.deleteList(id!));
    expect(again.result.current.lists).toEqual([]);
    expect(again.result.current.isSaved('b')).toBe(true);
  });

  it('enforces limits and rejects empty names', async () => {
    const { result } = await setup([backend([])]);
    await act(async () => {
      expect(result.current.createList('   ')).toBeUndefined();
      for (let i = 0; i < LIMITS.lists + 3; i++) result.current.createList(`L${i}`);
    });
    expect(result.current.lists).toHaveLength(LIMITS.lists);
  });

  it('sanitizes stored lists: junk dropped, unknown offers removed, upgrades from v2', () => {
    const s = sanitize({
      schemaVersion: 2,
      savedOrder: ['a'],
      saved: { a: { id: 'a', title: 'A', url: 'https://acme.com/a', category: 'tech', advertiser: { id: 'acme', name: 'Acme' } } },
      lists: [{ id: 'ok1', name: 'x'.repeat(99), offerIds: ['a', 'ghost'] }, { id: 'ok1', name: 'dup', offerIds: [] }, { id: 'BAD ID', name: 'n' }, { id: 'n2', name: '' }, 'junk'],
    });
    expect(s.schemaVersion).toBe(3);
    expect(s.lists).toEqual([{ id: 'ok1', name: 'x'.repeat(LIMITS.listName), offerIds: ['a'] }]);
    expect(s.remindersEnabled).toBe(false);
  });
});

describe('saved-deal reminders', () => {
  it('plans a day ahead, falls back to two hours, skips past/no-expiry offers, and caps the count', () => {
    const plan = planReminders(
      [mk('far', { expiresAt: hoursFrom(NOW, 72) }), mk('close', { expiresAt: hoursFrom(NOW, 5) }), mk('now', { expiresAt: hoursFrom(NOW, 2.1) }), mk('none')],
      NOW,
    );
    expect(plan.map((p) => [p.offerId, p.at.toISOString()])).toEqual([
      ['close', hoursFrom(NOW, 3)],
      ['far', hoursFrom(NOW, 48)],
    ]);
    expect(plan[1].title).toBe('A saved deal ends tomorrow');
    const many = Array.from({ length: 40 }, (_, i) => mk(`m${i}`, { expiresAt: hoursFrom(NOW, 30 + i) }));
    expect(planReminders(many, NOW)).toHaveLength(MAX_REMINDERS);
  });

  it('asks for permission only when turned on, schedules for saved offers, and clears on turn-off', async () => {
    const soon = mk('soon', { expiresAt: hoursFrom(new Date(), 30) });
    const { result } = await setup([backend([soon])]);
    await act(async () => result.current.toggleSave(soon));
    expect(mockScheduled).toHaveLength(0);
    let on = false;
    await act(async () => {
      on = await result.current.setRemindersEnabled(true);
    });
    expect(on).toBe(true);
    await waitFor(() => expect(mockScheduled).toHaveLength(1), { timeout: 4000 });
    expect(mockScheduled[0].content.data).toEqual({ tag: 'onlyads-ending', offerId: 'soon' });
    await act(async () => {
      await result.current.setRemindersEnabled(false);
    });
    expect(mockScheduled).toHaveLength(0);
    expect(result.current.remindersEnabled).toBe(false);
  });

  it('stays off when the user denies notifications', async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const { result } = await setup([backend([])]);
    let on = true;
    await act(async () => {
      on = await result.current.setRemindersEnabled(true);
    });
    expect(on).toBe(false);
    expect(result.current.remindersEnabled).toBe(false);
  });

  it('re-sync replaces only our own reminders', async () => {
    mockPermission = { granted: true, canAskAgain: true };
    mockScheduled.push({ identifier: 'other', content: { data: { tag: 'someone-else' } }, trigger: { date: new Date() } });
    await syncReminders(planReminders([mk('x', { expiresAt: hoursFrom(new Date(), 30) })], new Date()));
    await syncReminders(planReminders([mk('x', { expiresAt: hoursFrom(new Date(), 30) })], new Date()));
    expect(mockScheduled.map((s) => s.content.data.tag).sort()).toEqual(['onlyads-ending', 'someone-else']);
  });
});

describe('server-ranking preferences', () => {
  it('sends picked interests with the feed request and re-ranks when they change (not on every tap)', async () => {
    const p = backend([mk('a')]);
    const { result } = await setup([p]);
    await act(async () => {
      result.current.toggleInterest('food');
      result.current.completeOnboarding();
    });
    await waitFor(() => expect(p.contexts.at(-1)?.preferences?.interests).toEqual(['food']));
    const calls = p.contexts.length;
    await act(async () => result.current.track(mk('a'), 'open'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(p.contexts.length).toBe(calls);
    await act(async () => result.current.toggleInterest('tech'));
    await waitFor(() => expect(p.contexts.at(-1)?.preferences?.interests).toEqual(['food', 'tech']));
  });

  it('erasing all data does not trigger a re-rank that refills storage', async () => {
    const p = backend([mk('a')]);
    const { result } = await setup([p]);
    await act(async () => {
      result.current.toggleInterest('food');
      result.current.completeOnboarding();
    });
    await waitFor(() => expect(p.contexts.at(-1)?.preferences?.interests).toEqual(['food']));
    const calls = p.contexts.length;
    await act(async () => result.current.resetAll());
    await act(async () => new Promise((r) => setTimeout(r, 100)));
    expect(p.contexts.length).toBe(calls);
    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();
  });
});
