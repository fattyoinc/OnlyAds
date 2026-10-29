import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferCard } from '@/components/offers/OfferCard';
import { CATEGORIES } from '@/data/categories';
import { bucket, track } from '@/services/analytics';
import { searchOffers, TRENDING_SEARCHES, type SortMode } from '@/services/search';
import { useApp } from '@/state/AppState';
import { artColors, layout, makeStyles, useTheme } from '@/theme';
import type { CategoryId, Offer } from '@/types/offer';
import { Chip, Icon, OptionSheet, SearchInput, showOptionsIOS, StateView, Text, useContentWidth, type Option } from '@/ui';
import { distanceKm } from '@/utils/format';

const SORTS: Option<SortMode>[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price', label: 'Lowest price' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'ending', label: 'Ending soonest' },
  { value: 'distance', label: 'Nearest' },
];

function CategoryGrid({ counts }: { counts: Record<string, number> }) {
  const s = useStyles();
  const { scheme } = useTheme();
  const width = useContentWidth();
  const tileW = Math.floor((width - layout.inset * 2 - layout.gutter * 2) / 3);
  return (
    <View style={s.catGrid}>
      {CATEGORIES.map((c) => {
        const a = artColors(c.colors[0], scheme);
        return (
          <Pressable
            key={c.id}
            onPress={() => {
              track('category_select', { category: c.id, surface: 'search' });
              router.push({ pathname: '/category/[id]', params: { id: c.id } });
            }}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}, ${counts[c.id] ?? 0} offers`}
            style={({ pressed }) => [{ width: tileW }, pressed && { opacity: 0.75 }]}
          >
            <View style={[s.catTile, { height: tileW * 0.82, backgroundColor: a.backdrop }]}>
              <Icon name={c.icon} size={Math.round(tileW * 0.32)} color={a.glyph} />
            </View>
            <Text variant="subhead" numberOfLines={1} style={{ marginTop: 6, fontWeight: '600' }}>
              {c.name}
            </Text>
            <Text variant="caption" tone="secondary" style={{ fontWeight: '400' }}>
              {counts[c.id] ?? 0} offers
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Search() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string; sort?: SortMode; category?: CategoryId; focus?: string }>();
  const { offers, profile, anchor, now, recentSearches, addRecentSearch, clearRecentSearches, locationEnabled } = useApp();
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const [q, setQ] = useState(params.q ?? '');
  const [sort, setSort] = useState<SortMode>(params.sort ?? 'relevance');
  const [cat, setCat] = useState<CategoryId | undefined>(params.category);
  const [withCode, setWithCode] = useState(false);
  const [under50, setUnder50] = useState(false);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [sheet, setSheet] = useState(false);

  // Follow incoming params (deep links, "#tag" taps, the home search bar).
  const [prev, setPrev] = useState(params);
  if (params.q !== prev.q || params.sort !== prev.sort || params.category !== prev.category || params.focus !== prev.focus) {
    setPrev(params);
    if (params.q !== undefined) setQ(params.q);
    if (params.sort) setSort(params.sort);
    if (params.category !== undefined) setCat(params.category);
  }

  useFocusEffect(
    useCallback(() => {
      if (params.focus) {
        const t = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'android' ? 250 : 50);
        router.setParams({ focus: undefined });
        return () => clearTimeout(t);
      }
    }, [params.focus]),
  );

  const filtersOn = withCode || under50 || nearbyOnly || !!cat || sort !== 'relevance';
  const active = q.trim().length > 0 || filtersOn;

  const visible = useMemo(() => offers.filter((o) => !profile.hiddenOfferIds.includes(o.id) && !profile.mutedAdvertiserIds.includes(o.advertiser.id)), [offers, profile.hiddenOfferIds, profile.mutedAdvertiserIds]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of visible) m[o.category] = (m[o.category] ?? 0) + 1;
    return m;
  }, [visible]);

  const results = useMemo(() => {
    if (!active) return [];
    return searchOffers(visible, q, { categories: cat ? [cat] : [], onlyWithCode: withCode, maxPrice: under50 ? 50 : undefined, onlyLocal: nearbyOnly }, sort, {
      now,
      distanceOf: (o) => (o.location && anchor ? distanceKm(anchor, o.location) : undefined),
    });
  }, [active, visible, q, cat, withCode, under50, nearbyOnly, sort, anchor, now]);

  const run = (term: string) => {
    setQ(term);
    addRecentSearch(term);
  };

  const sortLabel = SORTS.find((o) => o.value === sort)!.label;
  const openSort = () => {
    const opts = SORTS.filter((o) => o.value !== 'distance' || anchor);
    if (Platform.OS === 'ios') showOptionsIOS('Sort by', opts, setSort);
    else setSheet(true);
  };
  const clearAll = () => {
    setWithCode(false);
    setUnder50(false);
    setNearbyOnly(false);
    setCat(undefined);
    setSort('relevance');
  };

  const renderItem = useCallback(
    ({ item }: { item: Offer }) => (
      <View style={s.rowWrap}>
        <OfferCard offer={item} width={88} variant="row" distanceKm={item.location && anchor ? distanceKm(anchor, item.location) : undefined} now={now} />
      </View>
    ),
    [s, anchor, now],
  );

  return (
    <View style={[s.root, { paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text variant="title1" accessibilityRole="header">
          Search
        </Text>
        <View style={{ marginTop: 12 }}>
          <SearchInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            onClear={() => setQ('')}
            onSubmitEditing={() => {
              addRecentSearch(q);
              track('search', { results_bucket: bucket(results.length), has_filters: filtersOn });
            }}
            placeholder="Deals, brands, products…"
            accessibilityLabel="Search offers"
            maxLength={100}
          />
        </View>
      </View>

      {active ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} style={s.filterBar} keyboardShouldPersistTaps="handled">
            <Chip label={sortLabel} icon="swap-vertical" trailingIcon="chevron-down" onPress={openSort} accessibilityLabel={`Sort: ${sortLabel}`} />
            {cat ? <Chip label={CATEGORIES.find((c) => c.id === cat)!.name} selected trailingIcon="close" onPress={() => setCat(undefined)} accessibilityLabel={`Remove category filter ${cat}`} /> : null}
            <Chip label="Under $50" selected={under50} showCheck onPress={() => setUnder50(!under50)} />
            <Chip label="Promo code" selected={withCode} showCheck onPress={() => setWithCode(!withCode)} />
            {locationEnabled || anchor ? <Chip label="Nearby" selected={nearbyOnly} showCheck onPress={() => setNearbyOnly(!nearbyOnly)} /> : null}
          </ScrollView>
          <FlashList
            data={results}
            keyExtractor={(o) => o.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 24 }}
            ListHeaderComponent={
              <Text variant="footnote" tone="secondary" style={s.count} accessibilityLiveRegion="polite">
                {results.length} {results.length === 1 ? 'result' : 'results'}
                {q.trim() ? ` for “${q.trim()}”` : ''}
              </Text>
            }
            ListEmptyComponent={
              <StateView
                icon="magnify-close"
                title={q.trim() ? `No results for “${q.trim()}”` : 'No offers match these filters'}
                message="Try a shorter search or fewer filters. New deals arrive every day."
                primary={filtersOn ? { label: 'Clear filters', onPress: clearAll } : undefined}
                secondary={{ label: 'Browse categories', onPress: () => { setQ(''); clearAll(); } }}
              />
            }
          />
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 32 }}>
          {recentSearches.length ? (
            <View style={s.block}>
              <View style={s.blockHead}>
                <Text variant="headline">Recent</Text>
                <Pressable onPress={clearRecentSearches} accessibilityRole="button" accessibilityLabel="Clear recent searches" hitSlop={12}>
                  <Text variant="subhead" style={{ textDecorationLine: 'underline' }}>
                    Clear
                  </Text>
                </Pressable>
              </View>
              <View style={s.wrap}>
                {recentSearches.map((r) => (
                  <Chip key={r} label={r} icon="history" onPress={() => run(r)} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={s.block}>
            <Text variant="headline" style={{ marginBottom: 10 }}>
              Popular searches
            </Text>
            <View style={s.wrap}>
              {TRENDING_SEARCHES.map((t) => (
                <Chip key={t} label={t} icon="trending-up" onPress={() => run(t)} />
              ))}
            </View>
          </View>
          <View style={s.block}>
            <Text variant="headline" style={{ marginBottom: 12 }}>
              Browse categories
            </Text>
            <CategoryGrid counts={counts} />
          </View>
        </ScrollView>
      )}
      <OptionSheet visible={sheet} title="Sort by" options={SORTS.filter((o) => o.value !== 'distance' || anchor)} value={sort} onSelect={setSort} onClose={() => setSheet(false)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  head: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  filterBar: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  count: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xs },
  rowWrap: { paddingHorizontal: space.lg },
  block: { paddingHorizontal: space.lg, marginTop: space.xl },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, rowGap: space.lg },
  catTile: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
}));
