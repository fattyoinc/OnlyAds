import { Platform, Pressable, Switch, View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * Settings-style row. Uses a native Switch for toggles, Android ripple / iOS
 * highlight for navigation rows, and a chevron only where a row navigates.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  toggle,
  destructive,
  last,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  destructive?: boolean;
  last?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const content = (
    <View style={[s.row, !last && s.divider]}>
      {icon ? (
        <View style={s.icon}>
          <Icon name={icon} size="md" color={destructive ? colors.danger : colors.text} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="callout" tone={destructive ? 'danger' : 'primary'} style={{ fontWeight: '500' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="subhead" tone="secondary" numberOfLines={1} style={{ maxWidth: '45%', fontWeight: '400' }}>
          {value}
        </Text>
      ) : null}
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          disabled={toggle.disabled}
          accessibilityLabel={title}
          trackColor={{ true: Platform.OS === 'ios' ? '#34C759' : colors.ink, false: colors.fillPressed }}
          thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
        />
      ) : onPress ? (
        <Icon name="chevron-right" size="md" color={colors.textTertiary} />
      ) : null}
    </View>
  );
  if (!onPress || toggle) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      android_ripple={{ color: colors.fillPressed }}
      style={({ pressed }) => [Platform.OS !== 'android' && pressed && { backgroundColor: colors.fill }]}
    >
      {content}
    </Pressable>
  );
}

/** Grouped container for ListRows (iOS inset-grouped style, flat on Android). */
export function ListGroup({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.group}>
      {title ? (
        <Text variant="overline" tone="secondary" style={s.groupTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={s.card}>{children}</View>
      {footer ? (
        <Text variant="footnote" tone="secondary" style={s.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingVertical: space.sm + 2, paddingHorizontal: space.lg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  icon: { width: 28, alignItems: 'center' },
  group: { marginTop: space.xxl },
  groupTitle: { marginHorizontal: space.lg + 4, marginBottom: space.sm },
  card: { marginHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.fill, overflow: 'hidden' },
  footer: { marginHorizontal: space.lg + 4, marginTop: space.sm },
}));
