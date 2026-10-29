import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Platform, type ColorValue } from 'react-native';

import { iconSize, useTheme } from '@/theme';

export type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export function isIconName(n: string): n is IconName {
  return n in MaterialCommunityIcons.glyphMap;
}

/** Decorative by default (hidden from screen readers); give the parent control the label. */
export function Icon({ name, size = 'md', color }: { name: IconName | string; size?: keyof typeof iconSize | number; color?: ColorValue }) {
  const { colors } = useTheme();
  const glyph = isIconName(name) ? name : 'tag-outline';
  return (
    <MaterialCommunityIcons
      name={glyph}
      size={typeof size === 'number' ? size : iconSize[size]}
      color={(color ?? colors.text) as string}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/** Platform-conventional glyphs. */
export const platformIcons = {
  back: (Platform.OS === 'ios' ? 'chevron-left' : 'arrow-left') as IconName,
  share: (Platform.OS === 'ios' ? 'export-variant' : 'share-variant') as IconName,
  more: (Platform.OS === 'ios' ? 'dots-horizontal' : 'dots-vertical') as IconName,
};
