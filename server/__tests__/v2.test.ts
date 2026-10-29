import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { applyTrackingTemplate, createHandler, loadServerConfig, purgeExpiredData, type ServerConfig } from '../app';
import { migrate, openDb, type DB } from '../db';
import { ingestFeed } from '../ingest';

const fetchText = (text: string, spy?: (init?: RequestInit) => void) =>
  (async (_u: string, init?: RequestInit) => {
    spy?.(init);
    return new Response(text);
  }) as unknown as typeof fetch;

function freshDb(): DB {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function addAdvertiser(db: DB, id = 'acme', extra: { attribution?: string; network?: string } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO advertisers (id, name, status, allowed_domains, is_demo, attribution_enabled, tracking_template, network, created_at, updated_at) VALUES (?, 'Acme', 'active', '[\"acme.com\"]', 0, ?, ?, ?, ?, ?)",
  ).run(id, extra.attribution ? 1 : 0, extra.attribution ?? null, extra.network ?? null, now, now);
}

const offersJson = (offers: object[]) => JSON.stringify({ offers });
const offer = (id: string, extra: object = {}) => ({ id, title: `Offer ${id}`, url: `https://acme.com/${id}`, category: 'tech', ...extra });

async function listen(db: DB, cfg: Partial<ServerConfig> = {}): Promise<{ base: string; server: Server }> {
  const server = createServer(createHandler(db, { ...loadServerConfig({ APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv), cacheTtlMs: 0, ...cfg }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe('migration 002 upgrades an existing v1 database without data loss', () => {
  it('keeps feeds/offers through the feeds table rebuild and enforces FKs afterwards', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    copyFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), join(dir, '001_init.sql'));
    const db = openDb(':memory:');
    migrate(db, dir);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO advertisers (id, name, status, created_at, updated_at) VALUES ('a', 'A', 'active', ?, ?)").run(now, now);
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, last_success_at, created_at) VALUES ('f', 'a', 'merchant_tsv', 'x', ?, ?)").run(now, now);
    db.prepare("INSERT INTO offers (id, advertiser_id, feed_id, external_id, payload, category, status, content_hash, first_seen_at, last_seen_at, updated_at) VALUES ('f-1', 'a', 'f', '1', '{}', 'tech', 'active', 'h', ?, ?, ?)").run(now, now, now);
    assert.deepEqual(migrate(db), ['002_attribution_availability_analytics.sql', '003_verification_mapped_feeds_conversions.sql']);
    assert.equal((db.prepare("SELECT last_success_at FROM feeds WHERE id = 'f'").get() as { last_success_at: string }).last_success_at, now);
    assert.equal((db.prepare("SELECT count(*) AS n FROM offers").get() as { n: number }).n, 1);
    assert.throws(() => db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('g', 'missing', 'direct_json', 'x', ?)").run(now));
    assert.throws(() => db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, auth_env, created_at) VALUES ('h', 'a', 'direct_json', 'x', 'DB_PATH', ?)").run(now), 'auth_env must reference FEED_TOKEN_*');
  });
});

describe('authenticated partner feeds (offers_json_api)', () => {
  it('sends the bearer token from the named env var and never stores it', async () => {
    const db = freshDb();
    addAdvertiser(db);
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, auth_env, created_at) VALUES ('api', 'acme', 'offers_json_api', 'https://partner.acme.com/offers', 'FEED_TOKEN_ACME', ?)").run(new Date().toISOString());
    let auth: string | undefined;
    const r = await ingestFeed(db, 'api', { fetchImpl: fetchText(offersJson([offer('1')]), (i) => (auth = (i?.headers as Record<string, string>)?.Authorization)), env: { FEED_TOKEN_ACME: 's3cret' } });
    assert.equal(r.ok, true);
    assert.equal(auth, 'Bearer s3cret');
    const dump = JSON.stringify(db.prepare('SELECT * FROM feeds').all()) + JSON.stringify(db.prepare('SELECT * FROM ingestion_runs').all());
    assert.ok(!dump.includes('s3cret'));
  });
  it('fails clearly when the credential is missing, and refuses local files', async () => {
    const db = freshDb();
    addAdvertiser(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, auth_env, created_at) VALUES ('api', 'acme', 'offers_json_api', 'https://partner.acme.com/offers', 'FEED_TOKEN_ACME', ?)").run(now);
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('local', 'acme', 'offers_json_api', 'direct-offers.json', ?)").run(now);
    assert.match((await ingestFeed(db, 'api', { env: {} })).error!, /FEED_TOKEN_ACME is not set/);
    assert.match((await ingestFeed(db, 'local')).error!, /requires an https source/);
  });
  it('advertisers cannot override their identity, sponsorship or demo flags from the feed', async () => {
    const db = freshDb();
    addAdvertiser(db, 'acme', { network: 'awin' });
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('d', 'acme', 'direct_json', 'https://acme.com/f.json', ?)").run(new Date().toISOString());
    await ingestFeed(db, 'd', { fetchImpl: fetchText(offersJson([offer('1', { advertiser: { id: 'evil', name: 'Apple' }, sponsored: false, demo: false, campaign: { id: 'xmas-26' } })])) });
    const p = JSON.parse((db.prepare('SELECT payload FROM offers').get() as { payload: string }).payload);
    assert.equal(p.advertiser.name, 'Acme');
    assert.equal(p.advertiser.id, 'acme');
    assert.deepEqual(p.campaign, { id: 'xmas-26', network: 'awin' });
  });
});

describe('availability, verification and attribution via the API', () => {
  let db: DB;
  let base: string;
  let server: Server;
  before(async () => {
    db = freshDb();
    addAdvertiser(db, 'acme', { attribution: 'utm_source=onlyads&utm_campaign={campaign}&oa_click={click_id}', network: 'direct' });
    db.prepare("INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES ('d', 'acme', 'direct_json', 'https://acme.com/f.json', ?)").run(new Date().toISOString());
    await ingestFeed(db, 'd', {
      fetchImpl: fetchText(
        offersJson([offer('us', { availability: { countries: ['us'] }, campaign: { id: 'fall' } }), offer('co', { availability: { countries: ['CO', 'MX'] } }), offer('any', { url: 'https://acme.com/any?ref=x#top' })]),
      ),
    });
    ({ base, server } = await listen(db));
  });
  after(() => server.close());

  it('filters by country and leaves unrestricted offers visible', async () => {
    const ids = async (qs: string) => (await (await fetch(`${base}/v1/offers${qs}`)).json()).offers.map((o: { id: string }) => o.id).sort();
    assert.deepEqual(await ids('?country=US'), ['d-any', 'd-us']);
    assert.deepEqual(await ids('?country=CO'), ['d-any', 'd-co']);
    assert.deepEqual(await ids(''), ['d-any', 'd-co', 'd-us']);
    assert.equal((await fetch(`${base}/v1/offers?country=usa`)).status, 400);
  });

  it('reports verifiedAt as the last time ingestion saw the offer', async () => {
    const seen = (db.prepare("SELECT last_seen_at FROM offers WHERE id = 'd-us'").get() as { last_seen_at: string }).last_seen_at;
    const o = (await (await fetch(`${base}/v1/offers?country=US`)).json()).offers.find((x: { id: string }) => x.id === 'd-us');
    assert.equal(o.verifiedAt, seen);
  });

  it('adds authorized attribution params and records an anonymous click event', async () => {
    const r = await fetch(`${base}/v1/click/d-us`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location')!;
    assert.match(loc, /^https:\/\/acme\.com\/us\?utm_source=onlyads&utm_campaign=fall&oa_click=[0-9a-f]{24}$/);
    const ev = db.prepare('SELECT * FROM click_events').get() as Record<string, unknown>;
    assert.equal(ev.click_id, loc.split('oa_click=')[1]);
    assert.deepEqual(Object.keys(ev).sort(), ['advertiser_id', 'campaign_id', 'click_id', 'created_at', 'network', 'offer_id']);
    const r2 = await fetch(`${base}/v1/click/d-any`, { redirect: 'manual' });
    assert.match(r2.headers.get('location')!, /^https:\/\/acme\.com\/any\?ref=x&utm_source=onlyads&utm_campaign=acme&oa_click=[0-9a-f]+#top$/);
  });

  it('accepts only allow-listed analytics, aggregated without identifiers', async () => {
    const post = (path: string, body: unknown, ct = 'application/json') => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': ct }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const r = await post('/v1/events', { events: [{ name: 'offer_click', props: { category: 'tech', source: 'direct', userId: 'u-123' } }, { name: 'offer_click', props: { source: 'direct', category: 'tech' } }, { name: 'steal_data', props: {} }, { name: 'search', props: { results_bucket: 'jane@doe.com' } }] });
    assert.equal(r.status, 202);
    assert.equal((await r.json()).accepted, 3);
    const rows = db.prepare('SELECT name, dims, count FROM event_counts ORDER BY name').all().map((x) => ({ ...x }));
    assert.deepEqual(rows, [{ name: 'offer_click', dims: 'category=tech;source=direct', count: 2 }, { name: 'search', dims: '', count: 1 }]);
    assert.equal((await post('/v1/events', 'x', 'text/plain')).status, 415);
    assert.equal((await post('/v1/events', '{bad')).status, 400);
    assert.equal((await post('/v1/events', { events: new Array(51).fill({ name: 'app_open' }) })).status, 400);
    assert.equal((await post('/v1/events', { events: [{ name: 'app_open', props: { pad: 'x'.repeat(20_000) } }] })).status, 413);
    assert.equal((await fetch(`${base}/v1/events`)).status, 405);
  });

  it('counts impressions only for real, active offers', async () => {
    const r = await fetch(`${base}/v1/impressions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerIds: ['d-us', 'd-us', 'nope', 'd-co'] }) });
    assert.equal((await r.json()).accepted, 2);
    assert.equal((db.prepare('SELECT count(*) AS n FROM impression_counts').get() as { n: number }).n, 2);
  });
});

describe('tracking templates', () => {
  const v = { click_id: 'c1', campaign: 'camp', offer_id: 'o1' };
  it('rejects anything but key=literal|placeholder pairs', () => {
    assert.equal(applyTrackingTemplate('https://a.com/p', 'utm=<script>', v), undefined);
    assert.equal(applyTrackingTemplate('https://a.com/p', 'a=b=c', v), undefined);
    assert.equal(applyTrackingTemplate('https://a.com/p', 'x={user_email}', v), undefined);
    assert.equal(applyTrackingTemplate('https://a.com/p', 'Bad-Key=1', v), undefined);
  });
  it('never overwrites parameters the advertiser already put on the link', () => {
    assert.equal(applyTrackingTemplate('https://a.com/p?utm_source=theirs', 'utm_source=onlyads&c={campaign}', v), 'https://a.com/p?utm_source=theirs&c=camp');
  });
});

describe('data retention', () => {
  it('purges click events after 90 days and aggregates after ~13 months', () => {
    const db = freshDb();
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    db.prepare("INSERT INTO click_events (click_id, offer_id, advertiser_id, created_at) VALUES ('old', 'o', 'a', ?), ('new', 'o', 'a', ?)").run(old, new Date().toISOString());
    db.prepare("INSERT INTO event_counts (day, name, dims, count) VALUES ('2020-01-01', 'app_open', '', 5)").run();
    const r = purgeExpiredData(db);
    assert.deepEqual(r, { clickEvents: 1, aggregates: 1 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM click_events').get() as { n: number }).n, 1);
  });
});
