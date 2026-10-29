import { View } from 'react-native';

import type { Offer } from '@/types/offer';
import { Text } from '@/ui';
import { formatMoney } from '@/utils/format';

/** Price first (bold), previous price struck through. Promo text when there is no price. */
export function PriceTag({ offer, size = 'md' }: { offer: Offer; size?: 'md' | 'lg' }) {
  const big = size === 'lg';
  if (!offer.price) {
    return offer.promoLabel ? (
      <Text variant={big ? 'title2' : 'price'} tone="accent" numberOfLines={1}>
        {offer.promoLabel}
      </Text>
    ) : null;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <Text variant={big ? 'title1' : 'price'} tone={offer.originalPrice ? 'accent' : 'primary'}>
        {formatMoney(offer.price)}
      </Text>
      {offer.originalPrice ? (
        <Text variant={big ? 'callout' : 'footnote'} tone="secondary" style={{ textDecorationLine: 'line-through' }} accessibilityLabel={`was ${formatMoney(offer.originalPrice)}`}>
          {formatMoney(offer.originalPrice)}
        </Text>
      ) : null}
    </View>
  );
}
