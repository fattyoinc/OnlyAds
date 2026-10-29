import { Redirect, Tabs } from 'expo-router';
import { Platform, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/state/AppState';
import { makeStyles, useTheme } from '@/theme';
import { haptics, Icon, Skeleton, type IconName } from '@/ui';

function TabIcon({ name, active, color, focused }: { name: IconName; active: IconName; color: ColorValue; focused: boolean }) {
  return <Icon name={focused ? active : name} size={24} color={color} />;
}

const icon = (name: IconName, active: IconName) =>
  function TabBarIcon(p: { color: ColorValue; focused: boolean }) {
    return <TabIcon name={name} active={active} {...p} />;
  };

export default function TabsLayout() {
  const { hydrated, onboarded, savedOrder } = useApp();
  const { colors } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  // Explicit, inset-aware sizing: labels never clip on devices without a bottom inset (Android 3-button nav, web).
  const barPad = insets.bottom > 0 ? insets.bottom : 8;

  if (!hydrated) {
    // Brief neutral placeholder while local settings load (never a spinner-only screen).
    return (
      <View style={s.boot}>
        <Skeleton height={32} width={140} />
      </View>
    );
  }
  if (!onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenListeners={{ tabPress: () => haptics.select() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
        tabBarItemStyle: { paddingTop: 6 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 56 + barPad, paddingBottom: barPad, ...(Platform.OS === 'android' ? { elevation: 0 } : null) },
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarHideOnKeyboard: Platform.OS === 'android',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarIcon: icon('compass-outline', 'compass') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: icon('magnify', 'magnify') }} />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: icon('heart-outline', 'heart'),
          tabBarBadge: savedOrder.length ? savedOrder.length : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
          tabBarAccessibilityLabel: savedOrder.length ? `Saved, ${savedOrder.length} offers` : 'Saved',
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: icon('account-circle-outline', 'account-circle') }} />
    </Tabs>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
}));
