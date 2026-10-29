/**
 * HTTP API (framework-free, node:http). Public, read-only, unauthenticated —
 * there is nothing user-specific to protect, so the controls are about abuse:
 * strict input validation, rate limits, bounded responses, short caching,
 * security headers, and no personal data in logs.
 *
 *   GET  /health                 → liveness + DB check
 *   GET  /v1/offers              → { offers, nextCursor }   (?lat&lng&country&category&limit&cursor)
 *   GET  /v1/feed                → same shape, ranked over the whole catalog (server/rank.ts)
 *                                  (+ &interests=a,b&affinity=cat:bucket,… — used per request, never stored)
 *   GET  /v1/click/:offerId      → 302 to the advertiser (re-validated), counts the click,
 *                                  adds authorized attribution params when the advertiser opted in
 *   POST /v1/events              → aggregate product analytics (allow-listed, no identifiers)
 *   POST /v1/impressions         → aggregate ad view counts per offer per day
 *   GET|POST /v1/postbacks/:network → partner-reported conversions (server/conversions.ts), token-authenticated
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { hostMatchesDomain, parseSafeHttpsUrl } from '@/services/urlSafety';
import { CATEGORIES } from '@/data/categories';
import type { CategoryId } from '@/types/offer';
import { dimsKey, sanitizeEvent } from '@/services/analyticsSchema';
import { tx, type DB } from './db';
import { log } from './log';
import { NETWORK_RE, postbackEnvName, recordPostback, tokenMatches } from './conversions';
import { AFFINITY_BUCKETS, Catalog, MAX_RANKED, type FeedQuery } from './rank';
import { RateLimiter } from './rateLimit';

export interface ServerConfig {
  env: 'development' | 'staging' | 'production';
  includeDemo: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
  feedStaleHours: number;
  cacheTtlMs: number;
  rateLimit: { capacity: number; refillPerSec: number };
  clickRateLimit: { capacity: number; refillPerSec: number };
  eventRateLimit: { capacity: number; refillPerSec: number };
  /** POSTBACK_TOKEN_<NETWORK> values keyed by env var name. Server secret store only. */
  postbackTokens: Record<string, string>;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appEnv = env.APP_ENV === 'production' || env.APP_ENV === 'staging' ? env.APP_ENV : 'development';
  return {
    env: appEnv,
    // Demo advertisers are never served in production unless explicitly forced.
    includeDemo: appEnv === 'production' ? env.INCLUDE_DEMO === 'force' : env.INCLUDE_DEMO !== '0',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1',
    feedStaleHours: Number(env.FEED_STALE_HOURS ?? 48),
    cacheTtlMs: Number(env.CACHE_TTL_MS ?? 60_000),
    rateLimit: { capacity: Number(env.RATE_BURST ?? 30), refillPerSec: Number(env.RATE_PER_SEC ?? 1) },
    clickRateLimit: { capacity: 20, refillPerSec: 0.5 },
    eventRateLimit: { capacity: 20, refillPerSec: 0.2 },
    postbackTokens: Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => /^POSTBACK_TOKEN_[A-Z0-9_]+$/.test(e[0]) && !!e[1])),
  };
}

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_LIMIT = 50;
const LOCAL_RADIUS_KM = 50;

class BadRequest extends Error {}

function num(v: string | null, min: number, max: number, name: string): number | undefined {
  if (v === null || v === '') return undefined;
  if (!/^-?\d{1,3}(\.\d{1,6})?$/.test(v)) throw new BadRequest(`invalid ${name}`);
  const n = Number(v);
  if (n < min || n > max) throw new BadRequest(`${name} out of range`);
  return n;
}

export function parseOffersQuery(sp: URLSearchParams) {
  for (const k of sp.keys()) if (!['lat', 'lng', 'country', 'category', 'limit', 'cursor'].includes(k)) throw new BadRequest(`unknown parameter ${k}`);
  const country = sp.get('country') ?? undefined;
  if (country !== undefined && !/^[A-Z]{2}$/.test(country)) throw new BadRequest('invalid country');
  const lat = num(sp.get('lat'), -90, 90, 'lat');
  const lng = num(sp.get('lng'), -180, 180, 'lng');
  if ((lat === undefined) !== (lng === undefined)) throw new BadRequest('lat and lng must be provided together');
  const category = sp.get('category') ?? undefined;
  if (category !== undefined && !CATEGORY_IDS.has(category)) throw new BadRequest('invalid category');
  const limitRaw = sp.get('limit');
  const limit = limitRaw === null ? MAX_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new BadRequest('limit must be 1-50');
  let after: string | undefined;
  const cursor = sp.get('cursor');
  if (cursor) {
    if (cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new BadRequest('invalid cursor');
    after = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!ID_RE.test(after)) throw new BadRequest('invalid cursor');
  }
  // Round to ~1 km server-side too, whatever the client sent.
  const r = (n?: number) => (n === undefined ? undefined : Math.round(n * 100) / 100);
  return { lat: r(lat), lng: r(lng), country, category, limit, after };
}

/** /v1/feed parameters. Interests/affinity are bounded and coarse; unknown values are rejected, not guessed. */
export function parseFeedQuery(sp: URLSearchParams): FeedQuery {
  const base = new URLSearchParams();
  for (const [k, v] of sp) {
    if (k === 'interests' || k === 'affinity' || k === 'cursor') continue;
    base.append(k, v);
  }
  const { lat, lng, country, category, limit } = parseOffersQuery(base);
  const interests = [...new Set((sp.get('interests') ?? '').split(',').filter(Boolean))].sort();
  if (interests.length > CATEGORY_IDS.size || interests.some((c) => !CATEGORY_IDS.has(c))) throw new BadRequest('invalid interests');
  const affinity: FeedQuery['affinity'] = {};
  for (const pair of (sp.get('affinity') ?? '').split(',').filter(Boolean)) {
    const [cat, b] = pair.split(':');
    if (!CATEGORY_IDS.has(cat) || !(b in AFFINITY_BUCKETS) || cat in affinity) throw new BadRequest('invalid affinity');
    affinity[cat as CategoryId] = AFFINITY_BUCKETS[b];
  }
  let offset = 0;
  const cursor = sp.get('cursor');
  if (cursor) {
    const m = /^f1\.[a-z0-9]{1,12}\.(\d{1,4})$/.exec(cursor.length < 40 ? Buffer.from(cursor, 'base64url').toString('utf8') : '');
    if (!m || Number(m[1]) > MAX_RANKED) throw new BadRequest('invalid cursor');
    offset = Number(m[1]);
  }
  // Sorted keys → identical preferences share one cache entry.
  const sortedAffinity = Object.fromEntries(Object.entries(affinity).sort()) as FeedQuery['affinity'];
  return { lat, lng, country, category: category as CategoryId | undefined, interests: interests as CategoryId[], affinity: sortedAffinity, limit, offset };
}

export function createHandler(db: DB, cfg: ServerConfig) {
  const catalog = new Catalog(db, { feedStaleHours: cfg.feedStaleHours, includeDemo: cfg.includeDemo, ttlMs: cfg.cacheTtlMs });
  const limiter = new RateLimiter(cfg.rateLimit);
  const clickLimiter = new RateLimiter(cfg.clickRateLimit);
  const cache = new Map<string, { body: string; expires: number }>();

  const eventLimiter = new RateLimiter(cfg.eventRateLimit);
  const postbackLimiter = new RateLimiter({ capacity: 100, refillPerSec: 10 });

  // verifiedAt is the last time our ingestion actually saw the offer in the advertiser's feed.
  const offersStmt = (withGeo: boolean, withCountry: boolean, withCategory: boolean, withAfter: boolean) =>
    db.prepare(`
      SELECT o.id, json_set(o.payload, '$.verifiedAt', o.last_seen_at) AS payload FROM offers o
      JOIN advertisers a ON a.id = o.advertiser_id
      LEFT JOIN feeds f ON f.id = o.feed_id
      WHERE o.status = 'active' AND a.status = 'active'
        AND (o.expires_at IS NULL OR o.expires_at > ?)
        AND (o.starts_at IS NULL OR o.starts_at <= ?)
        AND (o.feed_id IS NULL OR (f.enabled = 1 AND f.last_success_at > ?))
        AND (? = 1 OR a.is_demo = 0)
        ${withGeo ? 'AND (o.lat IS NULL OR (o.lat BETWEEN ? AND ? AND o.lng BETWEEN ? AND ?))' : 'AND o.lat IS NULL'}
        ${withCountry ? 'AND (o.countries IS NULL OR EXISTS (SELECT 1 FROM json_each(o.countries) WHERE value = ?))' : ''}
        ${withCategory ? 'AND o.category = ?' : ''}
        ${withAfter ? 'AND o.id > ?' : ''}
      ORDER BY o.id
      LIMIT ?`);

  function queryOffers(q: ReturnType<typeof parseOffersQuery>, now: Date) {
    const nowIso = now.toISOString();
    const freshAfter = new Date(now.getTime() - cfg.feedStaleHours * 3600_000).toISOString();
    const params: (string | number)[] = [nowIso, nowIso, freshAfter, cfg.includeDemo ? 1 : 0];
    const withGeo = q.lat !== undefined && q.lng !== undefined;
    if (withGeo) {
      const dLat = LOCAL_RADIUS_KM / 110.574;
      const dLng = LOCAL_RADIUS_KM / (111.32 * Math.max(0.01, Math.cos((q.lat! * Math.PI) / 180)));
      params.push(q.lat! - dLat, q.lat! + dLat, q.lng! - dLng, q.lng! + dLng);
    }
    if (q.country) params.push(q.country);
    if (q.category) params.push(q.category);
    if (q.after) params.push(q.after);
    params.push(q.limit + 1);
    const rows = offersStmt(withGeo, !!q.country, !!q.category, !!q.after).all(...params) as { id: string; payload: string }[];
    const page = rows.slice(0, q.limit);
    const nextCursor = rows.length > q.limit ? Buffer.from(page[page.length - 1].id).toString('base64url') : null;
    // Payload strings are already validated JSON; splice them in without re-parsing.
    return `{"offers":[${page.map((r) => r.payload).join(',')}],"nextCursor":${JSON.stringify(nextCursor)}}`;
  }

  const upsertEvent = db.prepare('INSERT INTO event_counts (day, name, dims, count) VALUES (?, ?, ?, 1) ON CONFLICT (day, name, dims) DO UPDATE SET count = count + 1');
  const upsertImpression = db.prepare('INSERT INTO impression_counts (offer_id, day, count) VALUES (?, ?, 1) ON CONFLICT (offer_id, day) DO UPDATE SET count = count + 1');
  const offerExists = db.prepare("SELECT 1 FROM offers WHERE id = ? AND status = 'active'");

  /** Returns number of accepted events, or -1 for a malformed payload. */
  function recordEvents(body: unknown): number {
    const events = (body as { events?: unknown })?.events;
    if (!Array.isArray(events) || events.length > 50) return -1;
    const day = new Date().toISOString().slice(0, 10);
    let n = 0;
    tx(db, () => {
      for (const e of events) {
        const clean = sanitizeEvent((e as { name?: unknown })?.name, (e as { props?: unknown })?.props);
        if (!clean) continue;
        upsertEvent.run(day, clean.name, dimsKey(clean.props));
        n++;
      }
    });
    return n;
  }

  /** Counts views per offer per day; ignores unknown/inactive offers so junk can't create rows. */
  function recordImpressions(body: unknown): number {
    const ids = (body as { offerIds?: unknown })?.offerIds;
    if (!Array.isArray(ids) || ids.length > 100) return -1;
    const day = new Date().toISOString().slice(0, 10);
    let n = 0;
    tx(db, () => {
      for (const id of new Set(ids)) {
        if (typeof id !== 'string' || !ID_RE.test(id) || !offerExists.get(id)) continue;
        upsertImpression.run(id, day);
        n++;
      }
    });
    return n;
  }

  function clientKey(req: IncomingMessage): string {
    if (cfg.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(body);
  }

  return function handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    const reqId = randomUUID();
    let route = 'other';
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (cfg.env !== 'development') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.on('finish', () => log('info', 'request', { reqId, route, method: req.method, status: res.statusCode, ms: Date.now() - started }));

    const origin = req.headers.origin;
    if (origin && cfg.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    try {
      if ((req.url ?? '').length > 2048) return send(res, 414, '{"error":"uri too long"}');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        return send(res, 204, '');
      }
      const url = new URL(req.url ?? '/', 'http://localhost');

      const postback = /^\/v1\/postbacks\/([a-z0-9-]{1,32})$/.exec(url.pathname);
      if (postback) {
        route = 'postback';
        const network = postback[1];
        const expected = NETWORK_RE.test(network) ? cfg.postbackTokens[postbackEnvName(network)] : undefined;
        if (!expected) return send(res, 404, '{"error":"not found"}');
        if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, '{"error":"method not allowed"}', { Allow: 'GET, POST' });
        const wait = postbackLimiter.take(network);
        if (wait) return send(res, 429, '{"error":"rate limited"}', { 'Retry-After': String(wait) });
        const handlePostback = (params: URLSearchParams) => {
          const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? params.get('token') ?? undefined;
          if (!tokenMatches(expected, auth)) return send(res, 401, '{"error":"unauthorized"}', { 'Cache-Control': 'no-store' });
          const r = recordPostback(db, network, params);
          if ('error' in r) log('warn', 'postback rejected', { network, reason: r.error });
          return send(res, r.http, JSON.stringify(r), { 'Cache-Control': 'no-store' });
        };
        if (req.method === 'GET') return handlePostback(url.searchParams);
        if (!/^application\/x-www-form-urlencoded\b/.test(req.headers['content-type'] ?? '')) return send(res, 415, '{"error":"content-type must be application/x-www-form-urlencoded"}');
        readBody(req, 4096)
          .then((raw) => handlePostback(new URLSearchParams(raw)))
          .catch(() => send(res, 413, '{"error":"payload too large"}', { Connection: 'close' }));
        return;
      }
      const isPost = url.pathname === '/v1/events' || url.pathname === '/v1/impressions';
      if (isPost ? req.method !== 'POST' : req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, '{"error":"method not allowed"}', { Allow: isPost ? 'POST' : 'GET, HEAD' });
      }

      if (isPost) {
        route = url.pathname === '/v1/events' ? 'events' : 'impressions';
        const wait = eventLimiter.take(clientKey(req));
        if (wait) return send(res, 429, '{"error":"rate limited"}', { 'Retry-After': String(wait) });
        if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return send(res, 415, '{"error":"content-type must be application/json"}');
        readBody(req, 16 * 1024)
          .then((raw) => {
            let body: unknown;
            try {
              body = JSON.parse(raw);
            } catch {
              return send(res, 400, '{"error":"invalid json"}');
            }
            const accepted = route === 'events' ? recordEvents(body) : recordImpressions(body);
            if (accepted < 0) return send(res, 400, '{"error":"invalid payload"}');
            return send(res, 202, JSON.stringify({ accepted }));
          })
          .catch((e: Error) => send(res, e.message === 'too large' ? 413 : 400, JSON.stringify({ error: e.message === 'too large' ? 'payload too large' : 'bad request' }), { Connection: 'close' }));
        return;
      }

      if (url.pathname === '/health') {
        route = 'health';
        db.prepare('SELECT 1').get();
        return send(res, 200, '{"ok":true}', { 'Cache-Control': 'no-store' });
      }

      const key = clientKey(req);

      if (url.pathname === '/v1/offers') {
        route = 'offers';
        const wait = limiter.take(key);
        if (wait) return send(res, 429, '{"error":"rate limited"}', { 'Retry-After': String(wait) });
        const q = parseOffersQuery(url.searchParams);
        const cacheKey = JSON.stringify(q);
        const hit = cache.get(cacheKey);
        const now = Date.now();
        let body: string;
        if (hit && hit.expires > now) body = hit.body;
        else {
          body = queryOffers(q, new Date(now));
          cache.set(cacheKey, { body, expires: now + cfg.cacheTtlMs });
          if (cache.size > 2000) cache.delete(cache.keys().next().value!);
        }
        return send(res, 200, body, { 'Cache-Control': `public, max-age=${Math.round(cfg.cacheTtlMs / 1000)}` });
      }

      if (url.pathname === '/v1/feed') {
        route = 'feed';
        const wait = limiter.take(key);
        if (wait) return send(res, 429, '{"error":"rate limited"}', { 'Retry-After': String(wait) });
        const q = parseFeedQuery(url.searchParams);
        const now = new Date();
        const page = catalog.page(q, now);
        const version = catalog.snapshot(now).version;
        const nextCursor = page.nextOffset === null ? null : Buffer.from(`f1.${version}.${page.nextOffset}`).toString('base64url');
        // Personalized by query params only (no cookies/identity), so caches may key on the URL — but keep it private.
        return send(res, 200, JSON.stringify({ offers: page.offers, nextCursor }), { 'Cache-Control': `private, max-age=${Math.round(cfg.cacheTtlMs / 1000)}` });
      }

      const click = /^\/v1\/click\/([^/]+)$/.exec(url.pathname);
      if (click) {
        route = 'click';
        const wait = clickLimiter.take(key);
        if (wait) return send(res, 429, '{"error":"rate limited"}', { 'Retry-After': String(wait) });
        let id: string;
        try {
          id = decodeURIComponent(click[1]);
        } catch {
          throw new BadRequest('invalid id');
        }
        if (!ID_RE.test(id)) throw new BadRequest('invalid id');
        const nowIso = new Date().toISOString();
        const row = db
          .prepare(
            `SELECT o.payload, a.allowed_domains, a.id AS advertiser_id, a.attribution_enabled, a.tracking_template, a.network FROM offers o JOIN advertisers a ON a.id = o.advertiser_id
             WHERE o.id = ? AND o.status = 'active' AND a.status = 'active' AND (o.expires_at IS NULL OR o.expires_at > ?) AND (? = 1 OR a.is_demo = 0)`,
          )
          .get(id, nowIso, cfg.includeDemo ? 1 : 0) as { payload: string; allowed_domains: string; advertiser_id: string; attribution_enabled: number; tracking_template: string | null; network: string | null } | undefined;
        const target = row ? (JSON.parse(row.payload) as { url: string }).url : undefined;
        const parsed = target ? parseSafeHttpsUrl(target) : undefined;
        const allowed = row ? (JSON.parse(row.allowed_domains) as string[]) : [];
        if (!row || !parsed || !allowed.some((d) => hostMatchesDomain(parsed.host, d))) {
          res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Offer unavailable</title><p style="font-family:system-ui;padding:24px">This offer is no longer available.</p>');
        }
        db.prepare('INSERT INTO click_counts (offer_id, day, count) VALUES (?, ?, 1) ON CONFLICT (offer_id, day) DO UPDATE SET count = count + 1').run(id, nowIso.slice(0, 10));
        let location = target!;
        if (row.attribution_enabled) {
          // Attribution only for advertisers that opted in. A click is recorded as a click — never as a purchase.
          const clickId = randomBytes(12).toString('hex');
          const payload = JSON.parse(row.payload) as { campaign?: { id?: string; network?: string } };
          const campaign = payload.campaign?.id ?? row.advertiser_id;
          const tracked = applyTrackingTemplate(target!, row.tracking_template, { click_id: clickId, campaign, offer_id: id });
          const trackedHost = tracked ? parseSafeHttpsUrl(tracked) : undefined;
          if (tracked && trackedHost && trackedHost.host === parsed.host) {
            location = tracked;
            db.prepare('INSERT INTO click_events (click_id, offer_id, advertiser_id, campaign_id, network, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(clickId, id, row.advertiser_id, campaign, payload.campaign?.network ?? row.network ?? null, nowIso);
          }
        }
        res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
        return res.end();
      }

      return send(res, 404, '{"error":"not found"}');
    } catch (e) {
      if (e instanceof BadRequest) return send(res, 400, JSON.stringify({ error: e.message }));
      log('error', 'unhandled', { reqId, route, error: e instanceof Error ? e.message : String(e) });
      return send(res, 500, JSON.stringify({ error: 'internal error', requestId: reqId }));
    }
  };
}


/** Read a request body with a hard size cap. */
function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (over) return; // keep draining so the client receives our 413 instead of a reset
      size += c.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        reject(new Error('too large'));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const TEMPLATE_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const PLACEHOLDERS: Record<string, keyof TrackingValues> = { '{click_id}': 'click_id', '{campaign}': 'campaign', '{offer_id}': 'offer_id' };
interface TrackingValues {
  click_id: string;
  campaign: string;
  offer_id: string;
}

/**
 * Append the advertiser's authorized query parameters to the landing URL.
 * Template: "utm_source=onlyads&utm_campaign={campaign}&oa_click={click_id}".
 * Values may be literals ([A-Za-z0-9._-]) or one of the placeholders. Existing
 * params on the landing URL are kept; template keys never overwrite them.
 * Returns undefined when the template is invalid (the click then goes out untracked).
 */
export function applyTrackingTemplate(target: string, template: string | null, values: TrackingValues): string | undefined {
  if (!template) return undefined;
  const hashAt = target.indexOf('#');
  const base = hashAt >= 0 ? target.slice(0, hashAt) : target;
  const hash = hashAt >= 0 ? target.slice(hashAt) : '';
  const existing = new Set((base.split('?')[1] ?? '').split('&').map((p) => p.split('=')[0]).filter(Boolean));
  const add: string[] = [];
  for (const pair of template.split('&')) {
    const [k, v, extra] = pair.split('=');
    if (extra !== undefined || !k || v === undefined || !TEMPLATE_KEY.test(k)) return undefined;
    const value = PLACEHOLDERS[v] ? values[PLACEHOLDERS[v]] : /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : undefined;
    if (value === undefined) return undefined;
    if (!existing.has(k)) add.push(`${k}=${encodeURIComponent(value)}`);
  }
  if (!add.length) return target;
  return `${base}${base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?'}${add.join('&')}${hash}`;
}

/** Data retention: click events (attribution window) 90 days; aggregates ~13 months. */
export function purgeExpiredData(db: DB, now: Date = new Date()): { clickEvents: number; aggregates: number } {
  const clickCutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const dayCutoff = new Date(now.getTime() - 400 * 86_400_000).toISOString().slice(0, 10);
  const a = db.prepare('DELETE FROM click_events WHERE created_at < ?').run(clickCutoff);
  let agg = 0;
  for (const t of ['click_counts', 'impression_counts', 'event_counts']) agg += Number(db.prepare(`DELETE FROM ${t} WHERE day < ?`).run(dayCutoff).changes);
  return { clickEvents: Number(a.changes), aggregates: agg };
}
