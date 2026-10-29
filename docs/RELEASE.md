# Releasing Only Ads to the App Store and Google Play

This is the founder's checklist. Items marked 🔑 need your accounts, money or decisions. Run `npm run release:check` first: it blocks the release until the automated items pass.

## 0. Before anything (one-time) 🔑
| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99/year | Enroll as an **organization** (needs a D-U-N-S number) so the seller name is your company, not your personal name. |
| Google Play Console | $25 once | An **organization** account skips the "12 testers for 14 days" closed-test rule that new personal accounts must meet before going to production. |
| Expo account + EAS | Free tier to start | `npx eas-cli@latest login`, then `npx eas-cli@latest init` (adds `owner` and `projectId` to app.json). |
| Domain | ~$15/year | For `api.yourdomain.com`, the privacy policy URL, and the support email. |
| Lawyer review | One-off | Privacy Policy + Terms drafts in `src/legal/content.ts`. Then set `reviewed: true`. |
| Bundle IDs | — | `com.onlyads.app` is a placeholder. Change it in app.json to a reverse-domain name you own **before your first upload** (it can't be changed afterwards). |

## 1. Environments
| Environment | App build (EAS profile) | API | Data |
|---|---|---|---|
| development | `development` (`EXPO_PUBLIC_APP_ENV=development`) | local `npm run server` | demo catalog + demo advertisers |
| staging | `preview` | staging API (`APP_ENV=staging`) | demo advertisers allowed, real test feeds |
| production | `production` | production API (`APP_ENV=production`) | **never** demo data (enforced in app bundle and in API) |

Set `EXPO_PUBLIC_OFFERS_API_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL` per environment in **EAS → Environment variables** (environments `preview` and `production`). These values are public. **Never put API keys or secrets in `EXPO_PUBLIC_*` variables.**

## 2. Build & sign
```bash
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest build -p android --profile production
```
- EAS creates and stores the signing credentials (iOS distribution certificate and profile, Android upload keystore). Let EAS manage them, and download a backup of the Android keystore (`eas credentials`). If you lose it, you lose the ability to update the app.
- Build numbers auto-increment (`appVersionSource: remote`). Bump `version` in app.json for each user-visible release.
- Apple only accepts builds made with **Xcode 26 / the iOS 26 SDK** (required since 2026-04-28). EAS's default image handles this, but confirm in the build log.
- Expo SDK 58 targets **Android API 36**, which Google Play requires for new apps and updates from 2026-08-31.

## 3. Test tracks
- **iOS — TestFlight:** `npx eas-cli@latest submit -p ios` uploads the build. Internal testers (up to 100 people on your team) get it immediately. External testers need a short beta review.
- **Android — Play testing:** upload to **Internal testing** first, then **Closed testing**. New *personal* developer accounts must run a closed test with **at least 12 testers opted in for 14 continuous days** before Production unlocks.

### Device test plan (must be done on real phones) 🔑
Do this on at least one recent iPhone, one older iPhone (iOS 16.4+), one Pixel and one budget Android (Android 7+ / API 24+):
1. Fresh install → onboarding → feed loads.
2. Allow location, then deny location (and "Allow once" on iOS / "Approximate" on Android) → Nearby behaves correctly.
3. Airplane mode → reopen the app → offline banner with cached offers → turn the network back on → Retry.
4. Save an offer → force-quit → reopen → it's still saved.
5. Background the app for over 15 minutes → reopen → the feed refreshes and expired offers disappear.
6. Tap "Shop now" → the advertiser page opens in the browser (via the click redirect).
7. Android back button: onboarding steps, the detail screen, and exiting the app.
8. Largest system text size and VoiceOver/TalkBack: every card announces brand, title, price, expiry and the Sponsored/Affiliate label.
9. Small screen (iPhone SE size) and a tall phone: nothing is clipped. The keyboard doesn't cover the search input.
10. Upgrade test: install the previous build, save offers, install the new build over it → data is kept (the storage migration runs).

## 4. Store listings 🔑

### Apple App Store Connect
- **Privacy Policy URL** (required) and **Support URL**. Host `docs/legal/privacy.md` (`npm run legal:export`).
- **App Privacy ("nutrition label")** — based on what the code does today:
  - *Data collection:* Apple counts data as "collected" only if it is sent off the device and kept longer than needed to answer the request. Coarse location is sent with offer requests but is not stored or logged, and click counts are aggregated with no identifier. So "**Data Not Collected**" is defensible **while that stays true**. If you add crash reporting (Sentry), declare *Diagnostics → Crash Data / Performance Data, not linked to identity, not used for tracking*. Confirm with counsel.
  - Tracking: **No**. The app has no IDFA, no ATT prompt, and no data broker sharing.
- **Age rating questionnaire:** ads can mention alcohol (happy hours) → answer "Alcohol… References: Infrequent/Mild". Expect **13+** under Apple's new ratings. If you want a 4+ rating, add alcohol to the `PROHIBITED` policy in `server/policy.ts`.
- **Guideline risks to prepare for:**
  - *4.2 Minimum functionality / "app is just ads":* in the review notes, explain that the product is opt-in deal discovery, with search, saving, personalization controls and local deals.
  - *2.1 App completeness:* the production build contains no demo content. Make sure the production API has **real, approved advertisers** at review time. An empty feed will be rejected.
  - *5.1.1 Data collection:* location is optional and the purpose string explains it.
- **Screenshots:** 6.9" iPhone (1320×2868) is required. The app is iPhone-only for v1 (`supportsTablet: false`), so no iPad screenshots are needed.

### Google Play Console
- **Data safety form** (suggested answers — confirm with counsel):
  - Location → *Approximate location*: **collected**, **processed ephemerally**, not shared, optional, purpose: *App functionality*.
  - App activity / identifiers / personal info: not collected.
  - Data encrypted in transit: yes (HTTPS only). Users can request deletion: yes (in-app "Erase all my data"; no account exists).
  - If you add Sentry: *App info and performance → Crash logs, Diagnostics*.
- **Content rating (IARC questionnaire)**, **Target audience** (13+ recommended; not designed for children), **Ads declaration: "Yes, contains ads."**
- **Account deletion requirement:** doesn't apply, because the app has no accounts. If you add accounts, you'll need in-app deletion **and** a web deletion URL on both stores.
- Feature graphic 1024×500, phone screenshots, short and full description.

### Draft store copy
> **Only Ads — Deals you choose**
> The ads you actually want. Browse deals, product drops, gift ideas and local specials — only when you feel like shopping. Pick your interests, save favorites, mute brands, and see why every offer is shown. No account needed, and your preferences stay on your phone. Sponsored and affiliate offers are always labeled.

## 5. Release-day checklist
- [ ] `npm run test:all` green, and the E2E suite green (docs/OPERATIONS.md)
- [ ] `npm run release:check -- --bundle <prod export dir>` shows **no FAIL**
- [ ] Production API healthy (`/health`), backups running, at least one approved real advertiser with live offers
- [ ] Device test plan done on iOS and Android
- [ ] Store listings, privacy label / Data safety, age rating, review notes
- [ ] Staged rollout on Play (start at 10–20%) and phased release on iOS
