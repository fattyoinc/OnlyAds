-- 002: geographic availability, verification time, authenticated feeds,
-- attribution settings, click events, impression + analytics aggregates.
-- Still no personal data: no user IDs, IPs, device IDs or locations of people.

-- Offers: where they can be redeemed (JSON array of ISO country codes, NULL = anywhere).
ALTER TABLE offers ADD COLUMN countries TEXT;

-- Feeds: rebuild to widen the kind CHECK and add an optional credential reference.
-- auth_env names an environment variable (FEED_TOKEN_*) holding a bearer token;
-- the token itself is never stored in the database.
CREATE TABLE feeds_new (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  advertiser_id   TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('merchant_tsv', 'direct_json', 'offers_json_api')),
  source          TEXT NOT NULL,
  auth_env        TEXT CHECK (auth_env IS NULL OR auth_env GLOB 'FEED_TOKEN_[A-Z0-9_]*'),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at     TEXT,
  last_success_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO feeds_new (id, advertiser_id, kind, source, enabled, last_run_at, last_success_at, last_error, created_at)
  SELECT id, advertiser_id, kind, source, enabled, last_run_at, last_success_at, last_error, created_at FROM feeds;
DROP TABLE feeds;
ALTER TABLE feeds_new RENAME TO feeds;

-- Advertisers: attribution is opt-in per advertiser. The template may only use
-- the placeholders {click_id}, {campaign}, {offer_id} (validated in code).
ALTER TABLE advertisers ADD COLUMN attribution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (attribution_enabled IN (0, 1));
ALTER TABLE advertisers ADD COLUMN tracking_template TEXT;
ALTER TABLE advertisers ADD COLUMN network TEXT;

-- One row per outbound click for advertisers with attribution enabled, so a
-- future, authorized conversion postback can be matched to a click. A click is
-- NOT a purchase; nothing here records revenue. Purged after 90 days.
CREATE TABLE click_events (
  click_id     TEXT PRIMARY KEY,
  offer_id     TEXT NOT NULL,
  advertiser_id TEXT NOT NULL,
  campaign_id  TEXT,
  network      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX click_events_created ON click_events (created_at);
CREATE INDEX click_events_offer ON click_events (offer_id, created_at);

-- Aggregate counts only.
CREATE TABLE impression_counts (
  offer_id TEXT NOT NULL,
  day      TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, day)
);

CREATE TABLE event_counts (
  day   TEXT NOT NULL,
  name  TEXT NOT NULL,
  -- Canonical "k=v;k=v" of allow-listed properties ('' when none).
  dims  TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, dims)
);
