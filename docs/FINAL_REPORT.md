# Only Ads — Production-Readiness Pass: Final Report (2026-10-28)

## 1. Verified (I ran these and saw them pass)

| Check | Result | Command |
|---|---|---|
| TypeScript (strict), app + server | ✅ 0 errors | `npm run typecheck` |
| ESLint (Expo config, incl. React Compiler hook rules) | ✅ 0 problems | `npm run lint` |
| App unit tests | ✅ 67/67 | `npm test` |
| Server integration tests (real SQLite, real HTTP) | ✅ 23/23 | `npm run test:server` |
| End-to-end journeys (staging build + real API; production build) | ✅ 18/18 | `node e2e/journeys.js` |
| Production bundles contain no demo ads (web, iOS Hermes, Android Hermes) | ✅ 0 markers | `node e2e/check-bundle.js <dir> --expect-no-demo` |
| iOS + Android production JS bundles compile | ✅ | `expo export -p ios -p android` |
| Generated native projects: permissions, Info.plist, privacy manifest, iPhone-only | ✅ inspected | `expo prebuild` (in a throwaway copy) |
| DB backup → restore → integrity check | ✅ `ok` | `npm run admin -- backup …` |
| Release gate correctly blocks an unready release | ✅ 4 blockers reported (all need you) | `npm run release:check` |

What the tests cover:
- **Security:** URL safety (20 attack cases), hostile API payloads, SQL-injection-shaped input, path traversal in feed paths, off-domain links, CORS allow-list, security headers, rate limiting (429 + Retry-After), bounded memory.
- **Reliability:** timeouts, bounded retries with backoff, Retry-After, offline cache and recovery, 5xx handling, corrupt or old local data, migration from the MVP's storage format.
- **Data integrity:** idempotent ingestion, deactivating items removed from a feed, hiding stale feeds, review decisions that persist, pagination with no duplicates, geo filtering, expiry.
- **Privacy:** coarse location only (rounded on the client *and* the server), location omitted when off, log/error scrubbing, analytics allow-list, click counts with no personal fields.
- **UX:** cold-start deep link, double-tap guard, honest production error and empty states, in-app privacy policy, erase-all-data.

## 2. Decisions I made (and why)

1. **No user accounts in v1.** No feature needs one. Accounts would add password and OAuth security work, personal data on our servers, and **mandatory in-app account deletion** on both stores. Everything personal stays on the phone, and "Erase all my data" is the deletion mechanism.
2. **SQLite (built into Node 22) instead of a hosted database.** It's one file, has zero dependencies, gives real transactions, indexes and migrations, and has a tested backup and restore path. It's the right size until about 100k users. Move to Postgres when you need a second server for availability (see OPERATIONS §8).
3. **The app no longer reads advertiser feeds directly.** All offers go through the server, so they can be moderated, de-duplicated, expired, and revoked instantly.
4. **Click-outs go through `/v1/click/:id`.** This lets us block a malicious link for everyone in seconds and give advertisers click counts, without tracking users.
5. **Demo data is removed from production at the bundler level**, not just turned off. The first approach didn't actually remove it, which the bundle scan caught.
6. **iPhone-only for v1** (`supportsTablet: false`). The iPad layout is untested, and shipping it would require iPad screenshots and review.
7. **Approximate location only.** Android's precise-location permission is blocked and iOS asks only "While Using". About 1 km is enough for "deals near you".
8. **No crash-reporting SDK installed yet.** The hook (`setErrorSink`) and scrubbing are ready. Sentry needs your account, and adding it changes your privacy disclosures, so it should be a deliberate choice.
9. **No admin web endpoints.** All admin work goes through a CLI on the server, which keeps the attack surface small.

## 3. Needs you (credentials, money, devices or decisions) 🔑
1. **Apple Developer** ($99/yr) and **Google Play** ($25) accounts. Organization accounts are recommended.
2. **Final bundle IDs.** Replace the `com.onlyads.app` placeholder **before the first upload**.
3. **A domain, then deploy the API** (Fly.io/Render/VPS + volume) with `APP_ENV=production`. Set `EXPO_PUBLIC_OFFERS_API_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` in EAS.
4. **Lawyer review** of `src/legal/content.ts` (privacy + terms). Fill the `[PLACEHOLDERS]`, set `reviewed: true`, host the exported markdown.
5. **Real advertisers.** At least a few approved, non-demo advertisers with live offers **before App Review**, or the app will be rejected as empty.
6. **Affiliate publisher accounts** (Awin/CJ/Impact) if you want catalog breadth. Each needs a server-side adapter (not built).
7. **Physical-device testing** with the plan in RELEASE.md §3.
8. **Optional:** a Sentry account (crash reports) and an analytics provider. Each one requires privacy-disclosure updates.

## 4. Remaining risks (known, not yet fixed)

| Risk | Severity | Mitigation / plan |
|---|---|---|
| **App Review "minimum functionality" (4.2) for an ads-only app.** This is the biggest product risk. | High | Launch with real advertisers and strong review notes (search, saving, controls, local deals). Expect possible back-and-forth with Apple. |
| Legal texts are drafts | High (release blocker) | Lawyer review. The release gate blocks until it's done. |
| Not tested on physical devices or simulators (none available in this environment) | High (release blocker) | Device test plan in RELEASE.md. |
| `decode-uri-component` advisory in expo-router (moderate) | Low | Upgrade to Expo SDK 58 in the next maintenance pass. |
| `node:sqlite` is marked experimental in Node 22 | Low–Medium | Pin Node 22.22.x. The API is stable in Node 24 (LTS), so move to it when convenient. Data lives in a standard SQLite file either way. |
| In-memory rate limiting is per instance | Low now | Fine on one instance. Use the edge or Redis with more instances. |
| Content policy is keyword-based | Medium | It's a first line of defense. The real control is vetting advertisers (new ones are held for review) and the instant suspend. |
| Advertiser images are hot-linked | Low | Proxy or cache images later (P3). Image failures already fall back to the generated art. |
| Alcohol-related ads affect the age rating | Low | Answer the questionnaire honestly (expect 13+) or ban the category in `policy.ts`. |

## 5. Untested assumptions (stated so nobody mistakes them for facts)
- Native behavior: real OS permission dialogs, Android back gestures, VoiceOver/TalkBack output, dynamic text at the largest sizes, edge-to-edge on Android 15+. These are implemented following the platform APIs but **verified only on web**.
- The privacy-manifest reason codes cover all required-reason APIs our dependencies use. Apple's upload validation will confirm.
- The App Store "Data Not Collected" and Play "approximate location, processed ephemerally" answers fit the current code. **Confirm with counsel.**
- Cost estimates in OPERATIONS §8 rest on the stated usage assumptions, not on measurements.
- Expo and React Native docs were blocked in this environment, so APIs were checked against the installed type definitions and by running builds, not against the online docs.
- On the web build, locale and measurement units come from the browser. On devices they come from the OS settings.
