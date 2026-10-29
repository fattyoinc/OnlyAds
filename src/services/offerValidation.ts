/**
 * Strict, field-by-field validation of offers that cross a trust boundary
 * (server → app, advertiser feed → server). Unknown fields are dropped; nothing
 * from the payload is spread into the result. Shared by app and server.
 */
import { CATEGORIES } from '@/data/categories';
import type { CategoryId, Money, Offer, OfferKind, OfferSource } from '@/types/offer';
import { isSafeHttpsUrl } from './urlSafety';

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const KINDS = new Set<OfferKind>(['product', 'deal', 'local', 'service', 'experience']);
const SOURCES = new Set<OfferSource>(['merchant_feed', 'affiliate', 'direct']);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

/** Trimmed string within bounds, with control characters removed. */
export function cleanText(x: unknown, max: number): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export function cleanMoney(x: unknown): Money | undefined {
  if (!isObj(x)) return undefined;
  const amount = x.amount;
  const currency = x.currency;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return undefined;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return undefined;
  return { amount: Math.round(amount * 100) / 100, currency };
}

export function cleanIsoDate(x: unknown): string | undefined {
  if (typeof x !== 'string' || x.length > 40) return undefined;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_RE = /^[a-z0-9-]{1,48}$/;

/**
 * Returns a safe Offer, or undefined when required fields are missing/invalid.
 * `sample` is never accepted from the network.
 */
export function validateOffer(x: unknown, now: Date = new Date()): Offer | undefined {
  if (!isObj(x)) return undefined;
  const id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : undefined;
  const title = cleanText(x.title, 140);
  const url = isSafeHttpsUrl(x.url) ? x.url : undefined;
  const category = typeof x.category === 'string' && CATEGORY_IDS.has(x.category) ? (x.category as CategoryId) : undefined;
  if (!id || !title || !url || !category) return undefined;

  const adv = isObj(x.advertiser) ? x.advertiser : undefined;
  const advName = cleanText(adv?.name, 80);
  const advId = typeof adv?.id === 'string' && ID_RE.test(adv.id) ? adv.id : undefined;
  if (!advName || !advId) return undefined;

  const cat = CATEGORIES.find((c) => c.id === category)!;
  const cr = isObj(x.creative) ? x.creative : {};
  const colors = Array.isArray(cr.colors) && cr.colors.length === 2 && cr.colors.every((c) => typeof c === 'string' && HEX_RE.test(c)) ? (cr.colors as [string, string]) : cat.colors;
  const icon = typeof cr.icon === 'string' && ICON_RE.test(cr.icon) ? cr.icon : cat.icon;

  let price = cleanMoney(x.price);
  let originalPrice = cleanMoney(x.originalPrice);
  // A "was" price is only meaningful with a lower current price in the same currency.
  if (!price || !originalPrice || originalPrice.currency !== price.currency || originalPrice.amount <= price.amount) originalPrice = undefined;
  if (!price) originalPrice = undefined;
  if (price && price.amount === 0 && !originalPrice) price = undefined;

  const expiresAt = cleanIsoDate(x.expiresAt);
  const startsAt = cleanIsoDate(x.startsAt);

  let location: Offer['location'];
  if (isObj(x.location)) {
    const { lat, lng } = x.location;
    const address = cleanText(x.location.address, 160);
    const placeName = cleanText(x.location.placeName, 80);
    if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && address && placeName) {
      location = { lat, lng, address, placeName };
    }
  }

  const tags = Array.isArray(x.tags)
    ? [...new Set(x.tags.map((t) => cleanText(t, 32)?.toLowerCase()).filter((t): t is string => !!t))].slice(0, 15)
    : [];

  const promoCode = typeof x.promoCode === 'string' && /^[A-Za-z0-9_-]{2,32}$/.test(x.promoCode) ? x.promoCode : undefined;
  const rating = typeof x.rating === 'number' && x.rating >= 0 && x.rating <= 5 ? Math.round(x.rating * 10) / 10 : undefined;
  const popularity = typeof x.popularity === 'number' && x.popularity >= 0 && x.popularity <= 1 ? Math.round(x.popularity * 100) / 100 : undefined;
  const clickUrl = isSafeHttpsUrl(x.clickUrl, { allowPort: true }) ? x.clickUrl : undefined;

  let availability: Offer['availability'];
  if (isObj(x.availability)) {
    const countries = Array.isArray(x.availability.countries)
      ? [...new Set(x.availability.countries.filter((c): c is string => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)).map((c) => c.toUpperCase()))].slice(0, 60)
      : undefined;
    const online = typeof x.availability.online === 'boolean' ? x.availability.online : undefined;
    if (countries?.length || online !== undefined) availability = { ...(countries?.length ? { countries } : null), ...(online !== undefined ? { online } : null) };
  }

  let campaign: Offer['campaign'];
  if (isObj(x.campaign)) {
    const cid = typeof x.campaign.id === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(x.campaign.id) ? x.campaign.id : undefined;
    const network = typeof x.campaign.network === 'string' && /^[a-z0-9-]{1,32}$/.test(x.campaign.network) ? x.campaign.network : undefined;
    if (cid || network) campaign = { ...(cid ? { id: cid } : null), ...(network ? { network } : null) };
  }

  // A verification time in the future is a clock/feed error: ignore it.
  let verifiedAt = cleanIsoDate(x.verifiedAt);
  if (verifiedAt && Date.parse(verifiedAt) > now.getTime() + 5 * 60_000) verifiedAt = undefined;

  return {
    id,
    source: typeof x.source === 'string' && SOURCES.has(x.source as OfferSource) ? (x.source as OfferSource) : 'direct',
    kind: typeof x.kind === 'string' && KINDS.has(x.kind as OfferKind) ? (x.kind as OfferKind) : location ? 'local' : 'product',
    category,
    title,
    subtitle: cleanText(x.subtitle, 120),
    description: cleanText(x.description, 1500) ?? title,
    advertiser: { id: advId, name: advName, verified: adv?.verified === true },
    imageUrl: isSafeHttpsUrl(x.imageUrl) ? x.imageUrl : undefined,
    creative: { colors, icon },
    price,
    originalPrice,
    promoLabel: cleanText(x.promoLabel, 32),
    promoCode,
    startsAt,
    expiresAt,
    ctaLabel: cleanText(x.ctaLabel, 20) ?? 'View offer',
    url,
    clickUrl,
    tags,
    location,
    sponsored: x.sponsored === true,
    affiliate: x.affiliate === true,
    demo: x.demo === true,
    rating,
    createdAt: cleanIsoDate(x.createdAt) ?? now.toISOString(),
    availability,
    verifiedAt,
    campaign,
    popularity,
  };
}
