# Only Ads

**The ads you actually want.** An iOS and Android app (Expo / React Native) for discovering deals, product drops, gift ideas and local specials, on the user's terms. It comes with a small API server that ingests advertiser feeds, moderates offers, and redirects clicks.

![Only Ads — light](docs/screenshots/overview-light.png)
![Only Ads — dark](docs/screenshots/overview-dark.png)

Design system, IA and UX decisions: **[docs/DESIGN.md](docs/DESIGN.md)**.

> **Status:** hardened MVP after a production-readiness audit ([docs/AUDIT.md](docs/AUDIT.md)), with all P0/P1 findings fixed. **It is not yet submitted to either store.** Real advertisers, legal review, store accounts and device testing are needed first. See [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md) and [docs/RELEASE.md](docs/RELEASE.md).

## Quick start (development)
```bash
npm install
npm run server                    # API on :8787 with fictional demo advertisers
EXPO_PUBLIC_OFFERS_API_URL=http://<your-LAN-IP>:8787 npx expo start --clear
```
Development and staging builds include a **fictional demo catalog** (labeled "Demo"). Production builds (`EXPO_PUBLIC_APP_ENV=production`) contain no demo data, which is verified by scanning the bundle.

## Scripts
| Command | What it does |
|---|---|
| `npm start` / `ios` / `android` / `web` | Expo dev server |
| `npm run test:all` | Typecheck + lint + app tests (156, incl. app-state integration) + server tests (57) + secret scan |
| `npm run server` / `npm run admin -- help` | API server / admin CLI (advertisers, feeds, moderation, backups) |
| `npm run release:check` | Release gate: fails until env, legal and native config are store-ready |
| `npm run legal:export` | Writes `docs/legal/*.md` from the in-app legal text (for hosting) |
| `node e2e/journeys.js` | 34 end-to-end checks: pagination, analytics consent, offline, dark mode… (setup in docs/OPERATIONS.md §7) |

## Architecture
```
src/                       App (Expo SDK 58, React Native 0.88, expo-router, TypeScript strict)
  app/                     Screens: tabs (Discover, Search, Saved, You), offer, category, nearby, legal, onboarding
  ui/                      Design-system components (Text, Button, Chip, StateView, Toast, ListRow, …)
  components/offers/       OfferCard (grid/hero/compact/row), OfferArt, SaveButton, PriceTag, presentation rules
  theme/                   Tokens (light + dark), ThemeProvider, makeStyles
  services/                ranking (on-device), search, http (timeout/retry), offerValidation, urlSafety,
                           providers (demo | API), monitoring (scrubbed), analytics (allow-listed)
  state/                   AppState (lifecycle-aware), persistence (versioned + migrations), offerCache (offline)
  legal/                   Privacy Policy + Terms (drafts pending legal review)
server/                    API (node:http + node:sqlite): migrations, feed adapters, ingestion, policy, rate limits,
                           click redirect + attribution, aggregate analytics, retention, admin CLI
e2e/                       Playwright journeys, bundle scanner, static server
docs/                      AUDIT, FINAL_REPORT, RELEASE, OPERATIONS, INTEGRATIONS, legal/
```

**Privacy by design:** no accounts. Saves, lists and history stay on the device; feed requests carry only picked interests and coarse category buckets, which the server doesn't store. Location is optional, approximate, and never stored on the server. Clicks are counted only as totals per offer.

**Docs:** [Design](docs/DESIGN.md) · [Audit](docs/AUDIT.md) · [Final report](docs/FINAL_REPORT.md) · [Release checklist](docs/RELEASE.md) · [Operations, env vars, costs](docs/OPERATIONS.md) · [Ad platform integrations research](docs/INTEGRATIONS.md)
