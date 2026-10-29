import { getLocales } from 'expo-localization';
import { DarkTheme, DefaultTheme, router, SplashScreen, Stack, ThemeProvider as NavThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { installGlobalHandler, reportError } from '@/services/monitoring';
import { onReminderOpened } from '@/services/reminders';
import { AppStateProvider, useApp } from '@/state/AppState';
import { layout, ThemeProvider, useTheme } from '@/theme';
import { StateView, ToastProvider } from '@/ui';
import { configureFormatting } from '@/utils/format';

// Runs once at module load, before the first render.
try {
  const loc = getLocales()[0];
  configureFormatting({ locale: loc?.languageTag, miles: loc ? loc.measurementSystem === 'us' || loc.measurementSystem === 'uk' : true });
} catch (e) {
  reportError(e, 'locale');
}
installGlobalHandler();
// Keep the native splash until saved settings are loaded (avoids a flash of placeholder UI).
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Shown instead of a white screen if any screen throws while rendering. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => reportError(error, 'render', true), [error]);
  return (
    <ThemeProvider>
      <ErrorScreen retry={retry} />
    </ThemeProvider>
  );
}

function ErrorScreen({ retry }: { retry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}>
      <StateView icon="alert-circle-outline" title="Something went wrong" message="The problem has been logged. Your saved offers and settings are safe." primary={{ label: 'Try again', icon: 'refresh', onPress: retry }} />
    </View>
  );
}

function ThemedApp() {
  const { colors, scheme } = useTheme();
  const { hydrated } = useApp();
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);
  // Tapping an "ending soon" reminder opens that offer.
  useEffect(() => (hydrated ? onReminderOpened((id) => router.push({ pathname: '/offer/[id]', params: { id } })) : undefined), [hydrated]);

  // Native navigation colors match our palette, so transitions never flash white in dark mode.
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.canvas, card: colors.surface, text: colors.text, border: colors.line, primary: colors.text, notification: colors.accent } };
  }, [scheme, colors]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.canvas).catch(() => {});
  }, [colors.canvas]);

  const frame = Platform.OS === 'web' ? ({ flex: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', overflow: 'hidden', backgroundColor: colors.canvas } as const) : { flex: 1 };

  return (
    <NavThemeProvider value={navTheme}>
      <ToastProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <View style={[frame, { backgroundColor: colors.canvas }]}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'fade' }} />
            <Stack.Screen name="offer/[id]" />
            <Stack.Screen name="category/[id]" />
            <Stack.Screen name="nearby" />
            <Stack.Screen name="legal/[doc]" />
          </Stack>
        </View>
      </ToastProvider>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppStateProvider>
          <ThemedApp />
        </AppStateProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
