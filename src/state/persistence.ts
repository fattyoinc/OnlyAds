/**
 * Versioned on-device storage. Everything persisted is non-sensitive preference
 * data (no tokens, no account data), so AsyncStorage is appropriate; if accounts
 * are ever added, tokens must go to expo-secure-store instead.
 *
 * Rules: bump SCHEMA_VERSION when the shape changes and add a step to migrate().
 * load() never throws — corrupt or unknown data falls back to safe defaults.
 */
import { CATEGORIES } from '@/data/categories';
import { EMPTY_PROFILE, type UserProfile } from '@/services/ranking';
import { validateOffer } from '@/services/offerValidation';
import type { CategoryId, GeoPoint, Offer } from '@/types/offer';

export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'onlyads:state';
/** v1 (MVP) key, read once for migration. */
export const LEGACY_KEY_V1 = 'onlyads:v1';

export const LIMITS = {
  saved: 200,
  hiddenOffers: 500,
  mutedAdvertisers: 200,
  tagAffinity: 300,
  advertiserAffinity: 300,
  recentSearches: 8,
  lists: 20,
  listName: 40,
};

/** A named shopping list. Items must be saved offers (removing a save removes it from lists). */
export interface ShoppingList {
  id: string;
  name: string;
  offerIds: string[];
}

export interface Persisted {
  schemaVersion: number;
  onboarded: boolean;
  profile: UserProfile;
  saved: Record<string, Offer>;
  savedOrder: string[];
  recentSearches: string[];
  locationEnabled: boolean;
  /** Anonymous, aggregate usage statistics (no identifiers). User can turn off anytime. */
  analyticsConsent: boolean;
  /** Previous app open (ms epoch) — only used locally to compute a "days since" bucket. */
  lastOpenAt?: number;
  lists: ShoppingList[];
  /** Local "ending soon" notifications for saved offers (opt-in). */
  remindersEnabled: boolean;
}

export const INITIAL: Persisted = {
  schemaVersion: SCHEMA_VERSION,
  onboarded: false,
  profile: EMPTY_PROFILE,
  saved: {},
  savedOrder: [],
  recentSearches: [],
  locationEnabled: false,
  analyticsConsent: true,
  lists: [],
  remindersEnabled: false,
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

const strArray = (x: unknown, max: number, maxLen = 200): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= maxLen))].slice(0, max) : [];

/** Keep the `max` entries with the largest absolute weight. */
function weights(x: unknown, max: number, keyOk: (k: string) => boolean = () => true): Record<string, number> {
  if (!isObj(x)) return {};
  const entries = Object.entries(x).filter(([k, v]) => keyOk(k) && k.length <= 64 && typeof v === 'number' && Number.isFinite(v) && v !== 0) as [string, number][];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return Object.fromEntries(entries.slice(0, max).map(([k, v]) => [k, Math.max(-10, Math.min(50, v))]));
}

function geo(x: unknown): GeoPoint | undefined {
  if (!isObj(x) || typeof x.lat !== 'number' || typeof x.lng !== 'number') return undefined;
  if (Math.abs(x.lat) > 90 || Math.abs(x.lng) > 180) return undefined;
  // Re-round on load: never keep more precision than ~1 km.
  return { lat: Math.round(x.lat * 100) / 100, lng: Math.round(x.lng * 100) / 100 };
}

export function sanitizeProfile(x: unknown): UserProfile {
  if (!isObj(x)) return EMPTY_PROFILE;
  return {
    interests: strArray(x.interests, CATEGORIES.length).filter((c) => CATEGORY_IDS.has(c)) as CategoryId[],
    categoryAffinity: weights(x.categoryAffinity, CATEGORIES.length, (k) => CATEGORY_IDS.has(k)),
    tagAffinity: weights(x.tagAffinity, LIMITS.tagAffinity),
    advertiserAffinity: weights(x.advertiserAffinity, LIMITS.advertiserAffinity),
    // Most recent last → keep the tail when trimming.
    hiddenOfferIds: strArray(x.hiddenOfferIds, Number.MAX_SAFE_INTEGER).slice(-LIMITS.hiddenOffers),
    mutedAdvertiserIds: strArray(x.mutedAdvertiserIds, LIMITS.mutedAdvertisers),
    location: geo(x.location),
  };
}

/** Upgrade any older shape to the current one. Pure; unit-tested. */
export function migrate(raw: unknown): Obj {
  if (!isObj(raw)) return {};
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  let data: Obj = { ...raw };
  if (v < 2) {
    // v1 (MVP) had no version marker but the same fields. Saved snapshots are
    // re-validated below like everything else.
    data = { ...data, schemaVersion: 2 };
  }
  if (v < 3) {
    // v3 added shopping lists and reminders; both default to empty/off.
    data = { ...data, schemaVersion: 3 };
  }
  return data;
}

export function sanitize(raw: unknown, now: Date = new Date()): Persisted {
  const d = migrate(raw);
  const saved: Record<string, Offer> = {};
  const savedOrder: string[] = [];
  const savedIn = isObj(d.saved) ? d.saved : {};
  for (const id of strArray(d.savedOrder, LIMITS.saved)) {
    const snap = savedIn[id];
    // Demo offers are re-validated too; they carry source "sample" which the network validator
    // rejects, so they are restored only if the snapshot is otherwise well-formed.
    const isSample = isObj(snap) && snap.source === 'sample';
    const o = isSample ? validateOffer({ ...snap, source: 'direct' }, now) : validateOffer(snap, now);
    if (o) {
      saved[id] = isSample ? { ...o, source: 'sample', demo: true } : o;
      savedOrder.push(id);
    }
  }
  const profile = sanitizeProfile(d.profile);
  const locationEnabled = d.locationEnabled === true && !!profile.location;
  return {
    schemaVersion: SCHEMA_VERSION,
    onboarded: d.onboarded === true,
    profile: locationEnabled ? profile : { ...profile, location: undefined },
    saved,
    savedOrder,
    recentSearches: strArray(d.recentSearches, LIMITS.recentSearches, 100),
    locationEnabled,
    analyticsConsent: d.analyticsConsent !== false,
    lists: sanitizeLists(d.lists, new Set(savedOrder)),
    remindersEnabled: d.remindersEnabled === true,
    lastOpenAt: typeof d.lastOpenAt === 'number' && Number.isFinite(d.lastOpenAt) && d.lastOpenAt <= now.getTime() ? d.lastOpenAt : undefined,
  };
}

export function sanitizeLists(x: unknown, savedIds: Set<string>): ShoppingList[] {
  if (!Array.isArray(x)) return [];
  const out: ShoppingList[] = [];
  const ids = new Set<string>();
  for (const l of x) {
    if (!isObj(l) || typeof l.id !== 'string' || !/^[a-z0-9]{1,24}$/.test(l.id) || ids.has(l.id)) continue;
    const name = typeof l.name === 'string' ? l.name.replace(/\s+/g, ' ').trim().slice(0, LIMITS.listName) : '';
    if (!name) continue;
    ids.add(l.id);
    out.push({ id: l.id, name, offerIds: strArray(l.offerIds, LIMITS.saved).filter((id) => savedIds.has(id)) });
    if (out.length >= LIMITS.lists) break;
  }
  return out;
}

/** Parse stored JSON safely. */
export function decode(json: string | null, now?: Date): Persisted | null {
  if (!json) return null;
  try {
    return sanitize(JSON.parse(json), now);
  } catch {
    return null;
  }
}
