/**
 * Only Ads design tokens — the single source of truth for visual decisions.
 *
 * Identity: a calm, image-first canvas (ads are the color), near-black ink for
 * primary actions, and one signature accent — "Only Coral" — used sparingly for
 * the brand dot, saved hearts, verified discounts and the active state.
 * Every text/background pair here meets WCAG AA (4.5:1) — see theme.test.ts.
 */
import { Platform, type TextStyle } from 'react-native';

export type Scheme = 'light' | 'dark';

export interface Palette {
  /** Screen background. */
  canvas: string;
  /** Raised surfaces: cards, sheets, tab bar. */
  surface: string;
  /** Filled controls: search field, chips, inputs, skeletons. */
  fill: string;
  fillPressed: string;
  /** Hairlines and separators. */
  line: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  /** Text/icons on `ink` backgrounds (primary buttons). */
  onInk: string;
  /** Primary action background (buttons, selected chips). */
  ink: string;
  accent: string;
  /** Accent used for text/price on canvas (AA contrast). */
  accentText: string;
  accentSoft: string;
  /** Discount badge: white text on this passes AA. */
  sale: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  scrim: string;
  overlayButton: string;
  shadow: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    canvas: '#FFFFFF',
    surface: '#FFFFFF',
    fill: '#F3F3F5',
    fillPressed: '#E8E8EC',
    line: '#E6E6EA',
    text: '#111114',
    textSecondary: '#5F5F6B',
    textTertiary: '#6E6E79',
    onInk: '#FFFFFF',
    ink: '#111114',
    accent: '#F0424F',
    accentText: '#C21F35',
    accentSoft: '#FFECEE',
    sale: '#C8233A',
    success: '#0E7A3D',
    successSoft: '#E7F6EC',
    warning: '#A04000',
    warningSoft: '#FFF2E5',
    danger: '#C4262B',
    dangerSoft: '#FDECEC',
    scrim: 'rgba(0,0,0,0.35)',
    overlayButton: 'rgba(255,255,255,0.94)',
    shadow: '#000000',
  },
  dark: {
    canvas: '#0F0F11',
    surface: '#18181B',
    fill: '#222226',
    fillPressed: '#2D2D32',
    line: '#2A2A2F',
    text: '#F4F4F5',
    textSecondary: '#A1A1AA',
    textTertiary: '#8E8E98',
    onInk: '#111114',
    ink: '#F4F4F5',
    accent: '#FF5C67',
    accentText: '#FF8088',
    accentSoft: '#3A1A1E',
    sale: '#C8233A',
    success: '#4ADE80',
    successSoft: '#0F2A1A',
    warning: '#FDBA74',
    warningSoft: '#2E1D0D',
    danger: '#F87171',
    dangerSoft: '#2E1414',
    scrim: 'rgba(0,0,0,0.55)',
    overlayButton: 'rgba(24,24,27,0.92)',
    shadow: '#000000',
  },
};

/** 4-pt spacing scale. Never use raw numbers for layout spacing. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

/** Three radii only: small (badges), medium (cards, inputs, buttons), large (sheets, hero media). */
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const iconSize = { sm: 16, md: 20, lg: 24, xl: 32 } as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp → we use 44 + hitSlop). */
export const touch = 44;

/** Gutter between grid columns and screen edge inset. */
export const layout = { inset: space.lg, gutter: space.md, maxContentWidth: 520 } as const;

const ios = Platform.OS === 'ios';

/**
 * Type scale built on the platform font (SF Pro / Roboto) for a native feel.
 * Sizes follow iOS text styles; Android gets equivalent Roboto weights.
 * All styles scale with the user's text size setting.
 */
export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: ios ? -0.8 : -0.4 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: ios ? -0.6 : -0.3 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: ios ? -0.4 : -0.2 },
  title3: { fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: ios ? -0.3 : -0.1 },
  headline: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: ios ? -0.2 : 0 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  subhead: { fontSize: 14, lineHeight: 19, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  price: { fontSize: 16, lineHeight: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typography;

/** Elevation is used only for things that float above content (sheets, toasts, overlay buttons). */
export function elevation(level: 1 | 2, scheme: Scheme) {
  const opacity = scheme === 'dark' ? 0.5 : level === 1 ? 0.08 : 0.14;
  if (Platform.OS === 'web') return { boxShadow: `0 ${level * 4}px ${level * 12}px rgba(0,0,0,${opacity})` } as object;
  return { shadowColor: '#000', shadowOpacity: opacity, shadowRadius: level * 8, shadowOffset: { width: 0, height: level * 3 }, elevation: level * 3 };
}

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  pressScale: 0.97,
} as const;

// ---- Color utilities (used for generated offer art) -------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear mix of two hex colors; t = weight of `b`. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Soft "studio backdrop" + deep foreground derived from a brand color. */
export function artColors(base: string, scheme: Scheme) {
  return scheme === 'light'
    ? { backdrop: mix(base, '#FFFFFF', 0.84), floor: mix(base, '#FFFFFF', 0.7), glyph: mix(base, '#000000', 0.3) }
    : { backdrop: mix(base, '#141416', 0.78), floor: mix(base, '#141416', 0.66), glyph: mix(base, '#FFFFFF', 0.35) };
}

/** HSV saturation × value — how "colorful" a hex color reads. */
export function vividness(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : ((max - min) / max) * max;
}

/**
 * Choose the base color for generated art: the most vivid of the ad's own
 * colors, or the category color when the ad's palette is near-gray/black
 * (which would otherwise render as a dull gray slab).
 */
export function pickArtBase(candidates: string[], fallback: string): string {
  const best = candidates.reduce((a, b) => (vividness(b) > vividness(a) ? b : a), candidates[0] ?? fallback);
  return vividness(best) >= 0.3 ? best : fallback;
}
