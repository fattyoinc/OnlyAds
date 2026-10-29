/**
 * Demo seed: fictional advertisers + feeds from server/data/demo-seed.json.
 * Marked is_demo = 1, so production never serves them (see loadServerConfig).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DB } from './db';
import { DATA_DIR } from './ingest';

interface Seed {
  advertisers: { id: string; name: string; allowedDomains: string[]; sponsored?: boolean; affiliate?: boolean }[];
  feeds: { id: string; advertiserId: string; kind: 'merchant_tsv' | 'direct_json'; source: string }[];
}

export function seedDemo(db: DB, file = join(DATA_DIR, 'demo-seed.json')): void {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as Seed;
  const now = new Date().toISOString();
  const adv = db.prepare(
    `INSERT INTO advertisers (id, name, status, allowed_domains, sponsored, affiliate, is_demo, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING`,
  );
  const feed = db.prepare(`INSERT INTO feeds (id, advertiser_id, kind, source, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`);
  for (const a of seed.advertisers) adv.run(a.id, a.name, JSON.stringify(a.allowedDomains), a.sponsored ? 1 : 0, a.affiliate ? 1 : 0, now, now);
  for (const f of seed.feeds) feed.run(f.id, f.advertiserId, f.kind, f.source, now);
}
