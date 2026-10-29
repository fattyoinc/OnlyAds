import { View, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/**
 * Filter / toggle chip. Selected state uses ink fill AND a check icon, so it
 * never depends on color alone.
 */
export function Chip({
  label,
  icon,
  selected,
  onPress,
  showCheck = false,
  trailingIcon,
  style,
  accessibilityLabel,
}: {
  label: string;
  /** Any MaterialCommunityIcons glyph name; unknown names fall back safely. */
  icon?: IconName | string;
  selected?: boolean;
  onPress?: () => void;
  showCheck?: boolean;
  trailingIcon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = selected ? colors.onInk : colors.text;
  return (
    <PressableScale
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      scaleTo={0.95}
      style={[s.chip, selected && s.selected, style]}
    >
      <View style={s.row}>
        {selected && showCheck ? <Icon name="check" size="sm" color={fg} /> : icon ? <Icon name={icon} size="sm" color={fg} /> : null}
        <Text variant="subhead" tone="inherit" style={{ color: fg, fontWeight: '600' }} maxFontSizeMultiplier={1.5} numberOfLines={1}>
          {label}
        </Text>
        {trailingIcon ? <Icon name={trailingIcon} size="sm" color={fg} /> : null}
      </View>
    </PressableScale>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  chip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: space.md + 2, borderRadius: radius.pill, backgroundColor: colors.fill },
  selected: { backgroundColor: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
