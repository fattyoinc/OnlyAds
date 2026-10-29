import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useIsSaved, useOfferActions } from '@/state/AppState';
import { useTheme } from '@/theme';
import type { Offer } from '@/types/offer';
import { haptics, Icon, useToast } from '@/ui';

/**
 * Heart toggle. Saving pops the heart (spring), gives a light haptic and shows
 * a toast with a shortcut to Saved. Reduced motion: no pop, same feedback otherwise.
 */
export const SaveButton = memo(function SaveButton({ offer, variant = 'overlay', toastOffset = 88, style }: { offer: Offer; variant?: 'overlay' | 'plain'; toastOffset?: number; style?: StyleProp<ViewStyle> }) {
  const saved = useIsSaved(offer.id);
  const { toggleSave } = useOfferActions();
  const { colors, reduceMotion } = useTheme();
  const toast = useToast();
  const scale = useState(() => new Animated.Value(1))[0];

  const onPress = () => {
    haptics.tap();
    toggleSave(offer);
    if (!saved) {
      if (!reduceMotion) {
        scale.setValue(0.7);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
      }
      toast({ message: 'Saved to your favorites', icon: 'heart', actionLabel: 'View', onAction: () => router.navigate('/saved'), offset: toastOffset });
    }
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${offer.title} from saved` : `Save ${offer.title}`}
      accessibilityState={{ selected: saved }}
      hitSlop={8}
      style={[styles.base, variant === 'overlay' && { backgroundColor: colors.overlayButton }, style]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={saved ? 'heart' : 'heart-outline'} size={20} color={saved ? colors.accent : colors.text} />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
