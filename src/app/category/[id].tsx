import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { OfferCard } from '@/components/offers/OfferCard';
import { CATEGORIES, getCategory } from '@/data/categories';
import { searchOffers, type SortMode } from '@/services/search';
import { useApp } from '@/state/AppState';
import { artColors, layout, makeStyles, useTheme } from '@/theme';
import type { CategoryId, Offer } from '@/types/offer';
import { Button, Chip, goBack, Icon, NavBar, StateView, Text, useColumnWidth } from '@/ui';
import { distanceKm } from '@/utils/format';

const SORTS: { id: SortMode | 'foryou'; label: string }[] = [
  { id: 'foryou', label: 'For you' },
  { id: 'price', label: 'Lowest price' },
  { id: 'discount', label: 'Biggest discount' },
  { id: 'ending', label: 'Ending soon' },
];

const H_PADDING = layout.inset - layout.gutter / 2;

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: CategoryId }>();
  const s = useStyles();
  const { scheme } = useTheme();
  const colW = useColumnWidth();
  const { feed, offers, profile, toggleInterest, anchor, now, loadMore, hasMore, loadingMore, loadMoreFailed } = useApp();
  const [sort, setSort] = useState<SortMode | 'foryou'>('foryou');
  const cat = CATEGORIES.some((c) => c.id === id) ? getCategory(id) : undefined;

  const list = useMemo<Offer[]>(() => {
    if (!cat) return [];
    if (sort === 'foryou') return feed.filter((x) => x.offer.category === cat.id).map((x) => x.offer);
    const visible = offers.filter((o) => !profile.hiddenOfferIds.includes(o.id) && !profile.mutedAdvertiserIds.includes(o.advertiser.id));
    return searchOffers(visible, '', { categories: [cat.id] }, sort, { now });
  }, [cat, sort, feed, offers, profile, now]);

  const renderItem = useCallback(
    ({ item }: { item: Offer }) => (
      <View style={s.cell}>
        <OfferCard offer={item} width={colW} distanceKm={item.location && anchor ? distanceKm(anchor, item.location) : undefined} now={now} />
      </View>
    ),
    [s, colW, anchor, now],
  );

  if (!cat) {
    return (
      <View style={s.root}>
        <NavBar />
        <StateView icon="shape-outline" title="Category not found" message="This category doesn’t exist anymore." primary={{ label: 'Go back', onPress: () => goBack() }} />
      </View>
    );
  }
  const following = profile.interests.includes(cat.id);
  const a = artColors(cat.colors[0], scheme);

  const header = (
    <View style={{ marginHorizontal: -H_PADDING }}>
      <View style={s.hero}>
        <View style={[s.heroArt, { backgroundColor: a.backdrop }]}>
          <Icon name={cat.icon} size={40} color={a.glyph} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title1" accessibilityRole="header">
            {cat.name}
          </Text>
          <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
            {list.length} {list.length === 1 ? 'offer' : 'offers'} · {cat.blurb}
          </Text>
        </View>
      </View>
      <View style={s.follow}>
        <Button
          label={following ? 'Following' : 'Follow'}
          icon={following ? 'check' : 'plus'}
          iconPosition="leading"
          variant={following ? 'secondary' : 'primary'}
          size="md"
          onPress={() => toggleInterest(cat.id)}
          accessibilityHint={following ? 'Removes this category from your interests' : 'Adds this category to your interests'}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sorts}>
        {SORTS.map((o) => (
          <Chip key={o.id} label={o.label} selected={sort === o.id} onPress={() => setSort(o.id)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={s.root}>
      <NavBar title={cat.name} fallback="/search" />
      <FlashList
        data={list}
        masonry
        numColumns={2}
        keyExtractor={(o) => o.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={<StateView icon="tag-outline" title="Nothing here right now" message="New offers in this category show up as soon as advertisers publish them." compact />}
        contentContainerStyle={{ paddingHorizontal: H_PADDING, paddingBottom: 32 }}
        onEndReached={hasMore && !loadMoreFailed ? loadMore : undefined}
        onEndReachedThreshold={0.8}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ marginVertical: 24 }} accessibilityLabel="Loading more offers" />
          ) : loadMoreFailed ? (
            <View style={{ alignItems: 'center', marginVertical: 24 }}>
              <Button label="Couldn’t load more · Retry" variant="secondary" size="md" icon="refresh" onPress={loadMore} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingTop: space.sm },
  heroArt: { width: 76, height: 76, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  follow: { paddingHorizontal: space.lg, marginTop: space.lg },
  sorts: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg },
  cell: { paddingHorizontal: space.md / 2, paddingBottom: space.xl },
}));
