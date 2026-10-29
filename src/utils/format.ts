import type { GeoPoint, Money, Offer } from '@/types/offer';

/**
 * Formatting follows the device locale. configureFormatting() is called once at
 * startup with values from expo-localization; tests and the server use defaults.
 */
const fmt = { locale: 'en-US', miles: true };

export function configureFormatting(opts: { locale?: string; miles?: boolean }): void {
  if (opts.locale) {
    try {
      new Intl.NumberFormat(opts.locale);
      fmt.locale = opts.locale;
    } catch {
      // unsupported locale tag: keep default
    }
  }
  if (typeof opts.miles === 'boolean') fmt.miles = opts.miles;
}

export function formatMoney(m: Money): string {
  const whole = Number.isInteger(m.amount);
  try {
    return new Intl.NumberFormat(fmt.locale, {
      style: 'currency',
      currency: m.currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(m.amount);
  } catch {
    return `${m.currency} ${m.amount.toFixed(whole ? 0 : 2)}`;
  }
}

/** Percentage discount (0–100), or undefined when not computable. */
export function discountPercent(o: Pick<Offer, 'price' | 'originalPrice'>): number | undefined {
  if (!o.price || !o.originalPrice) return undefined;
  if (o.price.currency !== o.originalPrice.currency) return undefined;
  if (o.originalPrice.amount <= 0 || o.price.amount >= o.originalPrice.amount) return undefined;
  return Math.round((1 - o.price.amount / o.originalPrice.amount) * 100);
}

/** Short badge text: "-35%", "2 for 1", ... */
export function dealBadge(o: Offer): string | undefined {
  const pct = discountPercent(o);
  if (pct && pct >= 5) return `-${pct}%`;
  return o.promoLabel;
}

export function isExpired(o: Pick<Offer, 'expiresAt'>, now: Date = new Date()): boolean {
  return !!o.expiresAt && new Date(o.expiresAt).getTime() <= now.getTime();
}

export function hoursLeft(o: Pick<Offer, 'expiresAt'>, now: Date = new Date()): number | undefined {
  if (!o.expiresAt) return undefined;
  return (new Date(o.expiresAt).getTime() - now.getTime()) / 3600_000;
}

/** "Ends in 5h", "Ends in 3 days", "Ends Dec 24", "Expired". */
export function expiryLabel(o: Pick<Offer, 'expiresAt'>, now: Date = new Date()): string | undefined {
  const h = hoursLeft(o, now);
  if (h === undefined) return undefined;
  if (h <= 0) return 'Expired';
  if (h < 1) return `Ends in ${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `Ends in ${Math.round(h)}h`;
  const days = Math.round(h / 24);
  if (days <= 14) return `Ends in ${days} days`;
  return `Ends ${formatDate(o.expiresAt!, { month: 'short', day: 'numeric' })}`;
}

export function isEndingSoon(o: Pick<Offer, 'expiresAt'>, now: Date = new Date()): boolean {
  const h = hoursLeft(o, now);
  return h !== undefined && h > 0 && h <= 48;
}

const R_KM = 6371;
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  try {
    return d.toLocaleString(fmt.locale, opts);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatDistance(km: number): string {
  const v = fmt.miles ? km * 0.621371 : km;
  const unit = fmt.miles ? 'mi' : 'km';
  if (v < 0.1) return 'Nearby';
  const n = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n.toLocaleString(fmt.locale)} ${unit}`;
}

export function usesMiles(): boolean {
  return fmt.miles;
}

/** True unless the offer is restricted to countries that exclude `country` (ISO alpha-2). Unknown country → shown. */
export function isAvailableIn(o: Pick<Offer, 'availability'>, country?: string): boolean {
  const list = o.availability?.countries;
  if (!list?.length || !country) return true;
  return list.includes(country.toUpperCase());
}

/** Hours since the source last confirmed the offer, or undefined if never verified. */
export function hoursSinceVerified(o: Pick<Offer, 'verifiedAt'>, now: Date = new Date()): number | undefined {
  if (!o.verifiedAt) return undefined;
  return Math.max(0, (now.getTime() - Date.parse(o.verifiedAt)) / 3600_000);
}

/** "Checked 2h ago" style label for the detail screen. */
export function verifiedLabel(o: Pick<Offer, 'verifiedAt'>, now: Date = new Date()): string | undefined {
  const h = hoursSinceVerified(o, now);
  if (h === undefined) return undefined;
  if (h < 1) return 'Checked less than an hour ago';
  if (h < 48) return `Checked ${Math.round(h)}h ago`;
  return `Checked ${Math.round(h / 24)} days ago`;
}

/** Offers not re-confirmed for 3+ days may have changed: we say so instead of presenting them as current. */
export const STALE_VERIFICATION_HOURS = 72;
