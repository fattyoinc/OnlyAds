#!/usr/bin/env node
/**
 * Fails if anything that looks like a credential is in files git would commit
 * (tracked + untracked-but-not-ignored). Run in CI and before every release.
 * False positive? Prefer moving the value to an env var over allow-listing.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b(sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{30,}\b/],
  ['Slack token', /\bxox[abpr]-[0-9A-Za-z-]{10,}\b/],
  ['Sentry DSN with key', /https:\/\/[0-9a-f]{32}@[a-z0-9.]*sentry\.io\//],
  ['Expo access token', /\bEXPO_TOKEN\s*=\s*\S{20,}/],
  ['Generic secret assignment', /\b(api[_-]?key|secret|password|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{24,}['"]/i],
  ['Secret in EXPO_PUBLIC var', /EXPO_PUBLIC_[A-Z_]*(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY)[A-Z_]*\s*=\s*\S+/],
];
const SKIP = /(^|\/)(package-lock\.json|node_modules\/|\.git\/)|\.(png|jpg|jpeg|gif|ico|ttf|otf|woff2?|db|tar\.gz|hbc)$/;

let files;
try {
  files = execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  console.error('git not available; cannot determine committed files');
  process.exit(2);
}
const hits = [];
for (const f of files) {
  if (SKIP.test(f) || f === 'scripts/check-secrets.js') continue;
  const p = path.join(root, f);
  if (!fs.existsSync(p) || fs.statSync(p).size > 2_000_000) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${f}:${i + 1}  ${name}`);
  });
}
if (hits.length) {
  console.error(`Possible secrets found (${hits.length}):\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} files scanned, no secrets found`);
