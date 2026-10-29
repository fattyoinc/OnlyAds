# Only Ads — Production Readiness Audit

Audit date: 2026-10-28. Codebase: Expo SDK 57 / React Native 0.86 / expo-router, plus the reference Node server in `server/`.
Method: I read every source file, ran typecheck/lint/tests/builds, ran `expo config --type introspect` to see the **real** native permissions, ran `npm audit`, measured color contrast, and drove the app with Playwright. I checked store rules against current Apple and Google pages (links at the bottom).

The **Status** column was updated after the fix pass. "Fixed" means a test or build check now covers it (see `docs/FINAL_REPORT.md`). "Documented" means it needs your accounts, money, a device, or a lawyer.

## Severity key
- **P0** — Critical security issue, data exposure, or a fundamental failure
- **P1** — Major functionality problem, data-integrity problem, or something that blocks release
- **P2** — Important reliability, accessibility, or performance work
- **P3** — Can safely wait

---

## P0 — Critical

| ID | Finding | Evidence | Status |
|---|---|---|---|
| P0-1 | **The production build would show fake ads as if they were real.** The fictional demo catalog (made-up brands, promo codes like `ONLYADS40`, prices) loads in *every* build, and nothing separates environments. Showing fabricated deals to real customers is deceptive advertising. Apple also rejects apps containing placeholder content (Guideline 2.1). | `defaultProviders()` always includes `sampleProvider` | Fixed and verified — turned off at runtime in production, **and** removed from the production bundle by `metro.config.js` (scanned with `e2e/check-bundle.js`: 0 demo markers in the production web/iOS/Android bundles). The API also never serves demo advertisers when `APP_ENV=production`. |
| P0-2 | **Ad links from the network aren't checked strictly enough.** `validateOffer` spreads the whole server payload (`...o`), so `imageUrl`, `price`, `tags`, `creative` and `location` arrive unchecked. A malformed or hostile payload can crash the app (`tags.flatMap`, `price.amount.toFixed`) or load images from any scheme. Clicking out calls `Linking.openURL(offer.url)` directly, so the app opens whatever URL the server sent and nothing can block a bad link centrally. | `src/services/providers/index.ts` | Fixed — every field is validated strictly, URLs must be https with no credentials or IP addresses, and click-outs go through the server's `/v1/click/:id` redirect, which re-checks each link against the advertiser's allowed domains. |
| P0-3 | **The public API has no protection against abuse.** No rate limiting, no input bounds beyond lat/lng, `Access-Control-Allow-Origin: *`, and it re-reads and re-parses every feed file on **every request**, so a few hundred requests a second would pin the CPU (easy denial of service). There are no security headers and no request timeouts. | `server/index.ts` | Fixed — per-IP rate limit, validated parameters, CORS allow-list, response cache, security headers, timeouts. Feeds are now ingested on a schedule into a database instead of on each request. |

## P1 — Major / release blockers

| ID | Finding | Status |
|---|---|---|
| P1-1 | **No timeout or retry on network calls.** One hanging provider blocks the whole feed forever (`Promise.allSettled` waits on a fetch that never ends). Slow networks never recover. | Fixed — 10-second timeout, retries with backoff and jitter (network errors and 5xx only), and a stale response can't overwrite a newer one. |
| P1-2 | **No offline mode or error state.** Errors are only visible deep in the profile screen. Opening the app offline shows an empty feed with no explanation. | Fixed — the last good results are cached (24h limit). An offline/error banner shows a Retry button and when the data was last updated. |
| P1-3 | **Saved data has no version number and isn't validated on load.** Corrupted or old saved data (for example a non-array `interests`) crashes the app on start. Nothing handles upgrades between app versions. | Fixed — a schema version, a `migrate()` step, and field-by-field cleanup. Corrupt data falls back to safe defaults. Unit-tested. |
| P1-4 | **Opening an offer link on a cold start shows "Offer not found"** while the offers are still loading. Every shared or notification link would look broken. | Fixed — a loading state shows until the first load settles. Checked in E2E. |
| P1-5 | **Android asks for precise location (`ACCESS_FINE_LOCATION`) and iOS includes "Always" location and Motion permission text** that the app never uses. Reviewers flag permissions without a clear purpose, and it breaks the least-privilege principle. | Fixed and verified in the generated native projects (`expo prebuild`). The Android manifest now requests only `ACCESS_COARSE_LOCATION`, `INTERNET` and `VIBRATE` (fine/background location, storage, "display over other apps", microphone and activity recognition are all blocked). The iOS Info.plist has only the When-In-Use location text. |
| P1-6 | **No iOS privacy manifest** (Apple requires one for "required-reason" APIs such as UserDefaults, file timestamps and disk space, which React Native and AsyncStorage use). | Fixed — `PrivacyInfo.xcprivacy` generated with UserDefaults/FileTimestamp/SystemBootTime/DiskSpace reasons, tracking false. Not yet checked by Apple's upload validation (needs your account). |
| P1-7 | **No privacy policy or terms anywhere in the app.** Both stores require a privacy policy, and Apple requires it to be reachable inside the app. | Fixed (drafts) — in-app Privacy and Terms screens plus `docs/legal/*.md`. **Needs a lawyer's review and a public URL.** |
| P1-8 | **Ad disclosure text is unreadable** (contrast 1.98:1). The FTC's "clear and conspicuous" standard and WCAG (4.5:1) both fail. | Fixed — the label is now a solid pill with ≥ 4.5:1 contrast. |
| P1-9 | **No release configuration:** no `eas.json`, no build numbers, no separation of development/staging/production, no `ITSAppUsesNonExemptEncryption` setting, `supportsTablet: true` (which would require iPad screenshots and review for an untested iPad layout). | Fixed — EAS profiles for each environment, version numbers, encryption flag, iPad set to phone-only for v1. |
| P1-10 | **Feeds aren't checked for freshness or validity.** Offers stay listed after a feed stops updating, and items removed from a feed are never deactivated. No checks for implausible discounts or mismatched link domains. | Fixed — ingestion upserts by ID and deactivates missing items, offers from feeds older than 48h are hidden, and a moderation queue handles suspicious offers. |
| P1-11 | **A backend can't fail without disappearing.** The app has no cached data or friendly fallback when the API is unreachable in production. | Fixed by P1-2. A production build with no reachable API shows an honest empty or error state, never demo ads. |

## P2 — Important

| ID | Finding | Status |
|---|---|---|
| P2-1 | Status bar text is dark on dark headers (onboarding, Nearby, Category), so it's unreadable. | Fixed |
| P2-2 | The Android back button on onboarding steps leaves the flow instead of going back a step. | Fixed |
| P2-3 | Offers don't drop off when they expire while the app is open or in the background. There's no refresh when the app comes back to the foreground, and saved data might not be written if the app is backgrounded quickly. | Fixed — a clock ticks while the app is active, offers refresh on return to the foreground after 15 minutes, and saved data is written immediately when backgrounding. |
| P2-4 | Double taps fire actions twice (click-out, Not interested, Mute brand, location request). | Fixed — a guard ignores repeat taps |
| P2-5 | The home and category grids render every card at once instead of using a virtualized list. The shared app state isn't memoized, so every card re-renders on each save. | Fixed — FlatList with 2 columns, memoized state |
| P2-6 | Currency, dates and distance are hard-coded to US English and miles. | Fixed — uses the device locale; km or miles follows the device's measurement setting |
| P2-7 | No error boundary and no crash reporting. A single render error white-screens the app. | Fixed — root error boundary plus a monitoring module that scrubs personal data before logging. A crash-reporting service (Sentry) **needs your account and key** — documented. |
| P2-8 | White text on light gradient art and category tiles (contrast down to 1.2:1). | Fixed — a dark scrim behind text on art, and the light gradients darkened |
| P2-9 | Screen-reader support: cards announced only the title. Price, expiry and disclosure weren't read out. Decorative icons weren't hidden. | Fixed — full card labels and roles; decorative elements hidden from screen readers |
| P2-10 | `npm audit`: 11 advisories. 3 "high" ones (zod, deepmerge) are in **build-time** Expo CLI and ESLint tooling and don't ship in the app. One moderate (`decode-uri-component`, used in expo-router's runtime URL parsing) — the fix needs Expo SDK 58. | Documented — upgrade to SDK 58 in the next maintenance pass (see OPERATIONS.md). Practical risk: a crafted link could only freeze the app for the person who opens it. |
| P2-11 | Unused dependency `expo-blur`. | Fixed — removed |
| P2-12 | Locally stored lists grow without limit (hidden offers, tag weights, saved items). | Fixed — capped and pruned |

## Found while fixing (and fixed)

| ID | Finding | Status |
|---|---|---|
| V-1 (P0) | The first attempt to remove demo data relied on dead-code elimination. **The bundle scan showed all the fictional offers still shipped in production binaries.** | Fixed with resolver-level stubbing. The bundle check now runs as part of `release:check`. |
| V-2 (P1) | Ingestion rewrote every row on every run (a fresh timestamp changed the content hash), which would have **silently reset human moderation decisions every hour**. | Fixed. Regression test: "keeps a reviewer decision across re-ingestion until the content changes". |
| V-3 (P1) | Default native templates added Android storage permissions and `SYSTEM_ALERT_WINDOW` that the app doesn't use (Data safety and review risk). | Fixed via `blockedPermissions`, verified in the generated manifest. |
| V-4 (P2) | A decorative overlay on the category header covered the Back button and would swallow taps. | Fixed (`pointerEvents="none"`). |

## P3 — Can wait

| ID | Finding |
|---|---|
| P3-1 | Universal Links / App Links (https deep links) need your domain and hosted association files. The custom `onlyads://` scheme works today. |
| P3-2 | A real map view (`react-native-maps`) needs a Google Maps API key on Android. |
| P3-3 | Image proxy/CDN so we don't hotlink advertiser images (privacy and reliability). |
| P3-4 | Tablet layout, landscape, dark mode. |
| P3-5 | Accounts and cross-device sync (deliberately not built — see FINAL_REPORT "Decisions"). |
| P3-6 | Move from SQLite to Postgres when we need more than one API server. |

---

## Which features really need a backend?

| Feature | Needs a server? | Why |
|---|---|---|
| Offer catalog (feeds, affiliates, direct advertisers) | **Yes** | Affiliate API keys must stay secret. Feeds need scheduled ingestion, deduplication, expiry handling and moderation. |
| Click-out | **Yes** | Lets us block bad links centrally, re-check advertiser domains, and count clicks for advertisers (without personal data). |
| Personalization, saved offers, interests, history | **No** (stays on the phone by design) | Keeps personal data off our servers. That makes privacy disclosures simpler and means no account-deletion system is needed. |
| Accounts | **No, for v1** | No feature needs them yet. Adding accounts would require in-app account deletion (both stores), password/OAuth security, and storing personal data. |
| Analytics | Optional | Aggregate click counts on the server cover the advertiser-facing numbers. Product analytics: see OPERATIONS.md. |

### Sources (store requirements, checked 2026-10-28)
- Apple — uploads must be built with Xcode 26 / iOS 26 SDK since 2026-04-28: https://developer.apple.com/news/upcoming-requirements/ and https://expo.dev/blog/app-store-connect-minimum-sdk-26
- Apple — updated age ratings (13+/16+/18+): https://developer.apple.com/news/?id=ks775ehf
- Expo — Apple privacy manifests: https://docs.expo.dev/guides/apple-privacy/
- Google Play — target API 36 required for new apps and updates from 2026-08-31: https://developer.android.com/google/play/requirements/target-sdk and https://support.google.com/googleplay/android-developer/answer/11926878
- Google Play — new personal accounts need 12 testers for 14 days in closed testing: https://support.google.com/googleplay/android-developer/answer/14151465
