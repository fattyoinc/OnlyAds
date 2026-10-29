/**
 * Structured JSON logs to stdout (collected by the host, e.g. Fly/Render/journald).
 * Never log IPs, query strings (they may contain coarse location), tokens or payloads.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
let silent = process.env.NODE_ENV === 'test';

export function setSilent(v: boolean) {
  silent = v;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (silent || ORDER[level] < min) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}
