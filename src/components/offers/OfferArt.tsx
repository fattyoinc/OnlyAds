import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { getCategory } from '@/data/categories';
import { artColors, pickArtBase, useTheme } from '@/theme';
import type { Offer } from '@/types/offer';
import { Icon } from '@/ui';

/** Base color for an offer's generated art and brand mark. */
export function artBase(offer: Offer): string {
  return pickArtBase(offer.creative.colors, getCategory(offer.category).colors[0]);
}

/**
 * Offer media. Shows the advertiser's image when a feed provides one; until it
 * loads (or if it fails) a quiet "studio" placeholder is shown: a soft tint of
 * the brand color with the product glyph standing on a floor shadow. One color,
 * no gradients — the ads are meant to be the color in the app.
 */
export const OfferArt = memo(function OfferArt({
  offer,
  style,
  glyphRatio = 0.36,
  width,
  children,
}: {
  offer: Offer;
  style?: StyleProp<ViewStyle>;
  /** Glyph size as a fraction of `width`. */
  glyphRatio?: number;
  width: number;
  children?: React.ReactNode;
}) {
  const { scheme, reduceMotion } = useTheme();
  const [failed, setFailed] = useState(false);
  const c = artColors(artBase(offer), scheme);
  const glyph = Math.max(28, Math.round(width * glyphRatio));
  const showImage = !!offer.imageUrl && !failed;
  return (
    <View style={[styles.root, { backgroundColor: c.backdrop }, style]}>
      {/* Placeholder art always renders underneath: it's the loading and failure state of the image. */}
      <View style={styles.center} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Icon name={offer.creative.icon} size={glyph} color={c.glyph} />
        <View style={[styles.floor, { width: glyph * 0.9, height: Math.max(4, glyph * 0.1), borderRadius: glyph, backgroundColor: c.floor }]} />
      </View>
      {showImage ? (
        <Image
          source={{ uri: offer.imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={reduceMotion ? 0 : 180}
          cachePolicy="memory-disk"
          recyclingKey={offer.id}
          onError={() => setFailed(true)}
          accessible={false}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  floor: { marginTop: 6, opacity: 0.9 },
});
