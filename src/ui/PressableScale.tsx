import { useState } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { motion, useTheme } from '@/theme';

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Style for the outer touch target (e.g. flex sizing). */
  containerStyle?: StyleProp<ViewStyle>;
  /** Scale while pressed (default 0.97). */
  scaleTo?: number;
  children: React.ReactNode;
}

/**
 * Pressable with a fast, subtle scale-down on touch (native driver). Falls back
 * to an opacity change when the user prefers reduced motion.
 */
export function PressableScale({ style, containerStyle, scaleTo = motion.pressScale, children, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const { reduceMotion } = useTheme();
  const v = useState(() => new Animated.Value(1))[0];
  const to = (value: number) => Animated.spring(v, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable
      {...rest}
      style={containerStyle}
      onPressIn={(e) => {
        if (!reduceMotion) to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion) to(1);
        onPressOut?.(e);
      }}
    >
      {({ pressed }) => <Animated.View style={[style, { transform: [{ scale: v }] }, reduceMotion && pressed && { opacity: 0.7 }]}>{children}</Animated.View>}
    </Pressable>
  );
}
