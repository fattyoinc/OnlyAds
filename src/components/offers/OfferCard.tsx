import { router } from 'expo-router';
import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { useOfferActions } from '@/state/AppState';
import { makeStyles } from '@/theme';
import type { Offer } from '@/types/offer';
import { Badge, haptics, PressableScale, Text } from '@/ui';
import { formatDistance } from '@/utils/format';
import { OfferArt } from './OfferArt';
import { aspectFor, disclosureText, isUnavailable, metaParts, offerA11yLabel, urgencyLabel, verifiedDiscount } from './presentation';
import { PriceTag } from './PriceTag';
import { SaveButton } from './SaveButton';

export type OfferCardVariant = 'grid' | 'hero' | 'compact' | 'row';

interface Props {
  offer: Offer;
  /** Width of the card's media (column width, rail width, or thumbnail size). */
  width: number;
  variant?: OfferCardVariant;
  distanceKm?: number;
  now: Date;
}

export function useOpenOffer() {
  const { track } = useOfferActions();
  return useCallback(
    (offer: Offer) => {
      haptics.select();
      track(offer, 'open');
      router.push({ pathname: '/offer/[id]', params: { id: offer.id } });
    },
    [track],
  );
}

/**
 * One card component, four formats sharing the same hierarchy:
 *   media → verified discount → name → price → advertiser (+ Sponsored) → tap to open.
 * Badges appear only when backed by data (computed discount, real expiry < 48h).
 */
export const OfferCard = memo(function OfferCard({ offer, width, variant = 'grid', distanceKm, now }: Props) {
  const s = useStyles();
  const open = useOpenOffer();
  const distance = offer.location && distanceKm != null ? formatDistance(distanceKm) : undefined;
  const discount = verifiedDiscount(offer);
  const urgency = urgencyLabel(offer, now);
  const ended = isUnavailable(offer, now);
  const disclosure = disclosureText(offer);
  const label = offerA11yLabel(offer, now, distance);

  if (variant === 'row') {
    return (
      <PressableScale onPress={() => open(offer)} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens offer details" scaleTo={0.985} style={s.row}>
        <OfferArt offer={offer} width={width} glyphRatio={0.42} style={[s.rowArt, { width, height: width }, ended && s.dim]} />
        <View style={s.rowBody}>
          <Text variant="headline" numberOfLines={2} style={ended && s.dimText}>
            {offer.title}
          </Text>
          <View style={s.rowPrice}>
            <PriceTag offer={offer} />
            {discount ? <Badge label={discount} tone="sale" /> : null}
          </View>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {metaParts(offer, distance).join(' · ')}
          </Text>
          {disclosure ? (
            <Text variant="caption" tone="secondary" style={s.disclosure} numberOfLines={1}>
              {disclosure}
            </Text>
          ) : null}
          {ended ? <Badge label="Offer ended" tone="neutral" icon="clock-alert-outline" style={{ marginTop: 6 }} /> : urgency ? <Badge label={urgency} tone="urgent" icon="clock-outline" style={{ marginTop: 6 }} /> : null}
        </View>
        <SaveButton offer={offer} variant="plain" />
      </PressableScale>
    );
  }

  const isHero = variant === 'hero';
  const isCompact = variant === 'compact';
  const aspect = isHero ? 0.72 : isCompact ? 1 : aspectFor(offer);
  const mediaH = Math.round(width * aspect);

  return (
    <PressableScale onPress={() => open(offer)} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens offer details" style={{ width }}>
      <OfferArt offer={offer} width={width} glyphRatio={isHero ? 0.26 : 0.36} style={[isHero ? s.heroMedia : s.media, { height: mediaH }]}>
        {discount ? <Badge label={discount} tone="sale" style={s.topLeft} /> : null}
        {!isCompact ? <SaveButton offer={offer} style={s.topRight} /> : null}
        {urgency ? <Badge label={urgency} tone="onMedia" icon="clock-outline" style={s.bottomLeft} /> : null}
      </OfferArt>
      <View style={isHero ? s.heroBody : s.body}>
        <Text variant={isHero ? 'title3' : 'subhead'} numberOfLines={2} style={!isHero && s.title}>
          {offer.title}
        </Text>
        <View style={s.priceLine}>
          <PriceTag offer={offer} />
        </View>
        <Text variant="footnote" tone="secondary" numberOfLines={1} style={s.meta}>
          {metaParts(offer, distance).join(' · ')}
        </Text>
        {disclosure ? (
          <Text variant="caption" tone="secondary" style={s.disclosure} numberOfLines={1}>
            {disclosure}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
});

const useStyles = makeStyles(({ colors, radius, space }) => ({
  media: { borderRadius: radius.md },
  heroMedia: { borderRadius: radius.lg },
  topLeft: { position: 'absolute', top: space.sm, left: space.sm },
  topRight: { position: 'absolute', top: 6, right: 6 },
  bottomLeft: { position: 'absolute', bottom: space.sm, left: space.sm },
  body: { paddingTop: space.sm, paddingHorizontal: 2 },
  heroBody: { paddingTop: space.md, paddingHorizontal: 2 },
  title: { fontWeight: '600' },
  priceLine: { marginTop: 3 },
  meta: { marginTop: 2 },
  disclosure: { marginTop: 1, fontWeight: '700', letterSpacing: 0.2, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  rowArt: { borderRadius: radius.md },
  rowBody: { flex: 1, gap: 3 },
  rowPrice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  dim: { opacity: 0.45 },
  dimText: { color: colors.textSecondary },
}));
