/**
 * Conversions come ONLY from an authorized partner's server-to-server postback
 * (an affiliate network, or a merchant reporting its own sales). A click is
 * never a conversion, and a conversion is only revenue once the partner
 * confirms it.
 *
 *   GET|POST /v1/postbacks/:network?transaction_id&click_id&status&commission&sale_amount&currency&occurred_at
 *   Auth: Authorization: Bearer <token>  (or &token=)  — token from env POSTBACK_TOKEN_<NETWORK>.
 *   A network without a configured token has no endpoint (404).
 *
 * Idempotent on (network, transaction_id). Allowed status changes:
 *   pending → confirmed | reversed,  confirmed → reversed (refund/clawback).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import type { DB } from './db';

export type ConversionStatus = 'pending' | 'confirmed' | 'reversed';

const STATUS_ALIASES: Record<string, ConversionStatus> = {
  pending: 'pending',
  open: 'pending',
  confirmed: 'confirmed',
  approved: 'confirmed',
  locked: 'confirmed',
  reversed: 'reversed',
  declined: 'reversed',
  rejected: 'reversed',
  cancelled: 'reversed',
  canceled: 'reversed',
};
const ALLOWED: Record<ConversionStatus, ConversionStatus[]> = { pending: ['confirmed', 'reversed'], confirmed: ['reversed'], reversed: [] };

export const NETWORK_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function postbackEnvName(network: string): string {
  return `POSTBACK_TOKEN_${network.toUpperCase().replace(/-/g, '_')}`;
}

/** Constant-time token check. Undefined expected → endpoint disabled. */
export function tokenMatches(expected: string | undefined, given: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

/** "12.34" → 1234 (hundredths of the currency unit). Rejects negatives, exponents, junk. */
export function toMinor(v: string | null | undefined): number | undefined | null {
  if (v === null || v === undefined || v === '') return undefined;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  const [i, f = ''] = v.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}

export type PostbackResult =
  | { http: 200; outcome: 'recorded' | 'updated' | 'duplicate'; status: ConversionStatus }
  | { http: 400 | 409 | 422; error: string };

export function recordPostback(db: DB, network: string, p: URLSearchParams, now = new Date()): PostbackResult {
  const transactionId = p.get('transaction_id') ?? '';
  const clickId = p.get('click_id') ?? '';
  const status = STATUS_ALIASES[(p.get('status') ?? 'pending').toLowerCase()];
  const sale = toMinor(p.get('sale_amount'));
  const commission = toMinor(p.get('commission'));
  const currency = p.get('currency')?.toUpperCase() || undefined;
  const occurredRaw = p.get('occurred_at');
  const occurredAt = occurredRaw ? new Date(occurredRaw) : undefined;

  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(transactionId)) return { http: 400, error: 'invalid transaction_id' };
  if (!/^[a-f0-9]{24}$/.test(clickId)) return { http: 400, error: 'invalid click_id' };
  if (!status) return { http: 400, error: 'invalid status' };
  if (sale === null || commission === null) return { http: 400, error: 'invalid amount' };
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) return { http: 400, error: 'invalid currency' };
  if ((sale !== undefined || commission !== undefined) && !currency) return { http: 400, error: 'currency required with amounts' };
  if (occurredAt && (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 5 * 60_000)) return { http: 400, error: 'invalid occurred_at' };

  // Attribution: the click must exist and belong to this partner (a network can't claim another's clicks).
  const click = db.prepare('SELECT offer_id, advertiser_id, network, created_at FROM click_events WHERE click_id = ?').get(clickId) as
    | { offer_id: string; advertiser_id: string; network: string | null; created_at: string }
    | undefined;
  if (!click || (click.network ?? click.advertiser_id) !== network) return { http: 422, error: 'unknown click' };
  if (occurredAt && occurredAt.getTime() < Date.parse(click.created_at) - 60_000) return { http: 422, error: 'conversion predates click' };

  const iso = now.toISOString();
  const existing = db.prepare('SELECT id, status, click_id FROM conversions WHERE network = ? AND transaction_id = ?').get(network, transactionId) as
    | { id: number; status: ConversionStatus; click_id: string }
    | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO conversions (network, transaction_id, click_id, offer_id, advertiser_id, status, sale_amount_minor, commission_amount_minor, currency, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(network, transactionId, clickId, click.offer_id, click.advertiser_id, status, sale ?? null, commission ?? null, currency ?? null, occurredAt?.toISOString() ?? null, iso, iso);
    return { http: 200, outcome: 'recorded', status };
  }
  if (existing.click_id !== clickId) return { http: 409, error: 'transaction_id already used for another click' };
  if (existing.status === status) return { http: 200, outcome: 'duplicate', status };
  if (!ALLOWED[existing.status].includes(status)) return { http: 409, error: `cannot change ${existing.status} to ${status}` };
  db.prepare(
    `UPDATE conversions SET status = ?, sale_amount_minor = COALESCE(?, sale_amount_minor), commission_amount_minor = COALESCE(?, commission_amount_minor),
       currency = COALESCE(?, currency), updated_at = ? WHERE id = ?`,
  ).run(status, sale ?? null, commission ?? null, currency ?? null, iso, existing.id);
  return { http: 200, outcome: 'updated', status };
}

export interface FunnelRow {
  advertiserId: string;
  impressions: number;
  clicks: number;
  /** Partner-reported, not reversed (pending + confirmed). */
  attributedConversions: number;
  confirmedConversions: number;
  reversedConversions: number;
  /** Confirmed commission only, per currency, in hundredths. Pending is NOT revenue. */
  confirmedRevenueMinor: Record<string, number>;
  pendingRevenueMinor: Record<string, number>;
}

/** The four numbers kept strictly apart: impressions, clicks, attributed conversions, confirmed revenue. */
export function funnelReport(db: DB, sinceDay: string): FunnelRow[] {
  const rows = new Map<string, FunnelRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { advertiserId: id, impressions: 0, clicks: 0, attributedConversions: 0, confirmedConversions: 0, reversedConversions: 0, confirmedRevenueMinor: {}, pendingRevenueMinor: {} }));
    return r;
  };
  for (const r of db.prepare('SELECT o.advertiser_id AS a, SUM(i.count) AS n FROM impression_counts i JOIN offers o ON o.id = i.offer_id WHERE i.day >= ? GROUP BY o.advertiser_id').all(sinceDay) as { a: string; n: number }[]) row(r.a).impressions = r.n;
  for (const r of db.prepare('SELECT o.advertiser_id AS a, SUM(c.count) AS n FROM click_counts c JOIN offers o ON o.id = c.offer_id WHERE c.day >= ? GROUP BY o.advertiser_id').all(sinceDay) as { a: string; n: number }[]) row(r.a).clicks = r.n;
  const conv = db
    .prepare('SELECT advertiser_id AS a, status, currency, COUNT(*) AS n, SUM(COALESCE(commission_amount_minor, 0)) AS c FROM conversions WHERE created_at >= ? GROUP BY advertiser_id, status, currency')
    .all(sinceDay) as { a: string; status: ConversionStatus; currency: string | null; n: number; c: number }[];
  for (const r of conv) {
    const out = row(r.a);
    const cur = r.currency ?? 'n/a';
    if (r.status === 'reversed') out.reversedConversions += r.n;
    else {
      out.attributedConversions += r.n;
      const bucket = r.status === 'confirmed' ? out.confirmedRevenueMinor : out.pendingRevenueMinor;
      if (r.status === 'confirmed') out.confirmedConversions += r.n;
      if (r.c) bucket[cur] = (bucket[cur] ?? 0) + r.c;
    }
  }
  return [...rows.values()].sort((a, b) => a.advertiserId.localeCompare(b.advertiserId));
}
