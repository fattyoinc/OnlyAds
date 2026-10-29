import { router } from 'expo-router';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles } from '@/theme';
import { platformIcons } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export function goBack(fallback: string = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as never);
}

/** Large title header for top-level (tab) screens. */
export function LargeHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.large, { paddingTop: insets.top + 8 }]}>
      <View style={{ flex: 1 }}>
        <Text variant="title1" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * Navigation bar for pushed screens: platform back glyph, title (centered on
 * iOS, leading on Android), optional trailing actions. `overlay` floats over media.
 */
export function NavBar({ title, right, overlay, fallback, style }: { title?: string; right?: React.ReactNode; overlay?: boolean; fallback?: string; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const ios = Platform.OS === 'ios';
  return (
    <View style={[s.nav, { paddingTop: insets.top + 4 }, overlay && s.overlay, style]} pointerEvents="box-none">
      <IconButton icon={platformIcons.back} label="Back" variant={overlay ? 'overlay' : 'plain'} onPress={() => goBack(fallback)} />
      <View style={[s.titleWrap, ios && s.titleCenter]} pointerEvents="none">
        {title ? (
          <Text variant="headline" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
      </View>
      <View style={s.right}>{right}</View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, space }) => ({
  large: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md, backgroundColor: colors.canvas },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingBottom: space.xs, backgroundColor: colors.canvas },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: 'transparent', paddingHorizontal: space.md },
  titleWrap: { flex: 1, paddingHorizontal: space.xs },
  titleCenter: { alignItems: 'center' },
  right: { flexDirection: 'row', gap: space.sm, minWidth: 44, justifyContent: 'flex-end' },
}));
