import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import { config } from '@/config';
import { DEFAULT_ANCHOR } from '@/data/defaults';
import { configureAnalytics, flushAnalytics, httpTransport, track as trackEvent } from '@/services/analytics';
import { daysSinceBucket } from '@/services/analyticsSchema';
import { reportError } from '@/services/monitoring';
import { aggregateOffers, defaultProviders, mergeOffers, type OfferProvider } from '@/services/providers';
import { deviceRegion } from '@/services/region';
import { cancelAllReminders, planReminders, requestReminderPermission, syncReminders } from '@/services/reminders';
import { applySignal, EMPTY_PROFILE, feedPreferences, rankFeed, type ScoredOffer, type SignalType } from '@/services/ranking';
import type { CategoryId, GeoPoint, Offer } from '@/types/offer';
import { isAvailableIn } from '@/utils/format';
import { clearCache, readCache, writeCache } from './offerCache';
import { decode, INITIAL, LEGACY_KEY_V1, LIMITS, STORAGE_KEY, type Persisted } from './persistence';

const newListId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Refresh when returning to the foreground if data is older than this. */
const STALE_AFTER_MS = 15 * 60_000;
const CLOCK_TICK_MS = 60_000;

export type LocationState = 'off' | 'requesting' | 'on' | 'denied' | 'error';
export type FeedStatus = 'loading' | 'ready' | 'error';

interface AppStateValue extends Persisted {
  hydrated: boolean;
  offers: Offer[];
  feed: ScoredOffer[];
  /** Ticks every minute while the app is active, so expiry labels/filters stay correct. */
  now: Date;
  status: FeedStatus;
  /** True until the first load attempt (network or cache) has settled. */
  firstLoadPending: boolean;
  loading: boolean;
  lastUpdated?: number;
  /** Feed is showing cached data because the network failed. */
  showingCache: boolean;
  providers: OfferProvider[];
  providerErrors: { providerId: string; message: string }[];
  /** User location (opt-in) or, in demo builds only, the demo anchor. */
  anchor?: GeoPoint & { label: string };
  locationState: LocationState;
  refresh: () => Promise<void>;
  /** Load the next page from the offers API (no-op when there is none or one is loading). */
  loadMore: () => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** Device region used for availability filtering (not a location). */
  country?: string;
  setAnalyticsConsent: (v: boolean) => void;
  getOffer: (id: string) => Offer | undefined;
  isSaved: (id: string) => boolean;
  toggleSave: (o: Offer) => void;
  track: (o: Offer, type: SignalType) => void;
  toggleInterest: (c: CategoryId) => void;
  completeOnboarding: () => void;
  muteAdvertiser: (advertiserId: string) => void;
  unmuteAdvertiser: (advertiserId: string) => void;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  enableLocation: () => Promise<boolean>;
  disableLocation: () => void;
  resetPersonalization: () => void;
  resetAll: () => Promise<void>;
  /** Returns the new list's id, or undefined if the name is empty or the limit is reached. */
  createList: (name: string, first?: Offer) => string | undefined;
  renameList: (id: string, name: string) => void;
  deleteList: (id: string) => void;
  /** Adds (saving the offer if needed) or removes an offer from a list. */
  toggleInList: (listId: string, o: Offer) => void;
  /** Turns reminders on (asking for notification permission) or off. Resolves to the resulting state. */
  setRemindersEnabled: (v: boolean) => Promise<boolean>;
}

const Ctx = createContext<AppStateValue | null>(null);

/** Narrow contexts so offer cards don't re-render on unrelated state changes. */
interface OfferActions {
  track: (o: Offer, type: SignalType) => void;
  toggleSave: (o: Offer) => void;
}
const ActionsCtx = createContext<OfferActions | null>(null);
const SavedCtx = createContext<Record<string, Offer>>({});

/** Save an offer (newest first, bounded). Pure. */
function addSaved(s: Persisted, o: Offer): Persisted {
  trackEvent('offer_save', { category: o.category });
  const savedOrder = [o.id, ...s.savedOrder.filter((id) => id !== o.id)].slice(0, LIMITS.saved);
  const saved: Record<string, Offer> = {};
  for (const id of savedOrder) saved[id] = id === o.id ? o : s.saved[id];
  const kept = new Set(savedOrder);
  return { ...s, saved, savedOrder, profile: applySignal(s.profile, o, 'save'), lists: s.lists.map((l) => (l.offerIds.every((x) => kept.has(x)) ? l : { ...l, offerIds: l.offerIds.filter((x) => kept.has(x)) })) };
}

/** Round to ~1 km so precise location is never stored or sent. */
const coarse = (p: GeoPoint): GeoPoint => ({ lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 });

export function AppStateProvider({ children, providers: injected }: { children: ReactNode; providers?: OfferProvider[] }) {
  const providers = useMemo(() => injected ?? defaultProviders(), [injected]);
  const [state, setState] = useState<Persisted>(INITIAL);
  const [hydrated, setHydrated] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [firstLoadPending, setFirstLoadPending] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>();
  const [showingCache, setShowingCache] = useState(false);
  const [providerErrors, setProviderErrors] = useState<AppStateValue['providerErrors']>([]);
  const [locationState, setLocationState] = useState<LocationState>('off');
  const [now, setNow] = useState(() => new Date());
  const [country] = useState(() => deviceRegion());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  // Preferences for server-side ranking. Read via ref so each tap doesn't refetch;
  // the page cursor keeps the preferences its first page was ranked with.
  const prefsRef = useRef<ReturnType<typeof feedPreferences>>({ interests: [], affinity: '' });
  const pagePrefsRef = useRef<ReturnType<typeof feedPreferences> | undefined>(undefined);
  const loadingMoreRef = useRef(false);
  const available = useCallback((list: Offer[]) => list.filter((o) => isAvailableIn(o, country)), [country]);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const inflight = useRef<AbortController | null>(null);
  const lastFetchAt = useRef(0);

  // ---- Persistence -------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const current = decode(await AsyncStorage.getItem(STORAGE_KEY));
        const legacy = current ? null : decode(await AsyncStorage.getItem(LEGACY_KEY_V1));
        const restored = current ?? legacy;
        const nowMs = Date.now();
        // Return-visit measurement: only a bucketed "days since last open" leaves the device.
        trackEvent('app_open', { returning: !!restored?.lastOpenAt, days_since: daysSinceBucket(restored?.lastOpenAt ? nowMs - restored.lastOpenAt : undefined) });
        if (restored) {
          setState({ ...restored, lastOpenAt: nowMs });
          if (restored.locationEnabled) setLocationState('on');
        } else {
          setState((s) => ({ ...s, lastOpenAt: nowMs }));
        }
        if (legacy) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
          await AsyncStorage.removeItem(LEGACY_KEY_V1);
        }
      } catch (e) {
        reportError(e, 'hydrate');
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const flush = useCallback(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current)).catch((e) => reportError(e, 'persist'));
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flush();
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hydrated, flush]);

  // On teardown, write any change still waiting in the debounce window (it used to be dropped).
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        flush();
      }
    },
    [flush],
  );

  // ---- Analytics consent -------------------------------------------------------
  // Events wait in memory until onboarding ends (the consent choice is shown there),
  // then go to our aggregate endpoint only if the user kept sharing on.
  useEffect(() => {
    if (!hydrated || !state.onboarded) return;
    configureAnalytics({ enabled: state.analyticsConsent, transport: config.apiUrl ? httpTransport(config.apiUrl) : null });
    if (!state.analyticsConsent) return;
    void flushAnalytics();
    // Short sessions must not lose their events: send what's buffered every 20s.
    const t = setInterval(() => void flushAnalytics(), 20_000);
    return () => clearInterval(t);
  }, [hydrated, state.onboarded, state.analyticsConsent]);

  // ---- Location ------------------------------------------------------------
  const location = state.locationEnabled ? state.profile.location : undefined;
  const anchor = useMemo(
    () => (location ? { ...location, label: 'Your area' } : config.demoCatalog ? DEFAULT_ANCHOR : undefined),
    [location?.lat, location?.lng], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Loading offers --------------------------------------------------------
  const load = useCallback(
    async (opts: { useCache: boolean }) => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      if (opts.useCache) {
        const cached = await readCache();
        if (cached && !ctrl.signal.aborted && cached.offers.length) {
          setOffers((prev) => (prev.length ? prev : available(cached.offers)));
          setLastUpdated((prev) => prev ?? cached.savedAt);
        }
      }
      try {
        const preferences = prefsRef.current;
        const res = await aggregateOffers(providers, { now: new Date(), location, country, preferences, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        cursorRef.current = res.cursors.backend;
        pagePrefsRef.current = preferences;
        setHasMore(!!res.cursors.backend);
        setLoadMoreFailed(false);
        const networkFailed = res.errors.some((e) => e.providerId === 'backend');
        if (networkFailed) {
          // Keep last-known-good backend offers rather than blanking the feed.
          const cached = await readCache();
          const demo = res.offers;
          const kept = cached?.offers ?? [];
          setOffers(available(mergeOffers(demo, kept)));
          setShowingCache(kept.length > 0);
          setLastUpdated(cached?.savedAt);
          setStatus(res.offers.length || kept.length ? 'ready' : 'error');
        } else {
          setOffers(available(res.offers));
          setShowingCache(false);
          setLastUpdated(Date.now());
          setStatus('ready');
          lastFetchAt.current = Date.now();
          writeCache(res.offers);
        }
        setProviderErrors(res.errors);
        for (const e of res.errors) reportError(e.message, `provider:${e.providerId}`);
      } catch (e) {
        if (!ctrl.signal.aborted) {
          reportError(e, 'load');
          setStatus('error');
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setFirstLoadPending(false);
          setNow(new Date());
        }
      }
    },
    [providers, location, country, available],
  );

  const loadMore = useCallback(async () => {
    const backend = providers.find((p) => p.id === 'backend' && p.status === 'live' && p.fetchPage);
    const cursor = cursorRef.current;
    if (!backend || !cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await backend.fetchPage!({ now: new Date(), location, country, preferences: pagePrefsRef.current }, cursor);
      // Ignore a page that belongs to an older query (e.g. location changed meanwhile).
      if (cursorRef.current !== cursor) return;
      cursorRef.current = page.nextCursor;
      setHasMore(!!page.nextCursor);
      setOffers((prev) => {
        const merged = mergeOffers(prev, available(page.offers));
        writeCache(merged);
        return merged;
      });
    } catch (e) {
      reportError(e, 'load-more');
      setLoadMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [providers, location, country, available]);

  const refresh = useCallback(async () => {
    setStatus('loading');
    await load({ useCache: false });
  }, [load]);

  const prefs = useMemo(() => feedPreferences(state.profile), [state.profile]);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  // Re-rank the catalog when interests change (or onboarding finishes); engagement
  // signals only affect the next natural refresh, so taps never trigger refetches.
  const rankKey = state.onboarded ? prefs.interests.join(',') : '\u0000pending';
  const lastRankKey = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    // Not after "Erase all my data" (back to onboarding): that must leave storage empty.
    if (lastRankKey.current !== null && lastRankKey.current !== rankKey && state.onboarded) void load({ useCache: false });
    lastRankKey.current = rankKey;
  }, [hydrated, rankKey, state.onboarded, load]);

  useEffect(() => {
    if (!hydrated) return;
    // Deferred so the load (and its state updates) runs outside the effect body.
    const t = setTimeout(() => load({ useCache: true }), 0);
    return () => {
      clearTimeout(t);
      inflight.current?.abort();
    };
  }, [hydrated, load]);

  // ---- App lifecycle ---------------------------------------------------------
  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | null = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setNow(new Date());
        if (!tick) tick = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
        if (hydrated && Date.now() - lastFetchAt.current > STALE_AFTER_MS) load({ useCache: false });
      } else if (s === 'background') {
        flush(); // don't lose the last change if the OS kills us
        void flushAnalytics();
        if (tick) clearInterval(tick);
        tick = null;
      }
    });
    return () => {
      sub.remove();
      if (tick) clearInterval(tick);
    };
  }, [hydrated, load, flush]);

  // ---- Derived -----------------------------------------------------------------
  const rankingProfile = useMemo(() => ({ ...state.profile, location: anchor }), [state.profile, anchor]);
  const feed = useMemo(() => rankFeed(offers, rankingProfile, now), [offers, rankingProfile, now]);
  const offerIndex = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);

  // Keep scheduled "ending soon" reminders in step with saved offers (live versions win: dates can change).
  useEffect(() => {
    if (!hydrated || !state.remindersEnabled) return;
    const t = setTimeout(() => {
      const items = state.savedOrder.map((id) => offerIndex.get(id) ?? state.saved[id]).filter((o): o is Offer => !!o);
      syncReminders(planReminders(items, new Date())).catch((e) => reportError(e, 'reminders'));
    }, 1500);
    return () => clearTimeout(t);
  }, [hydrated, state.remindersEnabled, state.saved, state.savedOrder, offerIndex]);

  // ---- Actions -------------------------------------------------------------------
  const update = useCallback((fn: (s: Persisted) => Persisted) => setState(fn), []);

  const track = useCallback(
    (o: Offer, type: SignalType) => {
      update((s) => ({ ...s, profile: applySignal(s.profile, o, type) }));
      if (type === 'open') trackEvent('offer_open', { category: o.category, source: o.source });
      if (type === 'click') trackEvent('offer_click', { category: o.category, source: o.source });
      if (type === 'dismiss') trackEvent('offer_dismiss', { category: o.category });
    },
    [update],
  );

  const toggleSave = useCallback(
    (o: Offer) =>
      update((s) => {
        if (s.saved[o.id]) {
          const { [o.id]: _removed, ...rest } = s.saved;
          return { ...s, saved: rest, savedOrder: s.savedOrder.filter((id) => id !== o.id), lists: s.lists.map((l) => (l.offerIds.includes(o.id) ? { ...l, offerIds: l.offerIds.filter((x) => x !== o.id) } : l)) };
        }
        return addSaved(s, o);
      }),
    [update],
  );

  const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, LIMITS.listName);
  const createList = useCallback(
    (name: string, first?: Offer) => {
      const n = cleanName(name);
      if (!n || stateRef.current.lists.length >= LIMITS.lists) return undefined;
      const id = newListId();
      update((s) => {
        if (s.lists.length >= LIMITS.lists) return s; // re-checked here: several calls can land in one render
        const base = first && !s.saved[first.id] ? addSaved(s, first) : s;
        return { ...base, lists: [...base.lists, { id, name: n, offerIds: first ? [first.id] : [] }] };
      });
      trackEvent('list_create');
      return id;
    },
    [update],
  );
  const renameList = useCallback(
    (id: string, name: string) => {
      const n = cleanName(name);
      if (n) update((s) => ({ ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, name: n } : l)) }));
    },
    [update],
  );
  const deleteList = useCallback((id: string) => update((s) => ({ ...s, lists: s.lists.filter((l) => l.id !== id) })), [update]);
  const toggleInList = useCallback(
    (listId: string, o: Offer) =>
      update((s) => {
        const list = s.lists.find((l) => l.id === listId);
        if (!list) return s;
        if (list.offerIds.includes(o.id)) return { ...s, lists: s.lists.map((l) => (l.id === listId ? { ...l, offerIds: l.offerIds.filter((x) => x !== o.id) } : l)) };
        const base = s.saved[o.id] ? s : addSaved(s, o);
        if (!base.saved[o.id]) return s;
        return { ...base, lists: base.lists.map((l) => (l.id === listId ? { ...l, offerIds: [o.id, ...l.offerIds] } : l)) };
      }),
    [update],
  );

  const setRemindersEnabled = useCallback(
    async (v: boolean) => {
      if (!v) {
        update((s) => ({ ...s, remindersEnabled: false }));
        await cancelAllReminders().catch((e) => reportError(e, 'reminders'));
        return false;
      }
      const granted = await requestReminderPermission().catch((e) => {
        reportError(e, 'reminders');
        return false;
      });
      update((s) => ({ ...s, remindersEnabled: granted }));
      trackEvent('reminders_toggle', { enabled: granted });
      return granted;
    },
    [update],
  );

  const locating = useRef(false);
  const enableLocation = useCallback(async () => {
    if (locating.current) return false; // ignore double taps
    locating.current = true;
    setLocationState('requesting');
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setLocationState('denied');
        return false;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const p = coarse({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      update((s) => ({ ...s, locationEnabled: true, profile: { ...s.profile, location: p } }));
      setLocationState('on');
      trackEvent('location_enabled');
      return true;
    } catch (e) {
      reportError(e, 'location');
      setLocationState('error');
      return false;
    } finally {
      locating.current = false;
    }
  }, [update]);

  const toggleInterest = useCallback(
    (c: CategoryId) =>
      update((s) => {
        const has = s.profile.interests.includes(c);
        return { ...s, profile: { ...s.profile, interests: has ? s.profile.interests.filter((x) => x !== c) : [...s.profile.interests, c] } };
      }),
    [update],
  );

  const completeOnboarding = useCallback(() => {
    update((s) => {
      trackEvent('onboarding_complete', { interests_count: s.profile.interests.length, location_enabled: s.locationEnabled });
      return { ...s, onboarded: true };
    });
  }, [update]);

  const muteAdvertiser = useCallback(
    (id: string) =>
      update((s) => ({ ...s, profile: { ...s.profile, mutedAdvertiserIds: [...new Set([...s.profile.mutedAdvertiserIds, id])].slice(-LIMITS.mutedAdvertisers) } })),
    [update],
  );
  const unmuteAdvertiser = useCallback(
    (id: string) => update((s) => ({ ...s, profile: { ...s.profile, mutedAdvertiserIds: s.profile.mutedAdvertiserIds.filter((x) => x !== id) } })),
    [update],
  );
  const addRecentSearch = useCallback(
    (q: string) => {
      const t = q.trim().slice(0, 100);
      if (!t) return;
      update((s) => ({ ...s, recentSearches: [t, ...s.recentSearches.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, LIMITS.recentSearches) }));
    },
    [update],
  );
  const clearRecentSearches = useCallback(() => update((s) => ({ ...s, recentSearches: [] })), [update]);
  const disableLocation = useCallback(() => {
    setLocationState('off');
    update((s) => ({ ...s, locationEnabled: false, profile: { ...s.profile, location: undefined } }));
  }, [update]);
  const resetPersonalization = useCallback(
    () => update((s) => ({ ...s, profile: { ...EMPTY_PROFILE, interests: s.profile.interests, location: s.profile.location } })),
    [update],
  );
  const resetAll = useCallback(async () => {
    inflight.current?.abort(); // a load finishing now must not write the cache back
    setLocationState('off');
    trackEvent('data_erased');
    await flushAnalytics();
    // Nothing more is sent until the user makes their choice again in onboarding.
    configureAnalytics({ enabled: false });
    await cancelAllReminders().catch(() => {});
    setState(INITIAL);
    await Promise.all([AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_KEY_V1]).catch(() => {}), clearCache()]);
  }, []);

  const setAnalyticsConsent = useCallback((v: boolean) => update((s) => ({ ...s, analyticsConsent: v })), [update]);

  const getOffer = useCallback((id: string) => offerIndex.get(id) ?? state.saved[id], [offerIndex, state.saved]);
  const isSaved = useCallback((id: string) => !!state.saved[id], [state.saved]);

  const value = useMemo<AppStateValue>(
    () => ({
      ...state,
      hydrated,
      offers,
      feed,
      now,
      status,
      firstLoadPending,
      loading: status === 'loading',
      lastUpdated,
      showingCache,
      providers,
      providerErrors,
      anchor,
      locationState,
      refresh,
      getOffer,
      isSaved,
      toggleSave,
      track,
      toggleInterest,
      completeOnboarding,
      muteAdvertiser,
      unmuteAdvertiser,
      addRecentSearch,
      clearRecentSearches,
      enableLocation,
      disableLocation,
      resetPersonalization,
      resetAll,
      loadMore,
      hasMore,
      loadingMore,
      loadMoreFailed,
      country,
      setAnalyticsConsent,
      createList,
      renameList,
      deleteList,
      toggleInList,
      setRemindersEnabled,
    }),
    [state, hydrated, offers, feed, now, status, firstLoadPending, lastUpdated, showingCache, providers, providerErrors, anchor, locationState, refresh, getOffer, isSaved, toggleSave, track, toggleInterest, completeOnboarding, muteAdvertiser, unmuteAdvertiser, addRecentSearch, clearRecentSearches, enableLocation, disableLocation, resetPersonalization, resetAll, loadMore, hasMore, loadingMore, loadMoreFailed, country, setAnalyticsConsent, createList, renameList, deleteList, toggleInList, setRemindersEnabled],
  );

  const actions = useMemo(() => ({ track, toggleSave }), [track, toggleSave]);

  return (
    <ActionsCtx.Provider value={actions}>
      <SavedCtx.Provider value={state.saved}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </SavedCtx.Provider>
    </ActionsCtx.Provider>
  );
}

export function useOfferActions(): OfferActions {
  const v = useContext(ActionsCtx);
  if (!v) throw new Error('useOfferActions must be used inside <AppStateProvider>');
  return v;
}

/** Re-renders only when the saved set changes. */
export function useIsSaved(id: string): boolean {
  return !!useContext(SavedCtx)[id];
}

export function useApp(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppStateProvider>');
  return v;
}
