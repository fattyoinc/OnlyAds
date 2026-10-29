import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { elevation, palettes, radius, space, typography, type Palette, type Scheme } from './tokens';

export * from './tokens';

export interface Theme {
  scheme: Scheme;
  colors: Palette;
  /** User prefers reduced motion (iOS Reduce Motion / Android Remove animations). */
  reduceMotion: boolean;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: palettes.light, reduceMotion: false });

/** Follows the system appearance and reduced-motion setting. */
export function ThemeProvider({ children, scheme: forced }: { children: ReactNode; scheme?: Scheme }) {
  const system = useColorScheme();
  const scheme: Scheme = forced ?? (system === 'dark' ? 'dark' : 'light');
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const value = useMemo(() => ({ scheme, colors: palettes[scheme], reduceMotion }), [scheme, reduceMotion]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type Helpers = { colors: Palette; scheme: Scheme; space: typeof space; radius: typeof radius; type: typeof typography; elevation: (l: 1 | 2) => object };

/**
 * Define themed styles once per component:
 *   const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.canvas } }));
 * Styles are created once per color scheme and cached.
 */
export function makeStyles<const T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: (t: Helpers) => T) {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles(): T {
    const { scheme, colors } = useTheme();
    if (!cache[scheme]) {
      cache[scheme] = StyleSheet.create(factory({ colors, scheme, space, radius, type: typography, elevation: (l) => elevation(l, scheme) }));
    }
    return cache[scheme]!;
  };
}
