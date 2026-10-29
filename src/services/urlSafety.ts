/**
 * URL safety checks shared by the app and the server. Implemented with plain
 * string parsing because React Native's URL polyfill does not implement all
 * properties on every platform.
 */

const MAX_URL_LENGTH = 2048;
const URL_RE = /^https:\/\/([^/?#\s]+)([/?#][^\s]*)?$/i;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface ParsedUrl {
  host: string;
  port?: number;
}

/** Parse an https URL; returns undefined for anything we refuse to open. */
export function parseSafeHttpsUrl(input: unknown, opts: { allowPort?: boolean } = {}): ParsedUrl | undefined {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) return undefined;
  // Reject control characters, whitespace and backslashes (parser confusion tricks).
  if (/[\u0000-\u001f\u007f\s\\]/.test(input)) return undefined;
  const m = URL_RE.exec(input);
  if (!m) return undefined;
  const authority = m[1];
  if (authority.includes('@')) return undefined; // no embedded credentials
  const hp = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return undefined; // also rejects IPv6 literals "[...]"
  const host = hp[1].toLowerCase().replace(/\.$/, '');
  const port = hp[2] ? Number(hp[2]) : undefined;
  if (port !== undefined && port !== 443 && !opts.allowPort) return undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return undefined;
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x/i.test(host)) return undefined; // IP literals
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return undefined;
  if (/^\d+$/.test(labels[labels.length - 1])) return undefined;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return undefined;
  return { host, port };
}

export function isSafeHttpsUrl(input: unknown, opts?: { allowPort?: boolean }): input is string {
  return !!parseSafeHttpsUrl(input, opts);
}

/** True when `host` equals `domain` or is a subdomain of it. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\.+|\.+$/g, '');
  return host === d || host.endsWith(`.${d}`);
}
