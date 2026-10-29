import { useEffect, useState } from 'react';
import { Animated, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, useTheme } from '@/theme';

/** Calm pulsing placeholder. Static when reduced motion is on. Hidden from screen readers. */
export function Skeleton({ width = '100%', height, radius = 8, style }: { width?: DimensionValue; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, reduceMotion } = useTheme();
  const v = useState(() => new Animated.Value(0.6))[0];
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.6, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, v]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.fill, opacity: reduceMotion ? 0.8 : v }, style]}
    />
  );
}

/** Placeholder matching the masonry feed so the layout doesn't jump when content arrives. */
export function FeedSkeleton({ columnWidth }: { columnWidth: number }) {
  const s = useStyles();
  const heights = [[1.25, 1], [1, 1.25], [1.25, 1.25]];
  return (
    <View style={s.grid} accessibilityLabel="Loading offers" accessibilityRole="progressbar">
      {[0, 1].map((col) => (
        <View key={col} style={{ width: columnWidth, gap: 20 }}>
          {heights.map((h, i) => (
            <View key={i} style={{ gap: 8 }}>
              <Skeleton height={columnWidth * h[col]} radius={14} />
              <Skeleton height={14} width="85%" />
              <Skeleton height={14} width="45%" />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ space }) => ({
  grid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm },
}));
