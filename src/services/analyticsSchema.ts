/**
 * The complete list of product analytics events and the only properties each
 * may carry. Shared by the app (what it may send) and the server (what it
 * accepts). Values are short enums/buckets — never IDs, free text, search
 * queries, coordinates or anything that could identify a person.
 */
export const ANALYTICS_EVENTS = {
  app_open: ['returning', 'days_since'],
  onboarding_complete: ['interests_count', 'location_enabled'],
  search: ['results_bucket', 'has_filters'],
  category_select: ['category', 'surface'],
  offer_open: ['category', 'source'],
  offer_click: ['category', 'source'],
  offer_save: ['category'],
  offer_dismiss: ['category'],
  location_enabled: [],
  data_erased: [],
  list_create: [],
  list_share: [],
  reminders_toggle: ['enabled'],
  error: ['context'],
} as const;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps = Record<string, string | number | boolean>;

const VALUE_RE = /^[a-z0-9_:+-]{1,32}$/i;

/** Drop unknown events/properties and any value that isn't a short token, small integer or boolean. */
export function sanitizeEvent(name: unknown, props: unknown): { name: AnalyticsEvent; props: AnalyticsProps } | null {
  if (typeof name !== 'string' || !(name in ANALYTICS_EVENTS)) return null;
  const allowed = ANALYTICS_EVENTS[name as AnalyticsEvent] as readonly string[];
  const src = props && typeof props === 'object' && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
  const clean: AnalyticsProps = {};
  for (const k of allowed) {
    const v = src[k];
    if (typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000) clean[k] = v;
    else if (typeof v === 'string' && VALUE_RE.test(v)) clean[k] = v;
  }
  return { name: name as AnalyticsEvent, props: clean };
}

/** Canonical, order-independent dimension string used for aggregation ("k=v;k=v"). */
export function dimsKey(props: AnalyticsProps): string {
  return Object.keys(props)
    .sort()
    .map((k) => `${k}=${String(props[k])}`)
    .join(';');
}

/** Bucket counts so exact values can't fingerprint users. */
export function bucket(n: number): string {
  if (n === 0) return '0';
  if (n <= 5) return '1-5';
  if (n <= 20) return '6-20';
  return '21+';
}

/** Days since the previous app open, bucketed (return-visit measurement without IDs). */
export function daysSinceBucket(ms: number | undefined): string {
  if (ms === undefined) return 'first';
  const d = ms / 86_400_000;
  if (d < 1) return '0';
  if (d < 2) return '1';
  if (d < 8) return '2-7';
  if (d < 31) return '8-30';
  return '31+';
}
