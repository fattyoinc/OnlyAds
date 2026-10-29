/**
 * Admin CLI — the only way to change advertisers, feeds and moderation state.
 * There are deliberately no admin HTTP endpoints (smaller attack surface).
 * Run with: npm run admin -- <command> [args]   (uses DB_PATH like the server)
 */
import { readFileSync } from 'node:fs';

import { applyTrackingTemplate, purgeExpiredData } from './app';
import { ADAPTERS, validateMapping } from './adapters';
import { funnelReport, NETWORK_RE, postbackEnvName } from './conversions';
import { checkVerification, startVerification } from './verify';
import { backup, migrate, openDb, tx } from './db';
import { ingestAll, ingestFeed } from './ingest';
import { seedDemo } from './seed';
import { setSilent } from './log';

const DB_PATH = process.env.DB_PATH ?? 'server/onlyads.dev.db';
const [cmd, ...args] = process.argv.slice(2);
const db = openDb(DB_PATH);
migrate(db);
setSilent(true);
const now = () => new Date().toISOString();
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function need(v: string | undefined, name: string): string {
  if (!v) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return v;
}

const commands: Record<string, () => Promise<unknown> | unknown> = {
  help: () =>
    console.log(`Commands:
  advertiser:add <id> <name> <domain[,domain]> [--sponsored] [--affiliate]   (starts as pending)
  advertiser:approve <id>        activate; releases offers held only because the advertiser was new
  advertiser:suspend <id>        hide all of an advertiser's offers immediately
  advertiser:attribution <id> <template|off> [--network <name>]
                                 e.g. "utm_source=onlyads&utm_campaign={campaign}&oa_click={click_id}"
                                 (only with the advertiser's written authorization)
  advertiser:verify-start <id> <domain>   issue a token the merchant publishes at https://<domain>/.well-known/onlyads-verify.txt
  advertiser:verify-check <id>           fetch the file and mark the domain verified
  feed:add <id> <advertiserId> <kind> <https-url|data-path> [--auth FEED_TOKEN_NAME] [--mapping file.json]
                                 kinds: merchant_tsv, direct_json, offers_json_api, csv_mapped, shopify_products_json
  postback:url <network>         print the postback URL template to give a partner (token from POSTBACK_TOKEN_<NETWORK>)
  report [days]                  impressions → clicks → attributed conversions → confirmed revenue, per advertiser
  feed:disable <id>
  ingest [feedId]                run ingestion now (all feeds if omitted)
  review:list                    offers waiting for human review
  review:approve <offerId>       review:reject <offerId>
  stats                          counts by status, feed health, clicks, impressions, events (last 7 days)
  purge                          apply data retention now (click events 90d, aggregates ~13 months)
  backup <path.db>               consistent online backup (VACUUM INTO)
  seed:demo                      load fictional demo advertisers (dev/staging only)`),

  'advertiser:add': () => {
    const [id, name, domains] = [need(args[0], 'id'), need(args[1], 'name'), need(args[2], 'domains')];
    if (!ID_RE.test(id)) throw new Error('id must be lowercase letters, digits, dashes');
    const list = domains.split(',').map((d) => d.trim().toLowerCase());
    if (!list.every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) throw new Error('invalid domain');
    db.prepare(`INSERT INTO advertisers (id, name, status, allowed_domains, sponsored, affiliate, is_demo, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?)`).run(
      id, name, JSON.stringify(list), args.includes('--sponsored') ? 1 : 0, args.includes('--affiliate') ? 1 : 0, now(), now(),
    );
    console.log(`advertiser ${id} added (pending)`);
  },
  'advertiser:approve': () => {
    const id = need(args[0], 'id');
    tx(db, () => {
      db.prepare("UPDATE advertisers SET status = 'active', updated_at = ? WHERE id = ?").run(now(), id);
      const r = db.prepare("UPDATE offers SET status = 'active', review_reason = NULL, updated_at = ? WHERE advertiser_id = ? AND status = 'pending_review' AND review_reason = 'new advertiser'").run(now(), id);
      console.log(`advertiser ${id} active; ${r.changes} offers released`);
    });
  },
  'advertiser:suspend': () => {
    const id = need(args[0], 'id');
    db.prepare("UPDATE advertisers SET status = 'suspended', updated_at = ? WHERE id = ?").run(now(), id);
    console.log(`advertiser ${id} suspended (offers hidden immediately)`);
  },
  'feed:add': () => {
    const [id, adv, kind, source] = [need(args[0], 'id'), need(args[1], 'advertiserId'), need(args[2], 'kind'), need(args[3], 'source')];
    if (!ID_RE.test(id)) throw new Error('invalid feed id');
    if (!ADAPTERS[kind]) throw new Error(`kind must be one of: ${Object.keys(ADAPTERS).join(', ')}`);
    const ai = args.indexOf('--auth');
    const authEnv = ai > 0 ? args[ai + 1] : null;
    if (authEnv && !/^FEED_TOKEN_[A-Z0-9_]+$/.test(authEnv)) throw new Error('--auth must name an env var like FEED_TOKEN_ACME (the token itself goes in the server environment, never in the DB)');
    if (ADAPTERS[kind].remoteOnly && !source.startsWith('https://')) throw new Error(`${kind} feeds need an https source`);
    const mi = args.indexOf('--mapping');
    const mapping = validateMapping(kind, mi > 0 ? JSON.parse(readFileSync(need(args[mi + 1], 'mapping file'), 'utf8')) : undefined);
    db.prepare('INSERT INTO feeds (id, advertiser_id, kind, source, auth_env, mapping, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, adv, kind, source, authEnv, mapping ? JSON.stringify(mapping) : null, now());
    console.log(`feed ${id} added`);
  },
  'advertiser:attribution': () => {
    const [id, template] = [need(args[0], 'id'), need(args[1], 'template|off')];
    const ni = args.indexOf('--network');
    const network = ni > 0 ? args[ni + 1] : null;
    if (network && !/^[a-z0-9-]{1,32}$/.test(network)) throw new Error('invalid network name');
    if (template === 'off') {
      db.prepare('UPDATE advertisers SET attribution_enabled = 0, tracking_template = NULL, updated_at = ? WHERE id = ?').run(now(), id);
      console.log(`attribution disabled for ${id}`);
      return;
    }
    if (!applyTrackingTemplate('https://example.com/p', template, { click_id: 'x', campaign: 'c', offer_id: 'o' })) throw new Error('invalid template: use key=value pairs, values literal or {click_id} {campaign} {offer_id}');
    db.prepare('UPDATE advertisers SET attribution_enabled = 1, tracking_template = ?, network = COALESCE(?, network), updated_at = ? WHERE id = ?').run(template, network, now(), id);
    console.log(`attribution enabled for ${id}`);
  },
  'advertiser:verify-start': () => {
    const v = startVerification(db, need(args[0], 'id'), need(args[1], 'domain'));
    console.log(`Ask the merchant to publish this line:\n\n  ${v.body}\n\nat ${v.url} (plain text, no redirect), then run advertiser:verify-check ${args[0]}`);
  },
  'advertiser:verify-check': async () => {
    const r = await checkVerification(db, need(args[0], 'id'));
    console.log(r.ok ? 'domain verified' : `not verified: ${r.reason}`);
    if (!r.ok) process.exitCode = 1;
  },
  'postback:url': () => {
    const network = need(args[0], 'network');
    if (!NETWORK_RE.test(network)) throw new Error('invalid network name');
    const set = !!process.env[postbackEnvName(network)];
    console.log(`${process.env.PUBLIC_API_URL ?? 'https://<your-api>'}/v1/postbacks/${network}?transaction_id={TXN}&click_id={OA_CLICK}&status={STATUS}&commission={COMMISSION}&sale_amount={AMOUNT}&currency={CURRENCY}
Send the token as "Authorization: Bearer <token>" (or &token=). Token env var: ${postbackEnvName(network)} — ${set ? 'set' : 'NOT SET: the endpoint returns 404 until it is'}.
Placeholders in {} are the partner's macro names; map them in the partner's dashboard.`);
  },
  report: () => {
    const days = Number(args[0] ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error('days must be 1-400');
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const money = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => `${(v / 100).toFixed(2)} ${c}`).join(', ') || '0';
    console.log(`Last ${days} days. Clicks are not purchases; pending conversions are not revenue; reversed ones never count.`);
    console.table(
      funnelReport(db, since).map((r) => ({
        advertiser: r.advertiserId,
        impressions: r.impressions,
        clicks: r.clicks,
        'attributed conv.': r.attributedConversions,
        'confirmed conv.': r.confirmedConversions,
        reversed: r.reversedConversions,
        'confirmed revenue': money(r.confirmedRevenueMinor),
        'pending (not revenue)': money(r.pendingRevenueMinor),
      })),
    );
  },
  'feed:disable': () => {
    db.prepare('UPDATE feeds SET enabled = 0 WHERE id = ?').run(need(args[0], 'id'));
  },
  ingest: async () => console.table(args[0] ? [await ingestFeed(db, args[0])] : await ingestAll(db)),
  'review:list': () => console.table(db.prepare("SELECT id, advertiser_id, review_reason, json_extract(payload, '$.title') AS title, json_extract(payload, '$.url') AS url FROM offers WHERE status = 'pending_review' ORDER BY updated_at").all()),
  'review:approve': () => {
    const r = db.prepare("UPDATE offers SET status = 'active', review_reason = 'approved by reviewer', updated_at = ? WHERE id = ? AND status = 'pending_review'").run(now(), need(args[0], 'offerId'));
    console.log(r.changes ? 'approved' : 'not found / not pending');
  },
  'review:reject': () => {
    const r = db.prepare("UPDATE offers SET status = 'rejected', review_reason = 'rejected by reviewer', updated_at = ? WHERE id = ? AND status = 'pending_review'").run(now(), need(args[0], 'offerId'));
    console.log(r.changes ? 'rejected' : 'not found / not pending');
  },
  stats: () => {
    console.table(db.prepare('SELECT status, count(*) AS n FROM offers GROUP BY status').all());
    console.table(db.prepare('SELECT id, enabled, last_success_at, last_error FROM feeds').all());
    console.table(db.prepare(`SELECT c.offer_id, c.clicks, COALESCE(i.views, 0) AS views, CASE WHEN i.views > 0 THEN round(100.0 * c.clicks / i.views, 1) END AS ctr_pct
      FROM (SELECT offer_id, sum(count) AS clicks FROM click_counts WHERE day >= date('now', '-7 days') GROUP BY offer_id) c
      LEFT JOIN (SELECT offer_id, sum(count) AS views FROM impression_counts WHERE day >= date('now', '-7 days') GROUP BY offer_id) i USING (offer_id)
      ORDER BY c.clicks DESC LIMIT 20`).all());
    console.table(db.prepare("SELECT name, dims, sum(count) AS n FROM event_counts WHERE day >= date('now', '-7 days') GROUP BY name, dims ORDER BY n DESC LIMIT 30").all());
  },
  purge: () => console.log(purgeExpiredData(db)),
  backup: () => {
    backup(db, need(args[0], 'path'));
    console.log(`backup written to ${args[0]}`);
  },
  'seed:demo': () => {
    if (process.env.APP_ENV === 'production') throw new Error('refusing to seed demo data in production');
    seedDemo(db);
    console.log('demo advertisers seeded');
  },
};

(async () => {
  const fn = commands[cmd ?? 'help'];
  if (!fn) {
    console.error(`unknown command ${cmd}`);
    commands.help();
    process.exit(2);
  }
  try {
    await fn();
  } catch (e) {
    console.error('error:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
