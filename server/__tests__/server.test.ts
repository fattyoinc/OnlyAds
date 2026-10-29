import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createHandler, loadServerConfig, parseOffersQuery, type ServerConfig } from '../app';
import { migrate, openDb, type DB } from '../db';
import { ingestFeed } from '../ingest';
import { evaluateOffer } from '../policy';
import { RateLimiter } from '../rateLimit';
import { seedDemo } from '../seed';
import { validateOffer } from '@/services/offerValidation';

const HEADER = 'id\ttitle\tdescription\tlink\tavailability\tprice\tsale_price\tbrand\tgoogle_product_category\n';
const row = (id: string, title: string, link = `https://acme.com/p/${id}`, price = '100 USD', sale = '') => `${id}\t${title}\tdesc\t${link}\tin_stock\t${price}\t${sale}\tAcme\tElectronics\n`;
const fetchText = (text: string) => (async () => new Response(text)) as unknown as typeof fetch;

function freshDb(): DB {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function addAdvertiser(db: DB, id = 'acme', status = 'active', opts: { demo?: boolean; domains?: string[] } = {}) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO advertisers (id, name, status, allowed_domains, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'Acme', status, JSON.stringify(opts.domains ?? ['acme.com']), opts.demo ? 1 : 0, now, now);
  db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES (?, ?, 'merchant_tsv', 'https://feeds.acme.com/f.tsv', ?)").run(`${id}-feed`, id, now);
}

async function listen(db: DB, cfg: Partial<ServerConfig> = {}): Promise<{ base: string; server: Server }> {
  const server = createServer(createHandler(db, { ...loadServerConfig({ APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv), cacheTtlMs: 0, ...cfg }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe('migrations', () => {
  it('apply once and are idempotent', () => {
    const db = openDb(':memory:');
    assert.deepEqual(migrate(db), ['001_init.sql', '002_attribution_availability_analytics.sql', '003_verification_mapped_feeds_conversions.sql']);
    assert.deepEqual(migrate(db), []);
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => (r as { name: string }).name);
    for (const name of ['advertisers', 'feeds', 'offers', 'ingestion_runs', 'click_counts', 'schema_migrations']) assert.ok(t.includes(name), name);
  });
  it('enforce constraints (bad status rejected, foreign keys on)', () => {
    const db = freshDb();
    assert.throws(() => db.prepare("INSERT INTO advertisers (id, name, status, created_at, updated_at) VALUES ('x', 'X', 'bogus', '', '')").run());
    assert.throws(() => db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('f', 'missing', 'merchant_tsv', 's', '')").run());
  });
});

describe('ingestion', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    addAdvertiser(db);
  });

  it('upserts, is idempotent, and deactivates items removed from the feed', async () => {
    const r1 = await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('1', 'Phone') + row('2', 'Tablet')) });
    assert.equal(r1.ok, true);
    assert.equal(r1.upserted, 2);
    const r2 = await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('1', 'Phone') + row('2', 'Tablet')) });
    assert.equal(r2.upserted, 0, 'unchanged rows are not rewritten');
    const r3 = await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('1', 'Phone')) });
    assert.equal(r3.deactivated, 1);
    const statuses = db.prepare('SELECT external_id, status FROM offers ORDER BY external_id').all();
    assert.deepEqual(statuses.map((s) => ({ ...s })), [{ external_id: '1', status: 'active' }, { external_id: '2', status: 'inactive' }]);
  });

  it('applies the content policy', async () => {
    const feed =
      HEADER +
      row('ok', 'Phone') +
      row('offdomain', 'Phone', 'https://evil-phish.com/p') +
      row('banned', 'Disposable vape kit') +
      row('toocheap', 'Laptop', 'https://acme.com/l', '1000 USD', '50 USD');
    const r = await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(feed) });
    const map = Object.fromEntries(db.prepare('SELECT external_id, status, review_reason FROM offers').all().map((x) => { const o = x as { external_id: string; status: string }; return [o.external_id, o.status]; }));
    assert.equal(map.ok, 'active');
    assert.equal(map.offdomain, 'rejected');
    assert.equal(map.banned, 'rejected');
    assert.equal(map.toocheap, 'pending_review');
    assert.equal(r.rejected, 2);
    assert.equal(r.review, 1);
  });

  it('keeps a reviewer decision across re-ingestion until the content changes', async () => {
    const feed = HEADER + row('deal', 'Laptop', 'https://acme.com/l', '1000 USD', '50 USD');
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(feed) });
    db.prepare("UPDATE offers SET status = 'active' WHERE external_id = 'deal'").run(); // reviewer approves
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(feed) });
    assert.equal((db.prepare("SELECT status FROM offers WHERE external_id = 'deal'").get() as { status: string }).status, 'active');
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('deal', 'Laptop', 'https://acme.com/l', '1000 USD', '40 USD')) });
    assert.equal((db.prepare("SELECT status FROM offers WHERE external_id = 'deal'").get() as { status: string }).status, 'pending_review', 'changed content is re-reviewed');
  });

  it('keeps previous offers when a fetch fails and records the error', async () => {
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('1', 'Phone')) });
    const failing = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const r = await ingestFeed(db, 'acme-feed', { fetchImpl: failing });
    assert.equal(r.ok, false);
    assert.equal((db.prepare("SELECT status FROM offers WHERE external_id = '1'").get() as { status: string }).status, 'active');
    assert.match((db.prepare("SELECT last_error FROM feeds WHERE id = 'acme-feed'").get() as { last_error: string }).last_error, /ECONNRESET/);
    assert.equal((db.prepare("SELECT status FROM ingestion_runs ORDER BY id DESC LIMIT 1").get() as { status: string }).status, 'failed');
  });

  it('rejects oversized feeds and http feed URLs', async () => {
    db.prepare("UPDATE feeds SET source = 'http://feeds.acme.com/f.tsv'").run();
    const r = await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText('') });
    assert.equal(r.ok, false);
    db.prepare("UPDATE feeds SET source = '../../etc/passwd'").run();
    const r2 = await ingestFeed(db, 'acme-feed');
    assert.match(r2.error!, /inside server\/data/);
  });

  it('holds offers from new (pending) advertisers for review', async () => {
    db.prepare("UPDATE advertisers SET status = 'pending'").run();
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(HEADER + row('1', 'Phone')) });
    assert.equal((db.prepare('SELECT status FROM offers').get() as { status: string }).status, 'pending_review');
  });
});

describe('policy', () => {
  const base = validateOffer({ id: 'x', title: 'Headphones', url: 'https://shop.acme.com/x', category: 'tech', advertiser: { id: 'acme', name: 'Acme' } })!;
  const adv = { status: 'active' as const, allowedDomains: ['acme.com'] };
  it('accepts subdomains of allowed domains only', () => {
    assert.equal(evaluateOffer(base, adv).outcome, 'accept');
    assert.equal(evaluateOffer({ ...base, url: 'https://acme.com.evil.io/x' }, adv).outcome, 'reject');
  });
  it('flags deceptive wording and expired offers', () => {
    assert.equal(evaluateOffer({ ...base, title: 'You have won a FREE iPhone' }, adv).outcome, 'review');
    assert.equal(evaluateOffer({ ...base, expiresAt: '2020-01-01T00:00:00Z' }, adv).outcome, 'reject');
  });
  it('rejects everything from suspended advertisers', () => {
    assert.equal(evaluateOffer(base, { ...adv, status: 'suspended' }).outcome, 'reject');
  });
});

describe('API', () => {
  let db: DB;
  let base: string;
  let server: Server;

  before(async () => {
    db = freshDb();
    addAdvertiser(db);
    addAdvertiser(db, 'demo', 'active', { demo: true, domains: ['example.com'] });
    let feed = HEADER;
    for (let i = 0; i < 60; i++) feed += row(String(i).padStart(3, '0'), `Item ${i}`);
    await ingestFeed(db, 'acme-feed', { fetchImpl: fetchText(feed) });
    await ingestFeed(db, 'demo-feed', { fetchImpl: fetchText(HEADER + row('d1', 'Demo thing', 'https://example.com/d1')) });
    ({ base, server } = await listen(db));
  });
  after(() => server.close());

  it('paginates with a stable cursor and no duplicates', async () => {
    const p1 = await (await fetch(`${base}/v1/offers?limit=25`)).json();
    const p2 = await (await fetch(`${base}/v1/offers?limit=25&cursor=${p1.nextCursor}`)).json();
    const p3 = await (await fetch(`${base}/v1/offers?limit=25&cursor=${p2.nextCursor}`)).json();
    const ids = [...p1.offers, ...p2.offers, ...p3.offers].map((o: { id: string }) => o.id);
    assert.equal(ids.length, 60);
    assert.equal(new Set(ids).size, 60);
    assert.equal(p3.nextCursor, null);
  });

  it('never serves demo advertisers in production', async () => {
    const all = await (await fetch(`${base}/v1/offers`)).json();
    assert.ok(!all.offers.some((o: { id: string }) => o.id.startsWith('demo-feed')));
    const click = await fetch(`${base}/v1/click/demo-feed-d1`, { redirect: 'manual' });
    assert.equal(click.status, 410);
  });

  it('validates every input', async () => {
    for (const qs of ['lat=91&lng=0', 'lat=10', 'limit=0', 'limit=500', 'category=weapons', 'cursor=%%%', 'cursor=' + 'a'.repeat(400), 'evil=1', "lat=1;DROP TABLE offers&lng=1"]) {
      const r = await fetch(`${base}/v1/offers?${qs}`);
      assert.equal(r.status, 400, qs);
    }
    assert.equal((await fetch(`${base}/v1/offers`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/v1/click/${encodeURIComponent('../../etc')}`)).status, 400);
  });

  it('redirects clicks to the advertiser and counts them (no personal data)', async () => {
    const r = await fetch(`${base}/v1/click/acme-feed-001`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://acme.com/p/001');
    const c = db.prepare("SELECT * FROM click_counts WHERE offer_id = 'acme-feed-001'").get() as Record<string, unknown>;
    assert.equal(c.count, 1);
    assert.deepEqual(Object.keys(c).sort(), ['count', 'day', 'offer_id']);
    assert.equal((await fetch(`${base}/v1/click/does-not-exist`, { redirect: 'manual' })).status, 410);
  });

  it('stops redirecting immediately when an advertiser is suspended', async () => {
    db.prepare("UPDATE advertisers SET status = 'suspended' WHERE id = 'acme'").run();
    assert.equal((await fetch(`${base}/v1/click/acme-feed-002`, { redirect: 'manual' })).status, 410);
    assert.equal((await (await fetch(`${base}/v1/offers`)).json()).offers.length, 0);
    db.prepare("UPDATE advertisers SET status = 'active' WHERE id = 'acme'").run();
  });

  it('hides offers from feeds that have gone stale', async () => {
    db.prepare("UPDATE feeds SET last_success_at = '2000-01-01T00:00:00.000Z' WHERE id = 'acme-feed'").run();
    assert.equal((await (await fetch(`${base}/v1/offers`)).json()).offers.length, 0);
    db.prepare('UPDATE feeds SET last_success_at = ? WHERE id = ?').run(new Date().toISOString(), 'acme-feed');
  });

  it('sets security headers and only allow-listed CORS origins', async () => {
    const r = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.ok(r.headers.get('strict-transport-security'));
    assert.ok(r.headers.get('x-request-id'));
  });
});

describe('geo filtering', () => {
  it('returns local offers only near the requested point, and none without a location', async () => {
    const db = freshDb();
    addAdvertiser(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('acme-direct', 'acme', 'direct_json', 'x', ?)").run(now);
    const offers = {
      offers: [
        { id: 'mia', title: 'Miami tacos', url: 'https://acme.com/m', category: 'food', location: { lat: 25.77, lng: -80.19, address: 'a', placeName: 'p' } },
        { id: 'nyc', title: 'NYC bagels', url: 'https://acme.com/n', category: 'food', location: { lat: 40.71, lng: -74.0, address: 'a', placeName: 'p' } },
        { id: 'online', title: 'Online deal', url: 'https://acme.com/o', category: 'tech' },
      ],
    };
    db.prepare("UPDATE feeds SET source = 'https://feeds.acme.com/d.json' WHERE id = 'acme-direct'").run();
    await ingestFeed(db, 'acme-direct', { fetchImpl: fetchText(JSON.stringify(offers)) });
    const { base, server } = await listen(db);
    try {
      const near = (await (await fetch(`${base}/v1/offers?lat=25.76&lng=-80.19`)).json()).offers.map((o: { id: string }) => o.id).sort();
      assert.deepEqual(near, ['acme-direct-mia', 'acme-direct-online']);
      const none = (await (await fetch(`${base}/v1/offers`)).json()).offers.map((o: { id: string }) => o.id);
      assert.deepEqual(none, ['acme-direct-online']);
    } finally {
      server.close();
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the burst is used', async () => {
    const db = freshDb();
    const { base, server } = await listen(db, { rateLimit: { capacity: 3, refillPerSec: 0.1 } });
    try {
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/v1/offers`)).status);
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
      const r = await fetch(`${base}/v1/offers`);
      assert.ok(Number(r.headers.get('retry-after')) >= 1);
    } finally {
      server.close();
    }
  });
  it('bounds memory by evicting least-recent keys', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.take(`ip${i}`);
    assert.equal(rl.size, 100);
  });
});

describe('query parsing', () => {
  it('rounds coordinates to ~1 km server-side', () => {
    const q = parseOffersQuery(new URLSearchParams('lat=25.761712&lng=-80.191812'));
    assert.equal(q.lat, 25.76);
    assert.equal(q.lng, -80.19);
  });
});

describe('demo seed', () => {
  it('loads demo advertisers flagged is_demo', async () => {
    const db = freshDb();
    seedDemo(db);
    const rows = db.prepare('SELECT is_demo FROM advertisers').all() as { is_demo: number }[];
    assert.ok(rows.length >= 2 && rows.every((r) => r.is_demo === 1));
  });
});
