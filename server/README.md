# Only Ads API

Read-only public API plus scheduled feed ingestion, backed by SQLite (Node 22 `node:sqlite`, no native dependencies).

| File | Role |
|---|---|
| `app.ts` | HTTP routes: `/health`, `/v1/offers` (validated, paginated, cached, rate-limited), `/v1/click/:id` (re-validated 302 + aggregate count) |
| `db.ts`, `migrations/` | Connection (WAL, foreign keys), ordered idempotent migrations, `VACUUM INTO` backups |
| `ingest.ts` | Feed fetch (https, 30s timeout, 20 MB cap) → parse → validate → policy → upsert; deactivates removed items |
| `policy.ts` | Content policy: advertiser domain allow-list, prohibited categories, implausible discounts, review queue |
| `cli.ts` | Admin commands (advertisers, feeds, moderation, stats, backup). No admin HTTP surface. |
| `rateLimit.ts`, `log.ts` | Per-IP token bucket (bounded memory); structured logs without personal data |

Run: `npm run server` (dev seeds fictional demo advertisers). Tests: `npm run test:server`.
Configuration, deployment, backups and runbooks: [../docs/OPERATIONS.md](../docs/OPERATIONS.md).
