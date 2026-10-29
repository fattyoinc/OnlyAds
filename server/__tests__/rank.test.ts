import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { createHandler, loadServerConfig, parseFeedQuery } from '../app';
import { migrate, openDb, type DB } from '../db';
import { ingestFeed } from '../ingest';
import { computePopularity, MIN_IMPRESSIONS } from '../rank';

const fetchText = (text: string) => (async () => new Response(text)) as unknown as typeof fetch;

function freshDb(): DB {
  const db = openDb(':memory:');
  migrate(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO advertisers (id, name, status, allowed_domains, created_at, updated_at) VALUES ('acme', 'Acme', 'active', '[\"acme.com\"]', ?, ?)").run(now, now);
  db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('f', 'acme', 'direct_json', 'https://acme.com/offers.json', ?)").run(now);
  return db;
}

const offer = (id: string, category: string, extra: object = {}) => ({ id, title: `Offer ${id}`, url: `https://acme.com/${id}`, category, ...extra });

async function seed(db: DB, offers: object[]) {
  const r = await ingestFeed(db, 'f', { fetchImpl: fetchText(JSON.stringify({ offers })) });
  assert.equal(r.ok, true, r.error);
}

async function listen(db: DB): Promise<{ base: string; server: Server }> {
  const server = createServer(createHandler(db, { ...loadServerConfig({ APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv), cacheTtlMs: 0 }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

type Page = { offers: { id: string; category: string; popularity?: number }[]; nextCursor: string | null };
const get = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as Page };
};

/** 100 tech offers whose ids sort first, then 20 food offers. */
const catalog = () => [...Array.from({ length: 100 }, (_, i) => offer(`a${String(i).padStart(3, '0')}`, 'tech')), ...Array.from({ length: 20 }, (_, i) => offer(`z${String(i).padStart(3, '0')}`, 'food'))];

describe('GET /v1/feed ranks the whole catalog', () => {
  it('surfaces matching offers that are far beyond the first unranked page', async () => {
    const db = freshDb();
    await seed(db, catalog());
    const { base, server } = await listen(db);
    try {
      const unranked = await get(`${base}/v1/offers?limit=10`);
      assert.equal(unranked.body.offers.filter((o) => o.category === 'food').length, 0, 'id order buries food');
      const ranked = await get(`${base}/v1/feed?limit=10&interests=food`);
      assert.equal(ranked.status, 200);
      assert.equal(ranked.body.offers[0].category, 'food');
      assert.ok(ranked.body.offers.filter((o) => o.category === 'food').length >= 3);
      // Diversity: one category can't take the whole page.
      assert.ok(ranked.body.offers.some((o) => o.category === 'tech'));
    } finally {
      server.close();
    }
  });

  it('pages through every eligible offer exactly once', async () => {
    const db = freshDb();
    await seed(db, catalog());
    const { base, server } = await listen(db);
    try {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: { body: Page } = await get(`${base}/v1/feed?limit=50&interests=food${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...r.body.offers.map((o) => o.id));
        cursor = r.body.nextCursor;
      } while (cursor && ++pages < 10);
      assert.equal(seen.length, 120);
      assert.equal(new Set(seen).size, 120);
    } finally {
      server.close();
    }
  });

  it('cold start (no preferences) still ranks by deal quality, and negative preferences demote', async () => {
    const db = freshDb();
    await seed(db, [...catalog(), offer('m-deal', 'tech', { price: { amount: 50, currency: 'USD' }, originalPrice: { amount: 100, currency: 'USD' } })]);
    const { base, server } = await listen(db);
    try {
      assert.equal((await get(`${base}/v1/feed?limit=5`)).body.offers[0].id, 'f-m-deal');
      const disliked = await get(`${base}/v1/feed?limit=20&affinity=tech:-2&interests=food`);
      assert.equal(disliked.body.offers.slice(0, 5).filter((o) => o.category === 'food').length >= 3, true);
    } finally {
      server.close();
    }
  });

  it('never serves expired, out-of-country, or out-of-range local offers', async () => {
    const db = freshDb();
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const past = new Date(Date.now() - 3600_000).toISOString();
    await seed(db, [
      offer('ok', 'food'),
      offer('expired', 'food', { expiresAt: past }),
      offer('ending', 'food', { expiresAt: soon }),
      offer('ca-only', 'food', { availability: { countries: ['CA'] } }),
      offer('local', 'food', { location: { lat: 40.71, lng: -74.0, address: '1 Main St', placeName: 'Acme NYC' } }),
    ]);
    const { base, server } = await listen(db);
    try {
      const ids = async (q: string) => (await get(`${base}/v1/feed?${q}`)).body.offers.map((o) => o.id).sort();
      assert.deepEqual(await ids('country=US'), ['f-ending', 'f-ok']);
      assert.deepEqual(await ids('country=CA'), ['f-ca-only', 'f-ending', 'f-ok']);
      assert.deepEqual(await ids('country=US&lat=40.72&lng=-74.01'), ['f-ending', 'f-local', 'f-ok']);
      assert.deepEqual(await ids('country=US&lat=34.05&lng=-118.24'), ['f-ending', 'f-ok']);
    } finally {
      server.close();
    }
  });

  it('rejects malformed preference parameters instead of guessing', async () => {
    const db = freshDb();
    const { base, server } = await listen(db);
    try {
      for (const q of ['interests=food,nope', 'affinity=food:9', 'affinity=food:1,food:2', 'affinity=nope:1', 'cursor=abc', 'cursor=' + Buffer.from('f1.x.99999').toString('base64url'), 'foo=1']) {
        assert.equal((await fetch(`${base}/v1/feed?${q}`)).status, 400, q);
      }
    } finally {
      server.close();
    }
  });

  it('identical preferences in any order share one cache key', () => {
    const a = parseFeedQuery(new URLSearchParams('interests=tech,food&affinity=tech:1,food:2'));
    const b = parseFeedQuery(new URLSearchParams('interests=food,tech&affinity=food:2,tech:1'));
    assert.deepEqual(a, b);
  });
});

describe('popularity', () => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const counts = (db: DB, id: string, imps: number, clicks: number) => {
    db.prepare('INSERT INTO impression_counts (offer_id, day, count) VALUES (?, ?, ?)').run(id, day, imps);
    if (clicks) db.prepare('INSERT INTO click_counts (offer_id, day, count) VALUES (?, ?, ?)').run(id, day, clicks);
  };

  it('is absent until enough offers have enough impressions', () => {
    const db = freshDb();
    for (let i = 0; i < 4; i++) counts(db, `o${i}`, 500, i * 10);
    counts(db, 'thin', MIN_IMPRESSIONS - 1, 10);
    assert.equal(computePopularity(db, now).size, 0);
  });

  it('is a smoothed click-through percentile; a few lucky clicks on few views do not win', () => {
    const db = freshDb();
    counts(db, 'low', 1000, 5);
    counts(db, 'mid', 1000, 20);
    counts(db, 'high', 1000, 80);
    counts(db, 'lucky', MIN_IMPRESSIONS, 6);
    counts(db, 'zero', 1000, 0);
    counts(db, 'old', 1000, 900);
    db.prepare("UPDATE impression_counts SET day = '2000-01-01' WHERE offer_id = 'old'").run();
    counts(db, 'more', 1000, 30);
    const p = computePopularity(db, now);
    assert.equal(p.get('high'), 1);
    assert.equal(p.get('zero'), 0);
    assert.ok(p.get('lucky')! < p.get('high')!, 'smoothing pulls tiny samples to the mean');
    assert.equal(p.has('old'), false, 'outside the window');
    for (const v of p.values()) assert.ok(v >= 0 && v <= 1);
  });

  it('is attached at serving time and cannot be set by a feed', async () => {
    const db = freshDb();
    await seed(db, Array.from({ length: 6 }, (_, i) => offer(`p${i}`, 'tech', { popularity: 1 })));
    for (let i = 0; i < 6; i++) counts(db, `f-p${i}`, 200, i * 5);
    const stored = db.prepare("SELECT payload FROM offers WHERE id = 'f-p0'").get() as { payload: string };
    assert.equal(JSON.parse(stored.payload).popularity, undefined);
    const { base, server } = await listen(db);
    try {
      const body = (await get(`${base}/v1/feed`)).body;
      assert.equal(body.offers[0].id, 'f-p5', 'most clicked-through ranks first');
      assert.equal(body.offers.find((o) => o.id === 'f-p5')!.popularity, 1);
      assert.equal(body.offers.find((o) => o.id === 'f-p0')!.popularity, 0);
    } finally {
      server.close();
    }
  });
});
