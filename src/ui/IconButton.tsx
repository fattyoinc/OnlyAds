import { type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, touch, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

/** 44pt circular icon button. `overlay` floats over media; `fill` sits on canvas; `plain` is borderless. */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'fill',
  color,
  size = 'md',
  style,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'overlay' | 'fill' | 'plain';
  color?: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const dim = size === 'sm' ? 34 : touch;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={size === 'sm' ? 6 : 0}
      scaleTo={0.9}
      style={[s.base, { width: dim, height: dim, borderRadius: dim / 2 }, s[variant], style]}
    >
      <Icon name={icon} size={size === 'sm' ? 18 : 22} color={color ?? colors.text} />
    </PressableScale>
  );
}

const useStyles = makeStyles(({ colors, elevation }) => ({
  base: { alignItems: 'center', justifyContent: 'center' },
  overlay: { backgroundColor: colors.overlayButton, ...elevation(1) },
  fill: { backgroundColor: colors.fill },
  plain: { backgroundColor: 'transparent' },
}));
