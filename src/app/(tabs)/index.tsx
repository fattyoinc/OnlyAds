import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferCard } from '@/components/offers/OfferCard';
import { config } from '@/config';
import { track, trackImpression } from '@/services/analytics';
import { CATEGORIES } from '@/data/categories';
import type { ScoredOffer } from '@/services/ranking';
import { useApp } from '@/state/AppState';
import { layout, makeStyles, useTheme } from '@/theme';
import type { CategoryId } from '@/types/offer';
import { Banner, Button, Chip, FeedSkeleton, haptics, Icon, SearchTrigger, SectionHeader, StateView, Text, useColumnWidth, useContentWidth, useGuardedAction, type IconName } from '@/ui';
import { formatDate, hoursLeft, isEndingSoon } from '@/utils/format';

type Filter = 'foryou' | 'nearby' | 'ending' | CategoryId;

const FILTERS: { id: Filter; label: string; icon: IconName }[] = [
  { id: 'foryou', label: 'For you', icon: 'star-four-points-outline' },
  { id: 'nearby', label: 'Nearby', icon: 'map-marker-outline' },
  { id: 'ending', label: 'Ending soon', icon: 'timer-sand' },
  ...CATEGORIES.map((c) => ({ id: c.id as Filter, label: c.name, icon: c.icon as IconName })),
];

type FeedItem =
  | { type: 'offer'; key: string; s: ScoredOffer }
  | { type: 'hero'; key: string; items: ScoredOffer[] }
  | { type: 'rail'; key: string; title: string; subtitle?: string; items: ScoredOffer[]; onSeeAll?: () => void }
  | { type: 'section'; key: string; title: string; subtitle?: string }
  | { type: 'personalize'; key: string }
  | { type: 'location'; key: string; size: 'card' | 'full' }
  | { type: 'state'; key: string; kind: 'empty-category' | 'empty-ending' | 'empty-nearby' | 'location-denied' };

const H_PADDING = layout.inset - layout.gutter / 2;
const VIEWABILITY = { itemVisiblePercentThreshold: 60, minimumViewTime: 1000 }; // 10 → with 6px item padding gives 16 edges / 12 gutter

/** Horizontal discovery bar: icon over label, selected = bold + underline (not color alone). */
const DiscoveryBar = memo(function DiscoveryBar({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bar} accessibilityRole="tablist">
      {FILTERS.map((f) => {
        const active = f.id === value;
        return (
          <Pressable
            key={f.id}
            onPress={() => {
              if (!active) haptics.select();
              onChange(f.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={f.label}
            style={s.barItem}
          >
            <Icon name={f.icon} size={24} color={active ? colors.text : colors.textSecondary} />
            <Text variant="caption" tone={active ? 'primary' : 'secondary'} style={[s.barLabel, active && { fontWeight: '800' }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>
              {f.label}
            </Text>
            <View style={[s.barLine, active && { backgroundColor: colors.text }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

export default function Discover() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const width = useContentWidth();
  const colW = useColumnWidth();
  const { reduceMotion } = useTheme();
  const app = useApp();
  const { feed, now, status, firstLoadPending, refresh, anchor, locationEnabled, locationState, enableLocation, showingCache, lastUpdated, providerErrors, profile, toggleInterest, loadMore, hasMore, loadingMore, loadMoreFailed } = app;
  const [filter, setFilter] = useState<Filter>('foryou');
  const [refreshing, setRefreshing] = useState(false);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
  const listRef = useRef<FlashListRef<FeedItem>>(null);
  const fade = useState(() => new Animated.Value(1))[0];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const requestLocation = useGuardedAction(enableLocation);

  const changeFilter = useCallback(
    (f: Filter) => {
      setFilter(f);
      track('category_select', { category: f, surface: 'discover' });
      if (!reduceMotion) {
        fade.setValue(0.25);
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      }
    },
    [fade, reduceMotion],
  );

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    const push = (list: ScoredOffer[]) => list.forEach((x) => out.push({ type: 'offer', key: x.offer.id, s: x }));

    if (filter === 'foryou') {
      const hero = feed.slice(0, 5);
      const heroIds = new Set(hero.map((x) => x.offer.id));
      const rest = feed.filter((x) => !heroIds.has(x.offer.id));
      const ending = rest.filter((x) => isEndingSoon(x.offer, now)).slice(0, 10);
      if (hero.length) out.push({ type: 'hero', key: 'hero', items: hero });
      out.push({ type: 'section', key: 'sec-foryou', title: 'For you', subtitle: profile.interests.length ? 'Ranked by your interests and saves' : 'Popular right now — save a few to personalize' });
      rest.forEach((x, i) => {
        if (i === 4 && profile.interests.length === 0) out.push({ type: 'personalize', key: 'personalize' });
        if (i === 6 && ending.length >= 3) out.push({ type: 'rail', key: 'rail-ending', title: 'Ending soon', subtitle: 'Last chance on these', items: ending, onSeeAll: () => changeFilter('ending') });
        if (i === 12 && !locationEnabled && !locationPromptDismissed && locationState !== 'denied') out.push({ type: 'location', key: 'loc-card', size: 'card' });
        out.push({ type: 'offer', key: x.offer.id, s: x });
      });
    } else if (filter === 'nearby') {
      if (!locationEnabled) {
        out.push(locationState === 'denied' ? { type: 'state', key: 'denied', kind: 'location-denied' } : { type: 'location', key: 'loc-full', size: 'full' });
      }
      const local = feed.filter((x) => x.offer.location && x.distanceKm != null).sort((a, b) => a.distanceKm! - b.distanceKm!);
      if (locationEnabled || config.demoCatalog) {
        if (local.length) {
          out.push({ type: 'section', key: 'sec-near', title: 'Near you', subtitle: locationEnabled ? 'Closest first' : `Sample area: ${anchor?.label ?? ''}` });
          push(local);
        } else if (locationEnabled) out.push({ type: 'state', key: 'empty-near', kind: 'empty-nearby' });
      }
    } else if (filter === 'ending') {
      const ending = feed.filter((x) => isEndingSoon(x.offer, now)).sort((a, b) => (hoursLeft(a.offer, now) ?? 0) - (hoursLeft(b.offer, now) ?? 0));
      if (ending.length) {
        out.push({ type: 'section', key: 'sec-ending', title: 'Ending soon', subtitle: 'Offers that end within 48 hours' });
        push(ending);
      } else out.push({ type: 'state', key: 'empty-ending', kind: 'empty-ending' });
    } else {
      const cat = CATEGORIES.find((c) => c.id === filter)!;
      const list = feed.filter((x) => x.offer.category === filter);
      if (list.length) {
        out.push({ type: 'section', key: `sec-${filter}`, title: cat.name, subtitle: `${list.length} ${list.length === 1 ? 'offer' : 'offers'} · ${cat.blurb}` });
        push(list);
      } else out.push({ type: 'state', key: 'empty-cat', kind: 'empty-category' });
    }
    return out;
  }, [feed, filter, now, profile.interests.length, locationEnabled, locationState, locationPromptDismissed, anchor?.label, changeFilter]);

  const backendError = providerErrors.find((e) => e.providerId === 'backend');
  const loadingFirst = feed.length === 0 && (firstLoadPending || status === 'loading');
  const failed = feed.length === 0 && !loadingFirst && (status === 'error' || !!backendError);

  const heroW = width - layout.inset * 2 - 28;

  // An ad "view" = at least 60% visible for 1s (IAB-style). Counted once per offer per session.
  // Stable identity: FlashList doesn't support changing this callback on the fly.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    for (const v of viewableItems) {
      const it = v.item;
      if (it?.type === 'offer') trackImpression(it.s.offer.id, it.s.offer.source === 'sample');
    }
  });

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.type) {
        case 'offer':
          return (
            <View style={s.cell}>
              <OfferCard offer={item.s.offer} width={colW} distanceKm={item.s.distanceKm} now={now} />
            </View>
          );
        case 'hero':
          return (
            <View style={[s.full, { paddingBottom: 28 }]}>
              <SectionHeader title="Top picks" subtitle="Hand-picked from today’s best offers" />
              <FlatList
                horizontal
                data={item.items}
                keyExtractor={(x) => x.offer.id}
                showsHorizontalScrollIndicator={false}
                snapToInterval={heroW + layout.gutter}
                decelerationRate="fast"
                contentContainerStyle={{ paddingHorizontal: layout.inset, gap: layout.gutter }}
                renderItem={({ item: x }) => <OfferCard offer={x.offer} width={heroW} variant="hero" distanceKm={x.distanceKm} now={now} />}
              />
            </View>
          );
        case 'rail':
          return (
            <View style={[s.full, s.rail]}>
              <SectionHeader title={item.title} subtitle={item.subtitle} action={item.onSeeAll ? 'See all' : undefined} onAction={item.onSeeAll} />
              <FlatList
                horizontal
                data={item.items}
                keyExtractor={(x) => x.offer.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: layout.inset, gap: layout.gutter }}
                renderItem={({ item: x }) => <OfferCard offer={x.offer} width={140} variant="compact" distanceKm={x.distanceKm} now={now} />}
              />
            </View>
          );
        case 'section':
          return (
            <View style={[s.full, s.section]}>
              <SectionHeader title={item.title} subtitle={item.subtitle} />
            </View>
          );
        case 'personalize':
          return (
            <View style={[s.full, s.module]}>
              <View style={s.moduleCard}>
                <Text variant="headline">Make it yours</Text>
                <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
                  Tap what you like — your feed updates instantly.
                </Text>
                <View style={s.moduleChips}>
                  {CATEGORIES.slice(0, 8).map((c) => (
                    <Chip key={c.id} label={c.name} icon={c.icon as IconName} showCheck selected={profile.interests.includes(c.id)} onPress={() => toggleInterest(c.id)} />
                  ))}
                </View>
              </View>
            </View>
          );
        case 'location':
          return (
            <View style={[s.full, s.module]}>
              <View style={s.moduleCard}>
                <View style={s.locIcon}>
                  <Icon name="map-marker-radius-outline" size={26} />
                </View>
                <Text variant={item.size === 'full' ? 'title3' : 'headline'}>Find deals near you</Text>
                <Text variant="footnote" tone="secondary" style={{ marginTop: 4 }}>
                  Restaurants, shops and events around you. We use approximate location (about 1 km), only while you use the app, and never share it with advertisers.
                </Text>
                <View style={s.locActions}>
                  <Button label={locationState === 'requesting' ? 'Locating…' : 'Turn on location'} icon="crosshairs-gps" iconPosition="leading" size="md" loading={locationState === 'requesting'} onPress={requestLocation} />
                  {item.size === 'card' ? <Button label="Not now" variant="ghost" size="md" onPress={() => setLocationPromptDismissed(true)} /> : null}
                </View>
              </View>
            </View>
          );
        case 'state': {
          const props = {
            'empty-category': { icon: 'tag-outline' as IconName, title: 'Nothing here yet', message: 'New offers in this category appear as soon as advertisers publish them.', primary: { label: 'Back to For you', onPress: () => changeFilter('foryou') } },
            'empty-ending': { icon: 'timer-sand-empty' as IconName, title: 'No deadlines right now', message: 'Nothing ends in the next 48 hours. Check back later.', primary: { label: 'Browse For you', onPress: () => changeFilter('foryou') } },
            'empty-nearby': { icon: 'map-search-outline' as IconName, title: 'No local deals yet', message: 'We don’t have offers near you yet. Online deals are still in For you.', primary: { label: 'Browse For you', onPress: () => changeFilter('foryou') } },
            'location-denied': { icon: 'map-marker-off-outline' as IconName, title: 'Location is off for Only Ads', message: 'To see nearby deals, allow location in Settings. Choose “While Using the App” and approximate is enough.', primary: { label: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) }, secondary: { label: 'Not now', onPress: () => changeFilter('foryou') } },
          }[item.kind];
          return (
            <View style={s.full}>
              <StateView {...props} compact />
            </View>
          );
        }
      }
    },
    [s, colW, now, heroW, profile.interests, toggleInterest, locationState, requestLocation, changeFilter],
  );

  const header = (
    <View style={{ paddingTop: insets.top + 6, marginHorizontal: -H_PADDING }}>
      <View style={s.topBar}>
        <View style={s.brand} accessible accessibilityRole="header" accessibilityLabel="Only Ads">
          <View style={s.dot} />
          <Text variant="title2" style={s.wordmark}>
            only ads
          </Text>
        </View>
        <Pressable
          onPress={() => (locationEnabled ? router.push('/nearby') : changeFilter('nearby'))}
          accessibilityRole="button"
          accessibilityLabel={locationEnabled ? 'Location: your area. Show nearby deals' : 'Location off. Find deals near you'}
          style={s.locPill}
          hitSlop={6}
        >
          <Icon name={locationEnabled ? 'map-marker' : 'map-marker-outline'} size="sm" />
          <Text variant="caption" numberOfLines={1} style={{ maxWidth: 120 }}>
            {locationEnabled ? 'Your area' : anchor && config.demoCatalog ? 'Sample area' : 'Set location'}
          </Text>
        </Pressable>
      </View>
      <View style={s.searchWrap}>
        <SearchTrigger placeholder="Search deals, brands, gifts…" onPress={() => router.navigate({ pathname: '/search', params: { focus: '1' } })} />
      </View>
      {config.demoCatalog ? (
        <View style={s.banner}>
          <Banner tone="info" icon="flask-outline" message="Demo build · fictional brands, not real deals" />
        </View>
      ) : null}
      {showingCache ? (
        <View style={s.banner}>
          <Banner tone="warning" message={`You’re offline — showing offers from ${lastUpdated ? formatDate(new Date(lastUpdated).toISOString(), { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'earlier'}.`} actionLabel="Retry" onAction={onRefresh} busy={refreshing} />
        </View>
      ) : backendError && feed.length > 0 ? (
        <View style={s.banner}>
          <Banner tone="warning" message={`Some offers couldn’t load. ${backendError.message}`} actionLabel="Retry" onAction={onRefresh} busy={refreshing} />
        </View>
      ) : null}
      <DiscoveryBar value={filter} onChange={changeFilter} />
      <View style={s.barDivider} />
    </View>
  );

  return (
    <View style={s.root}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <FlashList
          ref={listRef}
          data={loadingFirst || failed ? [] : items}
          masonry
          numColumns={2}
          keyExtractor={(i) => i.key}
          getItemType={(i) => i.type}
          overrideItemLayout={(l, i) => {
            if (i.type !== 'offer') l.span = 2;
          }}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            loadingFirst ? (
              <View style={{ marginHorizontal: -H_PADDING, paddingTop: 20 }}>
                <FeedSkeleton columnWidth={colW} />
              </View>
            ) : failed ? (
              <StateView icon="wifi-off" tone="error" title="Can’t load offers" message={backendError?.message ?? 'Check your connection and try again.'} primary={{ label: 'Try again', icon: 'refresh', onPress: onRefresh, loading: refreshing }} />
            ) : null
          }
          ListFooterComponent={
            items.length && (filter === 'foryou' || CATEGORIES.some((c) => c.id === filter)) ? (
              <View style={s.footer}>
                {loadingMore ? (
                  <ActivityIndicator accessibilityLabel="Loading more offers" />
                ) : loadMoreFailed ? (
                  <Button label="Couldn’t load more · Retry" variant="secondary" size="md" icon="refresh" onPress={loadMore} />
                ) : !hasMore ? (
                  <Text variant="footnote" tone="secondary">
                    You’re all caught up. New offers arrive daily.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={{ height: 32 }} />
            )
          }
          onEndReached={hasMore && !loadMoreFailed ? loadMore : undefined}
          onEndReachedThreshold={0.8}
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={onViewable}
          contentContainerStyle={{ paddingHorizontal: H_PADDING }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        />
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, minHeight: 44 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  wordmark: { fontSize: 26, lineHeight: 30, fontWeight: '900', letterSpacing: -1 },
  locPill: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.fill },
  searchWrap: { paddingHorizontal: space.lg, marginTop: space.md },
  banner: { paddingHorizontal: space.lg, marginTop: space.md },
  bar: { paddingHorizontal: space.sm, paddingTop: space.lg, gap: space.xs },
  barItem: { alignItems: 'center', minWidth: 72, paddingHorizontal: space.sm, paddingTop: 2, gap: 4 },
  barLabel: { fontWeight: '600' },
  barLine: { height: 2, alignSelf: 'stretch', marginTop: 6, borderRadius: 1, backgroundColor: 'transparent' },
  barDivider: { height: 1, backgroundColor: colors.line, marginBottom: space.lg },
  cell: { paddingHorizontal: layout.gutter / 2, paddingBottom: space.xl },
  full: { marginHorizontal: -H_PADDING },
  section: { paddingTop: space.xs },
  rail: { paddingTop: space.sm, paddingBottom: space.xxl },
  module: { paddingHorizontal: space.lg, paddingBottom: space.xxl },
  footer: { alignItems: 'center', paddingVertical: space.xxl, marginHorizontal: -H_PADDING },
  moduleCard: { padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.fill },
  moduleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  locIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas, marginBottom: space.md },
  locActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
}));
