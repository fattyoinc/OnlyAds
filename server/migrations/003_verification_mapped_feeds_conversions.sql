-- 003: merchant domain verification, new feed kinds (Shopify store catalog for
-- verified owners, column-mapped CSV for affiliate network exports), and
-- conversions reported by authorized partners. Still no personal data.

-- Feeds: rebuild to widen the kind CHECK and add a per-feed column mapping (JSON).
CREATE TABLE feeds_new (
  id              TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  advertiser_id   TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('merchant_tsv', 'direct_json', 'offers_json_api', 'shopify_products_json', 'csv_mapped')),
  source          TEXT NOT NULL,
  auth_env        TEXT CHECK (auth_env IS NULL OR auth_env GLOB 'FEED_TOKEN_[A-Z0-9_]*'),
  mapping         TEXT CHECK (mapping IS NULL OR json_valid(mapping)),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at     TEXT,
  last_success_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL
);
INSERT INTO feeds_new (id, advertiser_id, kind, source, auth_env, enabled, last_run_at, last_success_at, last_error, created_at)
  SELECT id, advertiser_id, kind, source, auth_env, enabled, last_run_at, last_success_at, last_error, created_at FROM feeds;
DROP TABLE feeds;
ALTER TABLE feeds_new RENAME TO feeds;

-- Domain verification: the merchant publishes a token we issue at
-- https://<domain>/.well-known/onlyads-verify.txt, proving they control the store.
ALTER TABLE advertisers ADD COLUMN verify_domain TEXT;
ALTER TABLE advertisers ADD COLUMN verify_token TEXT;
ALTER TABLE advertisers ADD COLUMN domain_verified_at TEXT;

-- Conversions, only as reported by an authorized partner postback (network or
-- merchant). A click alone never creates a row here.
--   pending   → reported, not yet final (can still be reversed)
--   confirmed → partner says the commission is payable: counts as revenue
--   reversed  → cancelled/returned: never counts
CREATE TABLE conversions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  network           TEXT NOT NULL CHECK (length(network) BETWEEN 1 AND 32),
  -- The partner's own transaction id: (network, transaction_id) makes postbacks idempotent.
  transaction_id    TEXT NOT NULL CHECK (length(transaction_id) BETWEEN 1 AND 128),
  click_id          TEXT NOT NULL,
  offer_id          TEXT NOT NULL,
  advertiser_id     TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'reversed')),
  -- Minor units (cents) to avoid float drift. Commission is what we earn; sale is informational.
  sale_amount_minor       INTEGER CHECK (sale_amount_minor IS NULL OR sale_amount_minor >= 0),
  commission_amount_minor INTEGER CHECK (commission_amount_minor IS NULL OR commission_amount_minor >= 0),
  currency          TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]')),
  occurred_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (network, transaction_id)
);
CREATE INDEX conversions_offer ON conversions (offer_id, created_at);
CREATE INDEX conversions_status ON conversions (status, updated_at);
