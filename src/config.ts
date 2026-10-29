/**
 * Build-time configuration. Everything here is PUBLIC: EXPO_PUBLIC_* values are
 * inlined into the app bundle and can be read by anyone who downloads the app.
 * Never put secrets (affiliate API keys, admin tokens) in EXPO_PUBLIC_* vars —
 * those belong on the server (see server/README.md).
 */
import { isSafeHttpsUrl } from '@/services/urlSafety';

export type AppEnv = 'development' | 'staging' | 'production';

export interface AppConfig {
  env: AppEnv;
  /** Fictional demo catalog. Never enabled in production builds. */
  demoCatalog: boolean;
  /** Only Ads API base URL (no trailing slash), or undefined when not configured. */
  apiUrl?: string;
  supportEmail?: string;
  /** Human-readable problems with the configuration (shown in Profile → Diagnostics). */
  warnings: string[];
}

export interface RawEnv {
  APP_ENV?: string;
  OFFERS_API_URL?: string;
  SUPPORT_EMAIL?: string;
  isDevBuild: boolean;
}

export function resolveConfig(raw: RawEnv): AppConfig {
  const warnings: string[] = [];
  let env: AppEnv;
  if (raw.APP_ENV === 'development' || raw.APP_ENV === 'staging' || raw.APP_ENV === 'production') env = raw.APP_ENV;
  else {
    // Unset/unknown → safest assumption for release binaries is production.
    env = raw.isDevBuild ? 'development' : 'production';
    if (raw.APP_ENV) warnings.push(`Unknown EXPO_PUBLIC_APP_ENV "${raw.APP_ENV}", using ${env}.`);
  }

  let apiUrl = raw.OFFERS_API_URL?.trim().replace(/\/+$/, '') || undefined;
  if (apiUrl) {
    // Plain http is only acceptable against a local dev server.
    const localDev = env !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(apiUrl);
    if (!localDev && !isSafeHttpsUrl(apiUrl, { allowPort: true })) {
      warnings.push('EXPO_PUBLIC_OFFERS_API_URL must be an https URL; the offers API is disabled.');
      apiUrl = undefined;
    }
  } else if (env === 'production') {
    warnings.push('No offers API configured: the production app will have no offers.');
  }

  const supportEmail = raw.SUPPORT_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.SUPPORT_EMAIL) ? raw.SUPPORT_EMAIL : undefined;

  return { env, demoCatalog: env !== 'production', apiUrl, supportEmail, warnings };
}

// Each EXPO_PUBLIC_* var must be referenced literally so Expo can inline it.
export const config: AppConfig = resolveConfig({
  APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  OFFERS_API_URL: process.env.EXPO_PUBLIC_OFFERS_API_URL,
  SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  isDevBuild: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
});
