/**
 * Feed ingestion. Runs on a schedule (server/index.ts) or on demand (cli).
 * - Fetches with timeout + size cap (https only); local files allowed for dev seeding.
 * - Every item: parse → validate → policy → upsert by (feed_id, external_id).
 * - Items missing from the latest successful run are deactivated (no stale promos).
 * - A failed run keeps previous offers; the API stops serving a feed's offers
 *   once its last success is older than FEED_STALE_HOURS.
 * - Human review decisions stick until the item's content changes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, relative } from 'node:path';

import { validateOffer } from '@/services/offerValidation';
import { hostMatchesDomain, isSafeHttpsUrl, parseSafeHttpsUrl } from '@/services/urlSafety';
import { tx, type DB } from './db';
import { log } from './log';
import { getAdapter, validateMapping, type FeedMapping } from './adapters';
import { evaluateOffer, type AdvertiserPolicyInfo } from './policy';

export const DATA_DIR = join(__dirname, 'data');
const MAX_FEED_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_ITEMS = 50_000;

interface FeedRow {
  id: string;
  advertiser_id: string;
  kind: string;
  source: string;
  auth_env: string | null;
  mapping: string | null;
}
interface AdvertiserRow {
  id: string;
  name: string;
  status: AdvertiserPolicyInfo['status'];
  allowed_domains: string;
  sponsored: number;
  affiliate: number;
  is_demo: number;
  network: string | null;
  verify_domain?: string | null;
  domain_verified_at?: string | null;
}

export interface IngestResult {
  feedId: string;
  ok: boolean;
  seen: number;
  upserted: number;
  rejected: number;
  review: number;
  deactivated: number;
  error?: string;
}

async function readSource(source: string, fetchImpl: typeof fetch, opts: { token?: string; remoteOnly?: boolean } = {}): Promise<string> {
  if (source.startsWith('https://')) {
    if (!isSafeHttpsUrl(source)) throw new Error('feed URL failed safety checks');
    const headers: Record<string, string> = { Accept: 'application/json, text/tab-separated-values, text/csv, */*' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetchImpl(source, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error', headers });
    if (!res.ok || !res.body) throw new Error(`feed HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_FEED_BYTES) throw new Error('feed too large');
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('feed too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (opts.remoteOnly) throw new Error('this feed kind requires an https source');
  // Local file: must stay inside server/data (no path traversal).
  const p = normalize(isAbsolute(source) ? source : join(DATA_DIR, source));
  const rel = relative(DATA_DIR, p);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('local feed must be inside server/data');
  return readFileSync(p, 'utf8');
}

/** Turn a feed's raw text into candidate offers via its adapter (validated later). */
export function parseFeed(kind: string, text: string, feedId: string, adv: AdvertiserRow, now: Date, mapping?: FeedMapping): unknown[] {
  return getAdapter(kind).parse(text, {
    feedId,
    now,
    mapping,
    verifiedDomain: verifiedDomainOf(adv),
    advertiser: { id: adv.id, name: adv.name, status: adv.status, sponsored: !!adv.sponsored, affiliate: !!adv.affiliate, isDemo: !!adv.is_demo, network: adv.network ?? undefined },
  });
}

function verifiedDomainOf(adv: AdvertiserRow): string | undefined {
  return adv.domain_verified_at && adv.verify_domain ? adv.verify_domain : undefined;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export async function ingestFeed(db: DB, feedId: string, opts: { now?: Date; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const feed = db.prepare('SELECT id, advertiser_id, kind, source, auth_env, mapping FROM feeds WHERE id = ? AND enabled = 1').get(feedId) as FeedRow | undefined;
  if (!feed) throw new Error(`feed ${feedId} not found or disabled`);
  const adv = db.prepare('SELECT * FROM advertisers WHERE id = ?').get(feed.advertiser_id) as unknown as AdvertiserRow;
  const runId = Number(db.prepare("INSERT INTO ingestion_runs (feed_id, started_at, status) VALUES (?, ?, 'running')").run(feedId, iso).lastInsertRowid);
  const result: IngestResult = { feedId, ok: false, seen: 0, upserted: 0, rejected: 0, review: 0, deactivated: 0 };

  try {
    // Credentials are referenced by env var name only (FEED_TOKEN_*); never stored in the DB or logged.
    let token: string | undefined;
    if (feed.auth_env) {
      if (!/^FEED_TOKEN_[A-Z0-9_]+$/.test(feed.auth_env)) throw new Error('invalid credential reference');
      token = (opts.env ?? process.env)[feed.auth_env];
      if (!token) throw new Error(`credential ${feed.auth_env} is not set on the server`);
    }
    const adapter = getAdapter(feed.kind);
    const mapping = validateMapping(feed.kind, feed.mapping ? JSON.parse(feed.mapping) : undefined);
    if (adapter.requiresVerifiedDomain) {
      // Checked before fetching: we only read catalogs from merchants who proved they own the store.
      const domain = verifiedDomainOf(adv);
      const host = parseSafeHttpsUrl(feed.source)?.host;
      if (!domain) throw new Error('advertiser has not verified its domain (admin: advertiser:verify-start / verify-check)');
      if (!host || !hostMatchesDomain(host, domain)) throw new Error(`feed source must be on the verified domain ${domain}`);
    }
    const text = await readSource(feed.source, opts.fetchImpl ?? fetch, { token, remoteOnly: adapter.remoteOnly });
    const candidates = parseFeed(feed.kind, text, feed.id, adv, now, mapping).slice(0, MAX_ITEMS);
    const policyInfo: AdvertiserPolicyInfo = { status: adv.status, allowedDomains: JSON.parse(adv.allowed_domains) as string[] };

    const getExisting = db.prepare('SELECT content_hash, status, first_seen_at FROM offers WHERE id = ?');
    const upsert = db.prepare(`
      INSERT INTO offers (id, advertiser_id, feed_id, external_id, payload, category, lat, lng, starts_at, expires_at, status, review_reason, content_hash, first_seen_at, last_seen_at, updated_at, countries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET payload = excluded.payload, category = excluded.category, lat = excluded.lat, lng = excluded.lng, countries = excluded.countries,
        starts_at = excluded.starts_at, expires_at = excluded.expires_at, status = excluded.status, review_reason = excluded.review_reason,
        content_hash = excluded.content_hash, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`);
    const touch = db.prepare('UPDATE offers SET last_seen_at = ? WHERE id = ?');

    tx(db, () => {
      const seenIds = new Set<string>();
      for (const c of candidates) {
        result.seen++;
        const o = validateOffer(c, now);
        if (!o || seenIds.has(o.id)) {
          result.rejected++;
          continue;
        }
        seenIds.add(o.id);
        // Hash only meaningful content (not timestamps) so unchanged items are skipped
        // and human review decisions are not reset by every run.
        const h = hash(JSON.stringify({ ...o, createdAt: undefined }));
        const existing = getExisting.get(o.id) as { content_hash: string; status: string; first_seen_at: string } | undefined;
        const payload = JSON.stringify({ ...o, createdAt: existing?.first_seen_at ?? iso });
        if (existing && existing.content_hash === h) {
          // Unchanged: keep the previous (possibly human-reviewed) status.
          touch.run(iso, o.id);
          continue;
        }
        const d = evaluateOffer(o, policyInfo, now);
        const status = d.outcome === 'accept' ? 'active' : d.outcome === 'review' ? 'pending_review' : 'rejected';
        if (d.outcome === 'reject') result.rejected++;
        if (d.outcome === 'review') result.review++;
        const externalId = o.id.slice(feed.id.length + 1);
        upsert.run(o.id, adv.id, feed.id, externalId, payload, o.category, o.location?.lat ?? null, o.location?.lng ?? null, o.startsAt ?? null, o.expiresAt ?? null, status, d.outcome === 'accept' ? null : d.reason, h, iso, iso, iso, o.availability?.countries?.length ? JSON.stringify(o.availability.countries) : null);
        result.upserted++;
      }
      // Anything not in this run is gone from the advertiser's feed: stop serving it.
      const gone = db.prepare("UPDATE offers SET status = 'inactive', updated_at = ? WHERE feed_id = ? AND last_seen_at < ? AND status != 'inactive'").run(iso, feed.id, iso);
      result.deactivated = Number(gone.changes);
      db.prepare('UPDATE feeds SET last_run_at = ?, last_success_at = ?, last_error = NULL WHERE id = ?').run(iso, iso, feed.id);
    });
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message.slice(0, 300) : 'unknown error';
    db.prepare('UPDATE feeds SET last_run_at = ?, last_error = ? WHERE id = ?').run(iso, result.error, feed.id);
  }
  db.prepare('UPDATE ingestion_runs SET finished_at = ?, status = ?, items_seen = ?, items_upserted = ?, items_rejected = ?, items_review = ?, items_deactivated = ?, error = ? WHERE id = ?').run(
    new Date().toISOString(),
    result.ok ? 'success' : 'failed',
    result.seen,
    result.upserted,
    result.rejected,
    result.review,
    result.deactivated,
    result.error ?? null,
    runId,
  );
  log(result.ok ? 'info' : 'error', 'ingest', { ...result });
  return result;
}

export async function ingestAll(db: DB, opts: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<IngestResult[]> {
  const feeds = db.prepare('SELECT id FROM feeds WHERE enabled = 1 ORDER BY id').all() as { id: string }[];
  const out: IngestResult[] = [];
  for (const f of feeds) out.push(await ingestFeed(db, f.id, opts)); // sequential: bounded memory
  return out;
}
