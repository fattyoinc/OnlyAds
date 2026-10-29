import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, touch, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'destructive';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** One button component, five variants. Height grows with text size (minHeight, never fixed). */
export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, iconPosition = 'trailing', loading, disabled, fullWidth, accessibilityHint, style }: ButtonProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = { primary: colors.onInk, secondary: colors.text, ghost: colors.text, accent: '#FFFFFF', destructive: colors.danger }[variant];
  const inactive = disabled || loading;
  const iconEl = icon ? <Icon name={icon} size="md" color={fg} /> : null;
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      containerStyle={fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }}
      style={[s.base, size === 'lg' ? s.lg : s.md, s[variant], inactive && s.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={s.row}>
          {iconPosition === 'leading' && iconEl}
          <Text variant={size === 'lg' ? 'headline' : 'subhead'} tone="inherit" style={{ color: fg, fontWeight: '700' }} numberOfLines={1}>
            {label}
          </Text>
          {iconPosition === 'trailing' && iconEl}
        </View>
      )}
    </PressableScale>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  lg: { minHeight: 52, paddingHorizontal: space.xxl, paddingVertical: space.md },
  md: { minHeight: touch, paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  primary: { backgroundColor: colors.ink },
  accent: { backgroundColor: colors.sale },
  secondary: { backgroundColor: colors.fill },
  ghost: { backgroundColor: 'transparent' },
  destructive: { backgroundColor: colors.dangerSoft },
  disabled: { opacity: 0.4 },
}));

export const buttonStyles = StyleSheet.create({ flex: { flex: 1 } });
