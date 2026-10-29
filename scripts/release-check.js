#!/usr/bin/env node
/**
 * Release gate. Run before every store submission (and in CI for production builds):
 *   EXPO_PUBLIC_OFFERS_API_URL=https://api.yourdomain.com EXPO_PUBLIC_SUPPORT_EMAIL=support@yourdomain.com npm run release:check
 * Optional: --bundle <expo export dir> also verifies no demo data is in the bundle.
 * Exits non-zero if anything blocks release. MANUAL items must be confirmed by a person.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const results = [];
const check = (ok, msg) => results.push([ok ? 'PASS' : 'FAIL', msg]);
const manual = (msg) => results.push(['MANUAL', msg]);

const app = JSON.parse(read('app.json')).expo;
const eas = JSON.parse(read('eas.json'));
const legal = read('src/legal/content.ts');

// Environment & secrets
const api = process.env.EXPO_PUBLIC_OFFERS_API_URL;
check(!!api && /^https:\/\/[^/]+\.[a-z]{2,}(\/|$)/i.test(api) && !/example|invalid|localhost/.test(api), 'EXPO_PUBLIC_OFFERS_API_URL is a real https URL');
check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '') && !/example\./.test(process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? ''), 'EXPO_PUBLIC_SUPPORT_EMAIL is set');
check(eas.build?.production?.env?.EXPO_PUBLIC_APP_ENV === 'production', 'eas.json production profile sets EXPO_PUBLIC_APP_ENV=production');
const publicVars = Object.keys(process.env).filter((k) => k.startsWith('EXPO_PUBLIC_') && /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY/i.test(k));
check(publicVars.length === 0, `no secret-looking EXPO_PUBLIC_* variables (${publicVars.join(', ') || 'none'})`);

try {
  execFileSync('node', [path.join(__dirname, 'check-secrets.js')], { stdio: 'pipe' });
  check(true, 'no secrets in committed files');
} catch (e) {
  check(false, `no secrets in committed files — ${String(e.stderr).trim().split('\n')[0]}`);
}

// Legal
check(!/reviewed:\s*false/.test(legal), 'Privacy Policy and Terms marked reviewed by counsel (src/legal/content.ts)');
check(!/\[(EFFECTIVE DATE|CONTACT EMAIL|COMPANY|IF ENABLED|TO BE COMPLETED)/.test(legal), 'no [PLACEHOLDER] text left in legal documents');

// Native config
const blocked = app.android?.blockedPermissions ?? [];
check(blocked.includes('android.permission.ACCESS_FINE_LOCATION'), 'Android precise location blocked (coarse only)');
check(app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false, 'iOS export-compliance flag set');
check(!!app.ios?.privacyManifests?.NSPrivacyAccessedAPITypes?.length, 'iOS privacy manifest declared');
check(!!app.ios?.bundleIdentifier && !!app.android?.package, 'bundle identifiers set');
check((app.plugins ?? []).includes('./plugins/withoutPushEntitlement'), 'iOS push entitlement stripped (reminders are local-only; no push capability needed)');
check(!(app.plugins ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === 'expo-tracking-transparency'), 'no App Tracking Transparency module (the app does not track across apps)');
const pkg = JSON.parse(read('package.json'));
check(!/^\D*5[0-7]\./.test(pkg.dependencies?.expo ?? ''), `Expo SDK is current (${pkg.dependencies?.expo})`);
check(fs.readdirSync(path.join(root, 'server', 'migrations')).filter((f) => f.endsWith('.sql')).length >= 3, 'server migrations present (conversions, verification, mapped feeds)');
const icon = fs.readFileSync(path.join(root, app.icon));
check(icon.readUInt32BE(16) === 1024 && icon.readUInt32BE(20) === 1024, 'app icon is 1024x1024');

// Bundle contents
const bi = process.argv.indexOf('--bundle');
if (bi > 0) {
  try {
    execFileSync('node', [path.join(__dirname, '..', 'e2e', 'check-bundle.js'), process.argv[bi + 1], '--expect-no-demo'], { stdio: 'pipe' });
    check(true, 'production bundle contains no demo catalog');
  } catch (e) {
    check(false, `production bundle contains no demo catalog — ${String(e.stdout).trim()}`);
  }
} else manual('run with --bundle <dir of `EXPO_PUBLIC_APP_ENV=production npx expo export`> to verify no demo data ships');

// Things only a person can confirm
manual('Tested a release build on a physical iPhone and Android phone (docs/RELEASE.md §Device test plan)');
manual('App Store Connect: privacy nutrition label, age rating questionnaire, support + privacy URLs, screenshots');
manual('Play Console: Data safety form, content rating, target audience, closed test (12 testers × 14 days for new personal accounts)');
manual('Production API deployed with APP_ENV=production, backups scheduled, at least one approved non-demo advertiser');
manual('Each affiliate partner: test postback received and visible in `npm run admin -- report` before counting revenue');
manual('Saved-deal reminders: permission prompt and notification tap verified on a device (web cannot schedule notifications)');

for (const [s, m] of results) console.log(`${s.padEnd(6)} ${m}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${failed ? `${failed} blocking issue(s) — NOT ready to submit.` : 'No automated blockers. Complete the MANUAL items before submitting.'}`);
process.exit(failed ? 1 : 0);
