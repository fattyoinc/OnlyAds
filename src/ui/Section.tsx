import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { makeStyles } from '@/theme';
import { Text } from './Text';

/** Section title with optional subtitle and a single text action. */
export function SectionHeader({ title, subtitle, action, onAction, style }: { title: string; subtitle?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return (
    <View style={[s.root, style]}>
      <View style={{ flex: 1 }}>
        <Text variant="title3" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={`${action}, ${title}`} hitSlop={12} style={s.action}>
          <Text variant="subhead" style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ space }) => ({
  root: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingHorizontal: space.lg, marginBottom: space.md },
  action: { minHeight: 32, justifyContent: 'center' },
}));
