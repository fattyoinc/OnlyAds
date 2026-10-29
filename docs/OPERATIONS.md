# Operating Only Ads

## 1. Environment variables

### App (inlined at build time — **public**, never secrets)
| Variable | Required | Example | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | yes (set by eas.json) | `production` | `development` / `staging` / `production`. Production removes the demo catalog from the bundle (metro.config.js) and turns it off at runtime. If unset, release builds default to `production`. |
| `EXPO_PUBLIC_OFFERS_API_URL` | yes in prod | `https://api.yourdomain.com` | Only Ads API. Must be https (plain http is allowed only for localhost/LAN in dev). |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | yes in prod | `support@yourdomain.com` | "Contact support" and "Report" on offers. |

### API server
| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `production` refuses a `*.dev.*` DB path and never serves demo advertisers. |
| `PORT` | `8787` | |
| `DB_PATH` | `server/onlyads.dev.db` | SQLite file. In production, put it on a **persistent volume**. |
| `CORS_ORIGINS` | *(none)* | Comma-separated origins allowed to call the API from a browser. Native apps don't need this. |
| `TRUST_PROXY` | `0` | Set `1` only behind a proxy you control that sets `X-Forwarded-For` (otherwise clients could spoof their IP to dodge rate limits). |
| `RATE_BURST` / `RATE_PER_SEC` | `30` / `1` | Per-IP limits for `/v1/offers` (clicks have a stricter fixed limit). |
| `CACHE_TTL_MS` | `60000` | In-process response cache. |
| `FEED_STALE_HOURS` | `48` | A feed's offers are hidden once its last successful ingestion is older than this. |
| `INGEST_INTERVAL_MIN` | `60` | Scheduled ingestion interval. |
| `INCLUDE_DEMO` | dev: on | `0` disables demo advertisers in dev/staging. In production only `force` enables them (don't). |
| `SEED_DEMO` | dev: on | `0` skips seeding demo advertisers on dev start. |
| `LOG_LEVEL` | `info` | |

| `FEED_TOKEN_*` | — | Bearer tokens for authenticated partner feeds (`offers_json_api`). The feed row stores only the variable *name* (`--auth FEED_TOKEN_ACME`); the token lives in the server's secret store. |

| `POSTBACK_TOKEN_<NETWORK>` | — | Shared secret a partner sends with conversion postbacks (`/v1/postbacks/<network>`). Unset = that endpoint returns 404. Long random value (`openssl rand -hex 24`). |
| `PUBLIC_API_URL` | — | Only used by `admin postback:url` to print the URL to give partners. |

Affiliate network API keys belong **only** in the server's secret store (e.g. `fly secrets set`), never in the app or in git. `npm run check:secrets` (part of `test:all` and `release:check`) fails if a credential pattern appears in committable files.

### Attribution (per advertiser, opt-in, only with their written authorization)
```bash
npm run admin -- advertiser:attribution acme "utm_source=onlyads&utm_medium=app&utm_campaign={campaign}&oa_click={click_id}" --network awin
```
The click redirect appends these parameters, keeps any the advertiser already set, and logs `click_events` (click id, offer, campaign, time; **no user/device/IP**) for 90 days so a future, authorized conversion postback can be matched. A click is never recorded as a purchase.

### Conversions and revenue
Partners report sales server-to-server: `GET|POST /v1/postbacks/<network>?transaction_id=…&click_id=…&status=pending|confirmed|reversed&commission=…&currency=…` with `Authorization: Bearer $POSTBACK_TOKEN_<NETWORK>` (or `&token=`). Common status words (approved, declined…) are mapped. Repeats are idempotent; only pending→confirmed/reversed and confirmed→reversed are accepted; clicks that don't exist or belong to another network are rejected (422). Run `npm run admin -- postback:url <network>` to print the URL template. **Map each partner's macros in their dashboard and send one test postback before relying on it** — none has been received from a real partner yet.

`npm run admin -- report [days]` prints, per advertiser: impressions, clicks, attributed conversions (pending + confirmed), confirmed conversions, reversed, **confirmed revenue** (commission the partner confirmed) and pending commission (not revenue). Reconcile confirmed revenue against the network's payment reports monthly; the network's numbers win.

### Product analytics (first-party, aggregate)
The app posts allow-listed events (`src/services/analyticsSchema.ts`) to `POST /v1/events` and ad views to `POST /v1/impressions` only if the user kept "Anonymous usage stats" on. The server stores **daily counts only** (`event_counts`, `impression_counts`). See `npm run admin -- stats` for CTR per offer. These counts are unauthenticated and rate-limited: treat them as product signals, not as billing-grade numbers.

### Data retention
Runs after every ingestion (and `npm run admin -- purge`): click events after 90 days; aggregates after ~13 months.

## 2. Deploying the API (recommended: one small VM or Fly.io/Render with a volume)
SQLite on a single instance with a persistent volume is the right size until about 100k users (see costs). Steps on Fly.io, for example:
1. Create the app and a 1 GB volume. Mount it at `/data`. Set `DB_PATH=/data/onlyads.db`, `APP_ENV=production`, `TRUST_PROXY=1`.
2. Run command: `npm ci && npm run server` (Node **22.22+**, which `node:sqlite` needs; it's still marked experimental in Node 22, so pin the version).
3. Put TLS in front (Fly/Render handle it). Health check: `GET /health`.
4. Onboard advertisers with the admin CLI over SSH (there are deliberately no admin HTTP endpoints):
   ```bash
   npm run admin -- advertiser:add acme "Acme Outdoor" acme.com,shop.acme.com --affiliate
   npm run admin -- feed:add acme-main acme merchant_tsv https://acme.com/feeds/google.tsv
   npm run admin -- ingest acme-main
   npm run admin -- review:list
   npm run admin -- advertiser:approve acme
   ```
   Other sources (Shopify store of a verified merchant, affiliate CSV exports with a column mapping): see docs/INTEGRATIONS.md §4b.
Keep **staging and production separate**: separate apps, databases and domains. Never point a staging build at the production API.

## 3. Backups & recovery
- Daily: `npm run admin -- backup /data/backups/onlyads-$(date +%F).db`. This is a consistent online snapshot (`VACUUM INTO`), safe while the server runs. Copy it off the machine (e.g. S3/B2) and keep 14 daily + 8 weekly copies.
- **Restore:** stop the server → copy the backup to `DB_PATH` → start the server. Migrations run automatically and are idempotent. Then run `npm run admin -- ingest` to refresh offers.
- Verified in development: backup → reopen → `integrity_check = ok`.
- What's lost if the DB is lost: advertisers, feed config, moderation decisions, click counts. Offers come back on the next ingestion. **No user data lives on the server.**

## 4. Incidents (runbook)
| Situation | Action |
|---|---|
| Malicious or deceptive ad reported | `npm run admin -- review:reject <offerId>`. If the advertiser is the problem: `advertiser:suspend <id>` hides all its offers and click redirects **immediately**. |
| Broken or bad feed | `feed:disable <id>`. Offers stop after `FEED_STALE_HOURS` anyway. |
| API down | The app keeps showing cached offers (up to 24h) with an offline banner, so users aren't stranded. |
| Abuse / scraping | Lower `RATE_BURST`/`RATE_PER_SEC`, put Cloudflare in front, or block at the edge. |
| App crash spike | Check the error tracker (see §5). Ship a fix through EAS Build. If you add `expo-updates`, JS-only fixes can go out over the air. |

## 5. Monitoring & analytics
- **App errors:** `src/services/monitoring.ts` scrubs every message (coordinates, emails, tokens, query strings) and keeps the last 20 in memory, visible in Profile → Diagnostics. To get crash reports remotely, add Sentry 🔑 (needs an account + DSN):
  `npx expo install @sentry/react-native`, add its config plugin, then in `src/app/_layout.tsx` call `setErrorSink((r) => Sentry.captureMessage(r.message, { level: r.fatal ? 'fatal' : 'error', tags: { context: r.context } }))`. Turn off `sendDefaultPii`, and **update the privacy label / Data safety form**.
- **Server:** JSON logs to stdout, with request id, route, status and duration. They never include IPs, query strings or payloads. Add an uptime monitor on `/health` (e.g. Better Stack free tier) and alert on 5xx rate and on `feeds.last_error`.
- **Product analytics:** `src/services/analytics.ts` only accepts allow-listed events and properties (no IDs, no search text, no coordinates). The default sink is a no-op. If you connect a provider (e.g. PostHog EU with person profiles off), update the privacy policy and store disclosures first. Advertiser-facing numbers (clicks per offer per day) are already in `click_counts`.

## 6. Maintenance & dependencies
- **Monthly:** `npx expo install --check` (keeps packages aligned with the SDK), `npm audit --omit=dev`, review the advisories, then `npm run test:all` and the E2E suite.
- **Expo SDK upgrade** (about 3 times a year; each SDK is supported for roughly a year): `npx expo install expo@^<next> --fix`, read the changelog, run everything, then device-test. **Upgraded to SDK 58 on 2026-10-28** (React Native 0.88, React 19.3). Verified here: typecheck, lint, all app + server tests, iOS/Android JS bundles, prebuild, web E2E (38/38). **Not verifiable here: native compile and on-device behavior** — the first EAS build + device test covers that. Rollback: the SDK 57 archive (`only-ads-sdk57.tar.gz`). The upgrade removed the `decode-uri-component`/`query-string` advisory that shipped in the app.
- Current `npm audit` triage (2026-10-28, SDK 58): 17 findings, 0 moderate. The 3 "high" (zod via @expo/cli) and the lows (deepmerge via @expo/config, jest tooling) are **build/test tooling only** and don't ship in the app. `npm audit fix --force` would *downgrade* Expo to SDK 51 — don't run it.
- Things that need ongoing attention or subscriptions: Apple Developer ($99/yr), Expo/EAS plan, the hosting VM, error tracking (optional), affiliate network accounts (free, but keep them in good standing), legal review when practices change, yearly store policy changes (target API level each August, the Xcode SDK minimum each spring).

## 7. Running the test suites
```bash
npm run test:all          # typecheck + lint + 156 app tests + 57 server tests + secret scan
```
End-to-end (Playwright, uses real web builds):
```bash
CORS_ORIGINS=http://localhost:8081 npm run server
EXPO_PUBLIC_APP_ENV=staging EXPO_PUBLIC_OFFERS_API_URL=http://localhost:8787 EXPO_PUBLIC_SUPPORT_EMAIL=support@example.com npx expo export -p web --clear --output-dir /tmp/staging-web
EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_OFFERS_API_URL=https://api.onlyads.invalid npx expo export -p web --clear --output-dir /tmp/prod-web
node e2e/serve-dist.js /tmp/staging-web 8081 & node e2e/serve-dist.js /tmp/prod-web 8082 &
node e2e/journeys.js
node e2e/check-bundle.js /tmp/prod-web --expect-no-demo
```
Always pass `--clear` when you change `EXPO_PUBLIC_*` values. Metro caches inlined env vars.

## 8. Estimated operating costs (monthly, USD)
Assumptions: 30% of users active daily, about 3 API calls per session, offers cached 60s server-side, advertiser images hot-linked (not proxied), no paid analytics. These are estimates, not quotes.

| Users | API hosting | DB/backups | Error tracking | Builds (EAS) | Other | **Total / month** |
|---|---|---|---|---|---|---|
| 100 | $5–7 (shared VM) | <$1 | $0 (free tier) | $0 (free tier) | domain ~$1 | **≈ $10** |
| 1,000 | $7–15 | $1 | $0 | $0–19 | | **≈ $15–35** |
| 10,000 | $15–30 (1–2 GB VM) | $2 | $0–26 | $19 | uptime monitor $0 | **≈ $40–80** |
| 100,000 | $60–150 (2 instances + edge cache) | $15–50 (move to managed Postgres) | $26–80 | $99 | CDN/image proxy $20–100 | **≈ $250–500** |

Plus fixed costs: Apple $99/yr, Google $25 once, and the legal review. At 100k users, peak load is roughly 20–40 requests/second. A single instance can handle that, but a second instance (and therefore Postgres plus a shared rate limiter) is needed for **availability**, not capacity. Costs don't grow per request with advertisers: affiliate networks charge publishers nothing.
