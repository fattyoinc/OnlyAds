-- Only Ads schema v1. Applied once by server/db.ts (tracked in schema_migrations).
-- No personal data is stored anywhere in this schema: no users, no IPs, no locations of people.

CREATE TABLE advertisers (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- pending: new, offers held for review; active: live; suspended: all offers hidden immediately
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  -- JSON array of domains this advertiser may link to (e.g. ["acme.com"]). Offer links outside it are rejected.
  allowed_domains TEXT NOT NULL DEFAULT '[]',
  sponsored       INTEGER NOT NULL DEFAULT 0 CHECK (sponsored IN (0, 1)),
  affiliate       INTEGER NOT NULL DEFAULT 0 CHECK (affiliate IN (0, 1)),
  -- Fictional/test advertisers. Excluded from production responses unless INCLUDE_DEMO=1.
  is_demo         INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE feeds (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  advertiser_id   TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  -- merchant_tsv: Google Merchant Center / Meta catalog TSV/CSV; direct_json: offers JSON
  kind            TEXT NOT NULL CHECK (kind IN ('merchant_tsv', 'direct_json')),
  -- https URL or a path under server/data (local files are for development/seeding only)
  source          TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at     TEXT,
  last_success_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE offers (
  id              TEXT PRIMARY KEY,
  advertiser_id   TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  feed_id         TEXT REFERENCES feeds(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  -- Validated offer JSON (src/services/offerValidation.ts) served to the app.
  payload         TEXT NOT NULL,
  category        TEXT NOT NULL,
  lat             REAL,
  lng             REAL,
  starts_at       TEXT,
  expires_at      TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active', 'pending_review', 'rejected', 'inactive')),
  review_reason   TEXT,
  -- Hash of the payload: lets ingestion skip unchanged rows and lets reviews stick until content changes.
  content_hash    TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (feed_id, external_id)
);
CREATE INDEX offers_serving ON offers (status, expires_at);
CREATE INDEX offers_category ON offers (category);
CREATE INDEX offers_geo ON offers (lat, lng) WHERE lat IS NOT NULL;
CREATE INDEX offers_advertiser ON offers (advertiser_id);

CREATE TABLE ingestion_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id         TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  items_seen      INTEGER NOT NULL DEFAULT 0,
  items_upserted  INTEGER NOT NULL DEFAULT 0,
  items_rejected  INTEGER NOT NULL DEFAULT 0,
  items_review    INTEGER NOT NULL DEFAULT 0,
  items_deactivated INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
CREATE INDEX ingestion_runs_feed ON ingestion_runs (feed_id, started_at);

-- Aggregate click counts only (no user, device or IP data).
CREATE TABLE click_counts (
  offer_id        TEXT NOT NULL,
  day             TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, day)
);
