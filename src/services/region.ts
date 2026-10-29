import { getLocales } from 'expo-localization';

/**
 * The device's region setting (e.g. "US"), used only to hide offers that can't
 * be redeemed in the user's country. This is a coarse user preference, not a
 * location, and requires no permission.
 */
export function deviceRegion(): string | undefined {
  try {
    const r = getLocales()[0]?.regionCode;
    return r && /^[A-Za-z]{2}$/.test(r) ? r.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}
