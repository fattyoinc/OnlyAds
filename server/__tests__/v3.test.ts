import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { validateMapping } from '../adapters';
import { createHandler, loadServerConfig } from '../app';
import { funnelReport, recordPostback, toMinor, tokenMatches } from '../conversions';
import { migrate, openDb, type DB } from '../db';
import { ingestFeed } from '../ingest';
import { checkVerification, startVerification } from '../verify';

function freshDb(): DB {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}
const iso = () => new Date().toISOString();

function addAdvertiser(db: DB, id: string, domains: string[], extra: { network?: string; template?: string } = {}) {
  db.prepare(
    "INSERT INTO advertisers (id, name, status, allowed_domains, affiliate, attribution_enabled, tracking_template, network, created_at, updated_at) VALUES (?, ?, 'active', ?, 1, ?, ?, ?, ?, ?)",
  ).run(id, id.toUpperCase(), JSON.stringify(domains), extra.template ? 1 : 0, extra.template ?? null, extra.network ?? null, iso(), iso());
}
function addFeed(db: DB, id: string, adv: string, kind: string, source: string, mapping?: object) {
  db.prepare('INSERT INTO feeds (id, advertiser_id, kind, source, mapping, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, adv, kind, source, mapping ? JSON.stringify(mapping) : null, iso());
}
const respond = (text: string, status = 200) => (async () => new Response(text, { status })) as unknown as typeof fetch;
const payloads = (db: DB) => (db.prepare("SELECT payload FROM offers WHERE status = 'active' ORDER BY id").all() as { payload: string }[]).map((r) => JSON.parse(r.payload));

async function listen(db: DB, env: Record<string, string> = {}): Promise<{ base: string; server: Server }> {
  const server = createServer(createHandler(db, { ...loadServerConfig({ APP_ENV: 'production', ...env } as unknown as NodeJS.ProcessEnv), cacheTtlMs: 0 }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

// Column names follow Awin's documented feed columns where confirmed (aw_deep_link, merchant_name);
// the mapping is per feed, so other networks' exports work the same way.
const AWIN_STYLE_CSV = [
  'aw_product_id,product_name,aw_deep_link,search_price,rrp_price,merchant_image_url,merchant_category,brand_name,in_stock',
  '101,Trail Runner 2,https://www.awin1.com/pclick.php?p=101&a=1&m=2,89.99,120.00,https://img.shop.example/101.jpg,Running Shoes,Strider,1',
  '102,"Cotton Tee, Navy",https://www.awin1.com/pclick.php?p=102&a=1&m=2,15.00,,https://img.shop.example/102.jpg,Clothing,Strider,1',
  '103,Mystery Item,https://www.awin1.com/pclick.php?p=103&a=1&m=2,9.00,,,Misc,Strider,1',
].join('\n');
const AWIN_MAPPING = {
  columns: { id: 'aw_product_id', title: 'product_name', link: 'aw_deep_link', price: 'rrp_price', sale_price: 'search_price', image_link: 'merchant_image_url', category: 'merchant_category', brand: 'brand_name' },
  currency: 'GBP',
  categories: { 'running shoes': 'sneakers', clothing: 'fashion' },
  defaultCategory: 'gifts',
};

describe('csv_mapped adapter (affiliate network exports)', () => {
  it('maps columns, currency and categories; links stay the network tracking links', async () => {
    const db = freshDb();
    addAdvertiser(db, 'strider', ['awin1.com']);
    addFeed(db, 'strider-awin', 'strider', 'csv_mapped', 'https://feeds.example.net/strider.csv', AWIN_MAPPING);
    const r = await ingestFeed(db, 'strider-awin', { fetchImpl: respond(AWIN_STYLE_CSV) });
    assert.equal(r.ok, true, r.error);
    const [a, b, c] = payloads(db);
    assert.equal(a.title, 'Trail Runner 2');
    assert.equal(a.category, 'sneakers');
    assert.deepEqual(a.price, { amount: 89.99, currency: 'GBP' });
    assert.deepEqual(a.originalPrice, { amount: 120, currency: 'GBP' });
    assert.match(a.url, /^https:\/\/www\.awin1\.com\//);
    assert.equal(b.title, 'Cotton Tee, Navy');
    assert.equal(b.category, 'fashion');
    assert.deepEqual(b.price, { amount: 15, currency: 'GBP' });
    assert.equal(c.category, 'gifts');
  });

  it('fails the run (keeping current offers) when the export drops a mapped column', async () => {
    const db = freshDb();
    addAdvertiser(db, 'strider', ['awin1.com']);
    addFeed(db, 'strider-awin', 'strider', 'csv_mapped', 'https://feeds.example.net/strider.csv', AWIN_MAPPING);
    await ingestFeed(db, 'strider-awin', { fetchImpl: respond(AWIN_STYLE_CSV) });
    const renamed = AWIN_STYLE_CSV.replace('aw_deep_link', 'deep_link');
    const r = await ingestFeed(db, 'strider-awin', { fetchImpl: respond(renamed) });
    assert.equal(r.ok, false);
    assert.match(r.error!, /missing mapped column\(s\): aw_deep_link/);
    assert.equal(payloads(db).length, 3);
  });

  it('rejects bad mappings with a readable error', () => {
    assert.throws(() => validateMapping('csv_mapped', undefined), /needs a mapping/);
    assert.throws(() => validateMapping('csv_mapped', { columns: { id: 'a', title: 'b', link: 'c' } }), /columns.price is required/);
    assert.throws(() => validateMapping('csv_mapped', { columns: { id: 'a', title: 'b', link: 'c', price: 'd', bogus: 'e' } }), /unknown field "bogus"/);
    assert.throws(() => validateMapping('csv_mapped', { ...AWIN_MAPPING, categories: { shoes: 'weapons' } }), /must be one of/);
    assert.throws(() => validateMapping('shopify_products_json', {}), /currency is required/);
  });
});

const SHOPIFY = JSON.stringify({
  products: [
    {
      id: 7001,
      title: 'Linen Throw',
      handle: 'linen-throw',
      body_html: '<p>Soft &amp; light.</p>',
      vendor: 'Casa',
      product_type: 'Home Decor',
      tags: ['home'],
      images: [{ src: 'https://cdn.shopify.com/s/files/throw.jpg' }],
      variants: [
        { price: '59.00', compare_at_price: '79.00', available: true },
        { price: '49.00', compare_at_price: null, available: false },
      ],
    },
    { id: 7002, title: 'Sold out', handle: 'sold-out', variants: [{ price: '10.00', available: false }] },
    { id: 7003, title: 'Bad handle', handle: '../../admin', variants: [{ price: '10.00', available: true }] },
  ],
});

describe('merchant domain verification + Shopify store catalogs', () => {
  it('refuses to fetch a store catalog until the merchant proves domain ownership', async () => {
    const db = freshDb();
    addAdvertiser(db, 'casa', ['casa-store.com']);
    addFeed(db, 'casa-shop', 'casa', 'shopify_products_json', 'https://casa-store.com/products.json', { currency: 'USD', defaultCategory: 'home' });
    let fetched = false;
    const spy = (async () => ((fetched = true), new Response(SHOPIFY))) as unknown as typeof fetch;
    const r = await ingestFeed(db, 'casa-shop', { fetchImpl: spy });
    assert.equal(r.ok, false);
    assert.match(r.error!, /not verified its domain/);
    assert.equal(fetched, false, 'nothing is fetched from an unverified store');
  });

  it('verifies via the well-known token, then imports buyable products with correct links and prices', async () => {
    const db = freshDb();
    addAdvertiser(db, 'casa', ['casa-store.com']);
    assert.throws(() => startVerification(db, 'casa', 'other.com'), /not in the advertiser's allowed domains/);
    const v = startVerification(db, 'casa', 'casa-store.com');
    assert.equal(v.url, 'https://casa-store.com/.well-known/onlyads-verify.txt');
    assert.equal((await checkVerification(db, 'casa', respond('onlyads-verify=wrong'))).ok, false);
    assert.equal((await checkVerification(db, 'casa', respond('', 404))).reason, 'HTTP 404');
    assert.equal((await checkVerification(db, 'casa', respond(`# hi\n${v.body}\n`))).ok, true);

    addFeed(db, 'elsewhere', 'casa', 'shopify_products_json', 'https://not-casa.com/products.json', { currency: 'USD' });
    assert.match((await ingestFeed(db, 'elsewhere', { fetchImpl: respond(SHOPIFY) })).error!, /must be on the verified domain casa-store\.com/);

    addFeed(db, 'casa-shop', 'casa', 'shopify_products_json', 'https://casa-store.com/products.json', { currency: 'USD', defaultCategory: 'home' });
    const r = await ingestFeed(db, 'casa-shop', { fetchImpl: respond(SHOPIFY) });
    assert.equal(r.ok, true, r.error);
    const offers = payloads(db);
    assert.equal(offers.length, 1);
    const [o] = offers;
    assert.equal(o.url, 'https://casa-store.com/products/linen-throw');
    assert.deepEqual(o.price, { amount: 59, currency: 'USD' }, 'cheapest *available* variant');
    assert.deepEqual(o.originalPrice, { amount: 79, currency: 'USD' });
    assert.equal(o.category, 'home');
    assert.equal(o.description, 'Soft & light.');
  });

  it('restarting verification revokes the previous one', async () => {
    const db = freshDb();
    addAdvertiser(db, 'casa', ['casa-store.com']);
    const v = startVerification(db, 'casa', 'casa-store.com');
    await checkVerification(db, 'casa', respond(v.body));
    startVerification(db, 'casa', 'casa-store.com');
    const row = db.prepare("SELECT domain_verified_at FROM advertisers WHERE id = 'casa'").get() as { domain_verified_at: string | null };
    assert.equal(row.domain_verified_at, null);
  });
});

describe('conversions: postbacks, attribution, revenue', () => {
  async function setup(opts: { expiresAt?: string } = {}) {
    const db = freshDb();
    addAdvertiser(db, 'acme', ['acme.com'], { network: 'awin', template: 'oa_click={click_id}' });
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('f', 'acme', 'direct_json', 'https://acme.com/o.json', ?)").run(iso());
    const offers = [{ id: '1', title: 'Offer one', url: 'https://acme.com/1', category: 'tech', ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}) }];
    await ingestFeed(db, 'f', { fetchImpl: respond(JSON.stringify({ offers })) });
    const { base, server } = await listen(db, { POSTBACK_TOKEN_AWIN: 'pb-secret-1' });
    return { db, base, server };
  }
  const click = async (base: string, id = 'f-1') => {
    const r = await fetch(`${base}/v1/click/${id}`, { redirect: 'manual' });
    return { status: r.status, clickId: new URL(r.headers.get('location') ?? 'https://x.invalid').searchParams.get('oa_click') };
  };
  const pb = (base: string, q: string, token: string | null = 'pb-secret-1') => fetch(`${base}/v1/postbacks/awin?${q}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it('a click alone records no conversion and no revenue', async () => {
    const { db, base, server } = await setup();
    try {
      assert.equal((await click(base)).status, 302);
      const [row] = funnelReport(db, '2000-01-01');
      assert.equal(row.clicks, 1);
      assert.equal(row.attributedConversions, 0);
      assert.deepEqual(row.confirmedRevenueMinor, {});
    } finally {
      server.close();
    }
  });

  it('authenticates partners; unknown networks have no endpoint', async () => {
    const { base, server } = await setup();
    try {
      const { clickId } = await click(base);
      assert.equal((await pb(base, `transaction_id=t1&click_id=${clickId}`, null)).status, 401);
      assert.equal((await pb(base, `transaction_id=t1&click_id=${clickId}`, 'wrong')).status, 401);
      assert.equal((await fetch(`${base}/v1/postbacks/cj?transaction_id=t1&click_id=${clickId}`)).status, 404);
      assert.equal((await fetch(`${base}/v1/postbacks/awin?transaction_id=t1&click_id=${clickId}&token=pb-secret-1`)).status, 200);
    } finally {
      server.close();
    }
  });

  it('pending → confirmed → reversed; duplicates are idempotent; illegal transitions rejected', async () => {
    const { db, base, server } = await setup();
    try {
      const { clickId } = await click(base);
      const q = (s: string, extra = '') => `transaction_id=T-9&click_id=${clickId}&status=${s}${extra}`;
      assert.equal((await (await pb(base, q('pending', '&commission=4.50&sale_amount=45.00&currency=usd'))).json()).outcome, 'recorded');
      assert.equal((await (await pb(base, q('pending'))).json()).outcome, 'duplicate');
      let [row] = funnelReport(db, '2000-01-01');
      assert.equal(row.attributedConversions, 1);
      assert.deepEqual(row.confirmedRevenueMinor, {}, 'pending is not revenue');
      assert.deepEqual(row.pendingRevenueMinor, { USD: 450 });

      assert.equal((await (await pb(base, q('approved'))).json()).outcome, 'updated');
      [row] = funnelReport(db, '2000-01-01');
      assert.equal(row.confirmedConversions, 1);
      assert.deepEqual(row.confirmedRevenueMinor, { USD: 450 });

      assert.equal((await pb(base, q('pending'))).status, 409, 'confirmed cannot go back to pending');
      assert.equal((await (await pb(base, q('reversed'))).json()).outcome, 'updated');
      assert.equal((await pb(base, q('confirmed'))).status, 409, 'reversed is final');
      [row] = funnelReport(db, '2000-01-01');
      assert.equal(row.attributedConversions, 0);
      assert.equal(row.reversedConversions, 1);
      assert.deepEqual(row.confirmedRevenueMinor, {});
      assert.equal((db.prepare('SELECT count(*) AS n FROM conversions').get() as { n: number }).n, 1);
    } finally {
      server.close();
    }
  });

  it('rejects unknown or fabricated clicks, malformed values, and reused transaction ids', async () => {
    const { db, base, server } = await setup();
    try {
      const { clickId } = await click(base);
      const { clickId: other } = await click(base);
      assert.equal((await pb(base, `transaction_id=t&click_id=${'a'.repeat(24)}`)).status, 422);
      assert.equal((await pb(base, `transaction_id=t&click_id=not-a-click`)).status, 400);
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}&commission=-1&currency=USD`)).status, 400);
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}&commission=1e9&currency=USD`)).status, 400);
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}&commission=5`)).status, 400, 'amount without currency');
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}&status=paid`)).status, 400);
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}&occurred_at=2001-01-01T00:00:00Z`)).status, 422, 'before the click');
      assert.equal((await pb(base, `transaction_id=t&click_id=${clickId}`)).status, 200);
      assert.equal((await pb(base, `transaction_id=t&click_id=${other}`)).status, 409);
      assert.equal((db.prepare('SELECT count(*) AS n FROM conversions').get() as { n: number }).n, 1);
    } finally {
      server.close();
    }
  });

  it('a network cannot claim clicks attributed to another network', () => {
    const db = freshDb();
    db.prepare("INSERT INTO click_events (click_id, offer_id, advertiser_id, campaign_id, network, created_at) VALUES (?, 'o', 'acme', 'c', 'impact', ?)").run('b'.repeat(24), iso());
    const r = recordPostback(db, 'awin', new URLSearchParams(`transaction_id=x&click_id=${'b'.repeat(24)}`));
    assert.deepEqual(r, { http: 422, error: 'unknown click' });
  });

  it('expired offers: no click (so nothing to attribute); a sale reported after expiry still counts', async () => {
    const soon = new Date(Date.now() + 1500).toISOString();
    const { db, base, server } = await setup({ expiresAt: soon });
    try {
      const { clickId } = await click(base);
      await new Promise((r) => setTimeout(r, 1600));
      assert.equal((await click(base)).status, 410, 'expired offer: no redirect, no click event');
      assert.equal((db.prepare('SELECT count(*) AS n FROM click_events').get() as { n: number }).n, 1);
      assert.equal((await pb(base, `transaction_id=late&click_id=${clickId}&status=confirmed&commission=2&currency=EUR`)).status, 200);
    } finally {
      server.close();
    }
  });

  it('helpers: money parsing and constant-time token check', () => {
    assert.equal(toMinor('12.3'), 1230);
    assert.equal(toMinor('0.05'), 5);
    assert.equal(toMinor(''), undefined);
    assert.equal(toMinor('1,000'), null);
    assert.equal(tokenMatches('a', 'a'), true);
    assert.equal(tokenMatches('a', 'b'), false);
    assert.equal(tokenMatches(undefined, undefined), false);
  });
});
