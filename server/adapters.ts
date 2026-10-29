/**
 * Feed adapters: one per source format. Adding an authorized affiliate network
 * or merchant catalog = adding an adapter here (and its credentials as an
 * environment variable). Adapters only *parse*; validation, content policy,
 * dedupe, expiry and storage are shared (server/ingest.ts).
 *
 * Not implemented on purpose: API clients for specific networks (CJ, Impact,
 * Awin, Rakuten…) — they require publisher approval and their API terms must
 * be reviewed first. Their product *exports* (CSV) work today via `csv_mapped`
 * with an operator-written column mapping; partners can also push offers
 * through the documented `offers_json_api` format.
 */
import { CATEGORIES } from '@/data/categories';
import { feedRowsToOffers, mapCategory, parseDelimited, type FeedRow } from '@/services/providers/productFeed';
import type { CategoryId } from '@/types/offer';

export interface AdapterAdvertiser {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'suspended';
  sponsored: boolean;
  affiliate: boolean;
  isDemo: boolean;
  network?: string;
}

export interface AdapterContext {
  feedId: string;
  advertiser: AdapterAdvertiser;
  now: Date;
  /** Per-feed configuration (feeds.mapping), already checked by validateMapping. */
  mapping?: FeedMapping;
  /** Set only when the advertiser proved control of this domain (server/verify.ts). */
  verifiedDomain?: string;
}

/**
 * Operator-written feed configuration. `columns` maps our field → the source's
 * column header (csv_mapped). `categories` maps the source's category/product
 * type text → one of our category ids.
 */
export interface FeedMapping {
  columns?: Partial<Record<MappedField, string>>;
  currency?: string;
  categories?: Record<string, CategoryId>;
  defaultCategory?: CategoryId;
}

const MAPPED_FIELDS = ['id', 'title', 'link', 'price', 'sale_price', 'sale_price_effective_date', 'image_link', 'description', 'brand', 'availability', 'product_type', 'category', 'country'] as const;
type MappedField = (typeof MAPPED_FIELDS)[number];
const REQUIRED_COLUMNS: MappedField[] = ['id', 'title', 'link', 'price'];
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

/** Throws a readable error for a bad mapping. Used by the CLI (feed:add) and again at ingest. */
export function validateMapping(kind: string, raw: unknown): FeedMapping | undefined {
  const needs = kind === 'csv_mapped' || kind === 'shopify_products_json';
  if (raw === undefined || raw === null) {
    if (needs) throw new Error(`feed kind ${kind} needs a mapping (see docs/INTEGRATIONS.md)`);
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('mapping must be a JSON object');
  const m = raw as Record<string, unknown>;
  for (const k of Object.keys(m)) if (!['columns', 'currency', 'categories', 'defaultCategory'].includes(k)) throw new Error(`unknown mapping key "${k}"`);
  const out: FeedMapping = {};
  if (m.columns !== undefined) {
    if (typeof m.columns !== 'object' || m.columns === null) throw new Error('mapping.columns must be an object');
    out.columns = {};
    for (const [field, col] of Object.entries(m.columns)) {
      if (!(MAPPED_FIELDS as readonly string[]).includes(field)) throw new Error(`unknown field "${field}" in mapping.columns`);
      if (typeof col !== 'string' || !col.trim() || col.length > 64) throw new Error(`mapping.columns.${field} must be a column name`);
      out.columns[field as MappedField] = col.trim().toLowerCase().replace(/^g:/, '');
    }
  }
  if (kind === 'csv_mapped') for (const f of REQUIRED_COLUMNS) if (!out.columns?.[f]) throw new Error(`mapping.columns.${f} is required`);
  if (m.currency !== undefined) {
    if (typeof m.currency !== 'string' || !/^[A-Z]{3}$/.test(m.currency)) throw new Error('mapping.currency must be an ISO code like USD');
    out.currency = m.currency;
  }
  if (kind === 'shopify_products_json' && !out.currency) throw new Error('mapping.currency is required: Shopify product JSON has no currency');
  if (m.categories !== undefined) {
    if (typeof m.categories !== 'object' || m.categories === null) throw new Error('mapping.categories must be an object');
    out.categories = {};
    for (const [k, v] of Object.entries(m.categories)) {
      if (typeof v !== 'string' || !CATEGORY_IDS.has(v)) throw new Error(`mapping.categories["${k}"] must be one of: ${[...CATEGORY_IDS].join(', ')}`);
      out.categories[k.trim().toLowerCase()] = v as CategoryId;
    }
  }
  if (m.defaultCategory !== undefined) {
    if (typeof m.defaultCategory !== 'string' || !CATEGORY_IDS.has(m.defaultCategory)) throw new Error('mapping.defaultCategory must be a category id');
    out.defaultCategory = m.defaultCategory as CategoryId;
  }
  return out;
}

/** Our category for a row: explicit mapping → keywords → default → gifts. */
function resolveCategory(text: string, productType: string, m: FeedMapping | undefined): CategoryId {
  const key = text.trim().toLowerCase();
  const explicit = m?.categories?.[key] ?? m?.categories?.[productType.trim().toLowerCase()];
  if (explicit) return explicit;
  if (CATEGORY_IDS.has(key)) return key as CategoryId;
  const guessed = mapCategory({ product_type: `${text} ${productType}` });
  return guessed === 'gifts' && m?.defaultCategory ? m.defaultCategory : guessed;
}

/** A price cell without a currency gets the mapping's currency. */
function withCurrency(v: string | undefined, currency: string | undefined): string | undefined {
  if (!v) return v;
  return /[A-Za-z]{3}/.test(v) || !currency ? v : `${v} ${currency}`;
}

/** Canonical (Merchant Center-style) rows → candidates, sharing one code path for every row-based adapter. */
function rowsToCandidates(rows: FeedRow[], ctx: AdapterContext): unknown[] {
  const a = ctx.advertiser;
  const offers = feedRowsToOffers(rows, { feedId: ctx.feedId, advertiserName: a.name, verified: a.status === 'active', sponsored: a.sponsored, affiliate: a.affiliate, demo: a.isDemo }, ctx.now);
  const byId = new Map(rows.map((r) => [`${ctx.feedId}-${r.id}`, r]));
  return offers.map((o) => {
    const countries = (byId.get(o.id)?.country ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    return {
      ...o,
      advertiser: { ...o.advertiser, id: a.id },
      availability: countries.length ? { countries, online: true } : { online: true },
      campaign: a.network ? { network: a.network } : undefined,
    };
  });
}

/** Column-mapped CSV/TSV (affiliate network product exports, merchant spreadsheets). */
function parseMappedCsv(text: string, ctx: AdapterContext): unknown[] {
  const cols = ctx.mapping?.columns ?? {};
  const rows = parseDelimited(text);
  if (rows.length) {
    const header = new Set(Object.keys(rows[0]));
    const missing = Object.values(cols).filter((c) => !header.has(c!));
    // A renamed column usually means the network changed its export: fail loudly rather than ingest garbage.
    if (missing.length) throw new Error(`feed is missing mapped column(s): ${missing.join(', ')}`);
  }
  const get = (r: FeedRow, f: MappedField) => (cols[f] ? r[cols[f]!] ?? '' : '');
  return rowsToCandidates(
    rows.map((r) => {
      const productType = get(r, 'product_type');
      const regular = withCurrency(get(r, 'price'), ctx.mapping?.currency);
      const sale = withCurrency(get(r, 'sale_price'), ctx.mapping?.currency);
      return {
        id: get(r, 'id'),
        title: get(r, 'title'),
        link: get(r, 'link'),
        price: regular ?? '',
        // Some exports put the *current* price in "price" and the old one elsewhere; a "sale" that isn't lower is ignored downstream.
        sale_price: sale ?? '',
        sale_price_effective_date: get(r, 'sale_price_effective_date'),
        image_link: get(r, 'image_link'),
        description: get(r, 'description'),
        brand: get(r, 'brand'),
        availability: get(r, 'availability'),
        product_type: productType,
        custom_label_0: resolveCategory(get(r, 'category'), productType, ctx.mapping),
        country: get(r, 'country'),
      };
    }),
    ctx,
  );
}

const stripHtml = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '');

/**
 * A Shopify store's own public catalog (`/products.json`). Only for merchants who
 * verified they own the domain — pulling another store's catalog without
 * permission would be scraping. Prices come without currency, so the mapping sets it.
 */
function parseShopifyProducts(text: string, ctx: AdapterContext): unknown[] {
  const domain = ctx.verifiedDomain;
  if (!domain) throw new Error('shopify_products_json requires a verified merchant domain');
  const body = JSON.parse(text) as { products?: unknown[] };
  if (!body || !Array.isArray(body.products)) throw new Error('expected a Shopify products.json body ({"products": [...]})');
  const rows: FeedRow[] = [];
  for (const raw of body.products) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const handle = typeof p.handle === 'string' && /^[a-z0-9][a-z0-9-]{0,200}$/i.test(p.handle) ? p.handle : undefined;
    const variants = (Array.isArray(p.variants) ? p.variants : []) as Record<string, unknown>[];
    const buyable = variants.filter((v) => v && v.available !== false && Number.isFinite(Number(v.price)) && Number(v.price) > 0);
    if (!handle || (p.id === undefined) || !buyable.length) continue;
    const v = buyable.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
    const price = Number(v.price);
    const compare = Number(v.compare_at_price);
    const onSale = Number.isFinite(compare) && compare > price;
    const productType = typeof p.product_type === 'string' ? p.product_type : '';
    const image = Array.isArray(p.images) ? (p.images[0] as { src?: unknown } | undefined)?.src : undefined;
    const tags = Array.isArray(p.tags) ? p.tags.join(',') : typeof p.tags === 'string' ? p.tags : '';
    rows.push({
      id: String(p.id),
      title: typeof p.title === 'string' ? p.title : '',
      link: `https://${domain}/products/${handle}`,
      price: `${onSale ? compare : price} ${ctx.mapping!.currency}`,
      sale_price: onSale ? `${price} ${ctx.mapping!.currency}` : '',
      image_link: typeof image === 'string' ? image : '',
      description: stripHtml(p.body_html).slice(0, 600),
      brand: typeof p.vendor === 'string' ? p.vendor : '',
      product_type: productType,
      custom_label_0: resolveCategory(tags.split(',')[0] ?? '', productType, ctx.mapping),
      custom_label_1: '',
    });
  }
  return rowsToCandidates(rows, ctx);
}

export interface FeedAdapter {
  kind: string;
  /** Sources must be https (remote) for this kind; local files are only for dev seeding. */
  remoteOnly: boolean;
  /** The source must be on a domain the advertiser has verified (checked before anything is fetched). */
  requiresVerifiedDomain?: boolean;
  /** Returns unvalidated candidates; ingest validates each one. */
  parse(text: string, ctx: AdapterContext): unknown[];
}

/** Fields an advertiser can't set for itself: identity and disclosure come from our records. */
function stamp(raw: Record<string, unknown>, ctx: AdapterContext): Record<string, unknown> {
  const a = ctx.advertiser;
  const campaign = (raw.campaign && typeof raw.campaign === 'object' ? raw.campaign : {}) as Record<string, unknown>;
  return {
    ...raw,
    id: `${ctx.feedId}-${String(raw.id ?? '')}`,
    advertiser: { id: a.id, name: a.name, verified: a.status === 'active' },
    sponsored: a.sponsored,
    affiliate: a.affiliate,
    demo: a.isDemo,
    source: a.affiliate ? 'affiliate' : raw.source === 'merchant_feed' ? 'merchant_feed' : 'direct',
    campaign: { ...campaign, network: a.network ?? campaign.network },
    // Computed by us at serving time from aggregate counts; a feed can't claim it.
    popularity: undefined,
    verifiedAt: undefined,
  };
}

function parseOffersJson(text: string, ctx: AdapterContext): unknown[] {
  const body = JSON.parse(text) as { offers?: unknown[] };
  if (!body || !Array.isArray(body.offers)) throw new Error('feed must be a JSON object with an "offers" array');
  return body.offers.map((r) => stamp((r ?? {}) as Record<string, unknown>, ctx));
}

export const ADAPTERS: Record<string, FeedAdapter> = {
  /** Google Merchant Center / Meta catalog TSV or CSV. Optional `country` column (comma-separated ISO codes). */
  merchant_tsv: {
    kind: 'merchant_tsv',
    remoteOnly: false,
    parse: (text, ctx) => rowsToCandidates(parseDelimited(text), ctx),
  },
  /** Offers in our documented JSON schema, from a file an advertiser uploads (dev/seed) or a URL. */
  direct_json: { kind: 'direct_json', remoteOnly: false, parse: parseOffersJson },
  /** Same schema, fetched from a partner's authenticated HTTPS endpoint (Bearer token from FEED_TOKEN_*). */
  offers_json_api: { kind: 'offers_json_api', remoteOnly: true, parse: parseOffersJson },
  /** Affiliate network / merchant CSV exports with a per-feed column mapping. */
  csv_mapped: { kind: 'csv_mapped', remoteOnly: false, parse: parseMappedCsv },
  /** A verified merchant's own Shopify catalog. */
  shopify_products_json: { kind: 'shopify_products_json', remoteOnly: true, requiresVerifiedDomain: true, parse: parseShopifyProducts },
};

export function getAdapter(kind: string): FeedAdapter {
  const a = ADAPTERS[kind];
  if (!a) throw new Error(`no adapter for feed kind "${kind}"`);
  return a;
}
