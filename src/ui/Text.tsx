import { Text as RNText, type TextProps } from 'react-native';

import { typography, useTheme, type Palette, type TypeVariant } from '@/theme';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'onInk' | 'danger' | 'success' | 'warning' | 'inherit';

const toneKey: Record<Exclude<Tone, 'inherit'>, keyof Palette> = {
  primary: 'text',
  secondary: 'textSecondary',
  tertiary: 'textTertiary',
  accent: 'accentText',
  onInk: 'onInk',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
};

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  align?: 'left' | 'center' | 'right';
}

/** Themed text using the type scale. Scales with system text size (capped where layout demands via maxFontSizeMultiplier). */
export function Text({ variant = 'body', tone = 'primary', align, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  return <RNText {...rest} style={[typography[variant], tone !== 'inherit' && { color: colors[toneKey[tone]] }, align && { textAlign: align }, style]} />;
}
