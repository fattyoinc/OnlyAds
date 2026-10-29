/**
 * Merchant domain verification: proves an advertiser controls a store before we
 * read its catalog directly (e.g. a Shopify /products.json). We issue a random
 * token; the merchant publishes it at https://<domain>/.well-known/onlyads-verify.txt.
 */
import { randomBytes } from 'node:crypto';

import { hostMatchesDomain } from '@/services/urlSafety';
import type { DB } from './db';

export const VERIFY_PATH = '/.well-known/onlyads-verify.txt';
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function startVerification(db: DB, advertiserId: string, domain: string): { token: string; url: string; body: string } {
  const d = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) throw new Error('invalid domain');
  const adv = db.prepare('SELECT allowed_domains FROM advertisers WHERE id = ?').get(advertiserId) as { allowed_domains: string } | undefined;
  if (!adv) throw new Error(`advertiser ${advertiserId} not found`);
  // Verification proves ownership of a domain the advertiser is already allowed to link to.
  if (!(JSON.parse(adv.allowed_domains) as string[]).some((a) => hostMatchesDomain(d, a))) throw new Error(`${d} is not in the advertiser's allowed domains`);
  const token = randomBytes(16).toString('hex');
  db.prepare('UPDATE advertisers SET verify_domain = ?, verify_token = ?, domain_verified_at = NULL, updated_at = ? WHERE id = ?').run(d, token, new Date().toISOString(), advertiserId);
  return { token, url: `https://${d}${VERIFY_PATH}`, body: `onlyads-verify=${token}` };
}

export async function checkVerification(db: DB, advertiserId: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const adv = db.prepare('SELECT verify_domain, verify_token FROM advertisers WHERE id = ?').get(advertiserId) as { verify_domain: string | null; verify_token: string | null } | undefined;
  if (!adv?.verify_domain || !adv.verify_token) return { ok: false, reason: 'no verification started' };
  let text: string;
  try {
    const res = await fetchImpl(`https://${adv.verify_domain}${VERIFY_PATH}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    text = (await res.text()).slice(0, 4096);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'fetch failed' };
  }
  const found = text.split(/\r?\n/).some((l) => l.trim() === `onlyads-verify=${adv.verify_token}`);
  if (!found) return { ok: false, reason: 'token not found in file' };
  db.prepare('UPDATE advertisers SET domain_verified_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), advertiserId);
  return { ok: true };
}
