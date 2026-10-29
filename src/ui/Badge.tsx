import { View, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'sale' | 'urgent' | 'neutral' | 'onMedia';

/** Compact label on media or inline. Only render badges backed by real data (see OfferCard). */
export function Badge({ label, tone = 'neutral', icon, style }: { label: string; tone?: BadgeTone; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = { sale: '#FFFFFF', urgent: colors.warning, neutral: colors.text, onMedia: colors.text }[tone];
  return (
    <View style={[s.base, s[tone], style]}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text variant="caption" tone="inherit" style={{ color: fg, fontWeight: '800' }} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius }) => ({
  base: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.sm },
  sale: { backgroundColor: colors.sale },
  urgent: { backgroundColor: colors.warningSoft },
  neutral: { backgroundColor: colors.fill },
  onMedia: { backgroundColor: colors.overlayButton },
}));
