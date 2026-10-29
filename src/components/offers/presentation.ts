/**
 * Pure presentation rules for offers — what a card is allowed to say.
 * Rule of thumb: never show a claim the data can't back up.
 */
import type { Offer, OfferKind } from '@/types/offer';
import { discountPercent, expiryLabel, formatMoney, hoursLeft } from '@/utils/format';

/** Image aspect (height / width) per ad format: products are portrait, places square, trips landscape-ish. */
export const ASPECT: Record<OfferKind, number> = {
  product: 1.25,
  deal: 1,
  local: 1,
  service: 0.85,
  experience: 1.1,
};

export function aspectFor(o: Offer): number {
  return ASPECT[o.kind] ?? 1;
}

/**
 * Discount badge text — only when computed from a real price and a higher
 * previous price in the same currency (a "verified" discount), and ≥ 5%.
 */
export function verifiedDiscount(o: Offer): string | undefined {
  const pct = discountPercent(o);
  return pct && pct >= 5 ? `−${pct}%` : undefined;
}

/** Urgency is shown only when an expiry date exists and is within 48 hours. */
export function urgencyLabel(o: Offer, now: Date): string | undefined {
  const h = hoursLeft(o, now);
  if (h === undefined || h <= 0 || h > 48) return undefined;
  if (h < 1) return 'Ends in <1h';
  return h < 24 ? `Ends in ${Math.round(h)}h` : 'Ends tomorrow';
}

export function isUnavailable(o: Offer, now: Date): boolean {
  const h = hoursLeft(o, now);
  return h !== undefined && h <= 0;
}

/** Secondary line under the title. Paid placement is always named. */
export function metaParts(o: Offer, distance?: string): string[] {
  const parts = [o.advertiser.name];
  if (distance) parts.push(distance);
  return parts;
}

export function disclosureText(o: Offer): string | undefined {
  const parts: string[] = [];
  if (o.sponsored) parts.push('Sponsored');
  if (o.source === 'sample' || o.demo) parts.push('Demo');
  return parts.length ? parts.join(' · ') : undefined;
}

/** Full sentence for screen readers, in the visual hierarchy order. */
export function offerA11yLabel(o: Offer, now: Date, distance?: string): string {
  const parts = [o.title];
  const d = verifiedDiscount(o);
  if (o.price) parts.push(o.originalPrice ? `${formatMoney(o.price)}, was ${formatMoney(o.originalPrice)}` : formatMoney(o.price));
  else if (o.promoLabel) parts.push(o.promoLabel);
  if (d) parts.push(`${d.replace('−', '')} off`);
  parts.push(`from ${o.advertiser.name}`);
  if (distance) parts.push(`${distance} away`);
  const exp = expiryLabel(o, now);
  if (exp) parts.push(exp);
  if (o.sponsored) parts.push('Sponsored');
  if (o.affiliate) parts.push('Affiliate link');
  if (o.source === 'sample' || o.demo) parts.push('Demo offer');
  return parts.join('. ');
}
