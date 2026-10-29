/**
 * Parser for advertiser product feeds in the Google Merchant Center product
 * data specification (TSV/CSV with attribute headers). Meta Commerce catalogs
 * use the same core attribute names (id, title, description, availability,
 * price, sale_price, sale_price_effective_date, link, image_link, brand), so
 * one parser covers both. Feeds are supplied by participating advertisers — we
 * never scrape or read a user's ad profile.
 */
import type { CategoryId, Money, Offer } from '@/types/offer';
import { CATEGORIES } from '@/data/categories';

export type FeedRow = Record<string, string>;

/** RFC 4180-ish CSV/TSV parser with quoted fields, escaped quotes and CRLF. */
export function parseDelimited(text: string, delimiter?: string): FeedRow[] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delim = delimiter ?? (firstLine.includes('\t') ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/^g:/, ''));
  return nonEmpty.slice(1).map((r) => {
    const o: FeedRow = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? '').trim()));
    return o;
  });
}

/** "15.00 USD" | "USD 15.00" | "15 usd" → Money */
export function parsePrice(s: string | undefined): Money | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^(?:([A-Za-z]{3})\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]{3})?$/);
  if (!m) return undefined;
  const currency = (m[1] ?? m[3] ?? '').toUpperCase();
  const amount = Number(m[2].replace(/,/g, ''));
  if (!currency || !Number.isFinite(amount)) return undefined;
  return { amount, currency };
}

/** "2026-11-01T00:00-0800/2026-11-30T23:59-0800" → [start, end] ISO strings. */
export function parseEffectiveDate(s: string | undefined): [string | undefined, string | undefined] {
  if (!s) return [undefined, undefined];
  const toIso = (p: string | undefined) => {
    if (!p) return undefined;
    // Normalize "-0800" offset to "-08:00" for Date parsing.
    const fixed = p.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const d = new Date(fixed);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const [a, b] = s.split('/');
  return [toIso(a), toIso(b)];
}

const KEYWORDS: [CategoryId, RegExp][] = [
  ['sneakers', /sneaker|athletic shoe|running shoe|trainer/i],
  ['beauty', /beauty|cosmetic|skin care|makeup|fragrance|perfume/i],
  ['fashion', /apparel|clothing|jewelry|handbag|accessor|shoe/i],
  ['tech', /electronic|computer|phone|audio|camera|video game console/i],
  ['home', /home|garden|furniture|kitchen|bedding|decor/i],
  ['fitness', /sporting|fitness|exercise|yoga/i],
  ['kids', /toy|baby|toddler|kids/i],
  ['grocery', /food|beverage|grocery|snack/i],
  ['travel', /luggage|travel/i],
  ['entertainment', /media|book|movie|music|game/i],
];

export function mapCategory(row: FeedRow): CategoryId {
  const custom = (row['custom_label_0'] ?? '').toLowerCase();
  const direct = CATEGORIES.find((c) => c.id === custom);
  if (direct) return direct.id;
  const text = `${row['google_product_category'] ?? ''} ${row['product_type'] ?? ''} ${row['fb_product_category'] ?? ''}`;
  for (const [id, re] of KEYWORDS) if (re.test(text)) return id;
  return 'gifts';
}

export interface FeedMeta {
  feedId: string;
  advertiserName: string;
  verified?: boolean;
  sponsored?: boolean;
  affiliate?: boolean;
  demo?: boolean;
}

const PALETTE: [string, string][] = [
  ['#2B5876', '#4E4376'],
  ['#C31432', '#F0A500'],
  ['#11998E', '#38EF7D'],
  ['#8E2DE2', '#F15BB5'],
];

/** Map feed rows to Offers. Rows that are out of stock or invalid are skipped. */
export function feedRowsToOffers(rows: FeedRow[], meta: FeedMeta, now: Date = new Date()): Offer[] {
  const out: Offer[] = [];
  for (const r of rows) {
    if (!r.id || !r.title || !r.link) continue;
    if (r.availability && !/in[ _]stock|preorder|backorder/i.test(r.availability)) continue;
    if (!/^https:\/\//.test(r.link)) continue;
    const regular = parsePrice(r.price);
    let sale = parsePrice(r.sale_price);
    const [saleStart, saleEnd] = parseEffectiveDate(r.sale_price_effective_date);
    // A sale outside its effective window is not active.
    if (sale && ((saleStart && new Date(saleStart) > now) || (saleEnd && new Date(saleEnd) <= now))) sale = undefined;
    const category = mapCategory(r);
    const cat = CATEGORIES.find((c) => c.id === category)!;
    const pal = PALETTE[out.length % PALETTE.length];
    out.push({
      id: `${meta.feedId}-${r.id}`,
      source: meta.affiliate ? 'affiliate' : 'merchant_feed',
      kind: 'product',
      category,
      title: r.title,
      description: r.description || r.title,
      advertiser: { id: meta.feedId, name: r.brand || meta.advertiserName, verified: !!meta.verified },
      imageUrl: /^https:\/\//.test(r.image_link ?? '') ? r.image_link : undefined,
      creative: { colors: cat?.colors ?? pal, icon: cat?.icon ?? 'tag-outline' },
      price: sale ?? regular,
      originalPrice: sale ? regular : undefined,
      startsAt: sale ? saleStart : undefined,
      expiresAt: sale ? saleEnd : undefined,
      ctaLabel: 'Shop now',
      url: r.link,
      tags: [r.product_type, r.brand, r.color, r.custom_label_1]
        .filter(Boolean)
        .flatMap((t) => t!.split('>').map((x) => x.trim().toLowerCase()))
        .filter(Boolean),
      sponsored: !!meta.sponsored,
      affiliate: !!meta.affiliate,
      demo: meta.demo || undefined,
      createdAt: now.toISOString(),
    });
  }
  return out;
}
