import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { OfferCard } from '@/components/offers/OfferCard';
import { getCategory } from '@/data/categories';
import type { ScoredOffer } from '@/services/ranking';
import { useApp } from '@/state/AppState';
import { makeStyles } from '@/theme';
import type { CategoryId } from '@/types/offer';
import { Chip, NavBar, StateView, Text, useGuardedAction } from '@/ui';
import { usesMiles } from '@/utils/format';

const KM_PER_MI = 1.60934;
const RADII_MI = [1, 3, 5, 10];
const RADII_KM = [2, 5, 10, 20];

export default function Nearby() {
  const s = useStyles();
  const params = useLocalSearchParams<{ category?: CategoryId }>();
  const { feed, anchor, locationEnabled, locationState, enableLocation, now } = useApp();
  const miles = usesMiles();
  const radii = miles ? RADII_MI : RADII_KM;
  const unit = miles ? 'mi' : 'km';
  const [radiusIdx, setRadiusIdx] = useState(2);
  const radiusKm = radii[radiusIdx] * (miles ? KM_PER_MI : 1);
  const [cat, setCat] = useState<CategoryId | undefined>(params.category);
  const requestLocation = useGuardedAction(enableLocation);

  const local = useMemo(() => feed.filter((x) => x.offer.location && x.distanceKm != null), [feed]);
  const cats = useMemo(() => [...new Set(local.map((x) => x.offer.category))], [local]);
  const list = useMemo(() => local.filter((x) => x.distanceKm! <= radiusKm && (!cat || x.offer.category === cat)).sort((a, b) => a.distanceKm! - b.distanceKm!), [local, radiusKm, cat]);

  const renderItem = useCallback(
    ({ item }: { item: ScoredOffer }) => (
      <View style={s.row}>
        <OfferCard offer={item.offer} width={88} variant="row" distanceKm={item.distanceKm} now={now} />
      </View>
    ),
    [s, now],
  );

  if (!anchor) {
    return (
      <View style={s.root}>
        <NavBar title="Near you" />
        {locationState === 'denied' ? (
          <StateView
            icon="map-marker-off-outline"
            title="Location is off for Only Ads"
            message="To see nearby deals, allow location in Settings. “While Using the App” and approximate location are enough."
            primary={{ label: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) }}
          />
        ) : (
          <StateView
            icon="map-marker-radius-outline"
            title="Find deals near you"
            message="Restaurants, shops and events around you. We use approximate location (about 1 km), only while you use the app, and never share it with advertisers."
            primary={{ label: locationState === 'requesting' ? 'Locating…' : 'Turn on location', icon: 'crosshairs-gps', onPress: requestLocation, loading: locationState === 'requesting' }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <NavBar title="Near you" />
      <FlashList
        data={list}
        keyExtractor={(x) => x.offer.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            <Text variant="footnote" tone="secondary" style={s.where}>
              {locationEnabled ? 'Around your approximate location' : `Sample area: ${anchor.label}`}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {radii.map((r, i) => (
                <Chip key={r} label={`${r} ${unit}`} selected={radiusIdx === i} onPress={() => setRadiusIdx(i)} accessibilityLabel={`Within ${r} ${unit}`} />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, { paddingTop: 0 }]}>
              <Chip label="All" selected={!cat} onPress={() => setCat(undefined)} />
              {cats.map((c) => (
                <Chip key={c} label={getCategory(c).name} icon={getCategory(c).icon} selected={cat === c} onPress={() => setCat(cat === c ? undefined : c)} />
              ))}
            </ScrollView>
            <Text variant="footnote" tone="secondary" style={s.count} accessibilityLiveRegion="polite">
              {list.length} {list.length === 1 ? 'deal' : 'deals'} within {radii[radiusIdx]} {unit}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <StateView
            icon="map-search-outline"
            title="No deals in this range"
            message="Try a wider radius or another category."
            primary={radiusIdx < radii.length - 1 ? { label: `Show within ${radii[radii.length - 1]} ${unit}`, onPress: () => setRadiusIdx(radii.length - 1) } : undefined}
            compact
          />
        }
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  where: { paddingHorizontal: space.lg, paddingTop: space.xs },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  count: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  row: { paddingHorizontal: space.lg },
}));
