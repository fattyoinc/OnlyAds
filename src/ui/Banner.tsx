import { ActivityIndicator, Pressable, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Inline status message (offline, partial failure, demo build). Announced politely to screen readers. */
export function Banner({ tone, icon, message, actionLabel, onAction, busy }: { tone: 'info' | 'warning' | 'error'; icon?: IconName; message: string; actionLabel?: string; onAction?: () => void; busy?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = tone === 'error' ? colors.danger : tone === 'warning' ? colors.warning : colors.text;
  const bg = tone === 'error' ? colors.dangerSoft : tone === 'warning' ? colors.warningSoft : colors.fill;
  return (
    <View style={[s.root, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name={icon ?? (tone === 'info' ? 'information-outline' : 'wifi-off')} size="sm" color={fg} />
      <Text variant="footnote" tone="inherit" style={[s.text, { color: fg }]}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} disabled={busy} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={10} style={s.action}>
          {busy ? <ActivityIndicator size="small" color={fg} /> : <Text variant="footnote" tone="inherit" style={{ color: fg, fontWeight: '800' }}>{actionLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ radius, space }) => ({
  root: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.md },
  text: { flex: 1, fontWeight: '600' },
  action: { minHeight: 32, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
}));
