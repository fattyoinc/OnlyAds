/**
 * Ad content policy, applied to every offer at ingestion. Outcomes:
 *  - reject: never served (prohibited category, unsafe/off-domain link)
 *  - review: held as pending_review until a human approves it (server/cli.ts)
 *  - accept: served
 * This is a first line of defense, not a substitute for advertiser vetting.
 */
import { hostMatchesDomain, parseSafeHttpsUrl } from '@/services/urlSafety';
import type { Offer } from '@/types/offer';
import { discountPercent } from '@/utils/format';

export type Decision = { outcome: 'accept' } | { outcome: 'review' | 'reject'; reason: string };

/** Categories we don't run at all in v1 (age-gated or high-fraud). Matched on word boundaries. */
const PROHIBITED = [
  /\b(firearms?|guns?|ammo|ammunition)\b/i,
  /\b(vapes?|vaping|e-?cig(arette)?s?|tobacco|cigarettes?|nicotine)\b/i,
  /\b(casino|gambling|sports? ?betting|slots)\b/i,
  /\b(cbd|thc|cannabis|marijuana)\b/i,
  /\b(escort|adult content|xxx|porn)\b/i,
  /\b(payday loans?|crypto(currency)? (giveaway|airdrop)|guaranteed returns?)\b/i,
];

/** Signals of deceptive offers that a human should look at. */
const SUSPICIOUS = [/\b(free iphone|you('| ha)ve won|act now|limited to first \d+ callers|miracle)\b/i, /!!!/];

export interface AdvertiserPolicyInfo {
  status: 'pending' | 'active' | 'suspended';
  allowedDomains: string[];
}

export function evaluateOffer(o: Offer, adv: AdvertiserPolicyInfo, now: Date = new Date()): Decision {
  if (adv.status === 'suspended') return { outcome: 'reject', reason: 'advertiser suspended' };

  const link = parseSafeHttpsUrl(o.url);
  if (!link) return { outcome: 'reject', reason: 'unsafe link' };
  if (!adv.allowedDomains.some((d) => hostMatchesDomain(link.host, d))) return { outcome: 'reject', reason: `link domain ${link.host} not allowed for advertiser` };

  const text = `${o.title} ${o.subtitle ?? ''} ${o.description} ${o.tags.join(' ')}`;
  const banned = PROHIBITED.find((re) => re.test(text));
  if (banned) return { outcome: 'reject', reason: 'prohibited category' };

  if (o.expiresAt && Date.parse(o.expiresAt) <= now.getTime()) return { outcome: 'reject', reason: 'already expired' };
  if (o.expiresAt && Date.parse(o.expiresAt) - now.getTime() > 400 * 24 * 3600_000) return { outcome: 'review', reason: 'expiry more than ~13 months out' };

  const pct = discountPercent(o);
  if (pct !== undefined && pct >= 80) return { outcome: 'review', reason: `implausible discount (${pct}%)` };
  if (o.price && o.price.amount < 0.5 && !o.originalPrice) return { outcome: 'review', reason: 'near-zero price' };
  if (SUSPICIOUS.some((re) => re.test(text))) return { outcome: 'review', reason: 'suspicious wording' };

  if (adv.status === 'pending') return { outcome: 'review', reason: 'new advertiser' };
  return { outcome: 'accept' };
}
