# Only Ads — advertising data: what we can and can't access

**Short answer:** no mainstream platform lets a third-party app read a person's personalized ad feed or ad-interest profile. Google and Meta don't, and their APIs aren't built for it. So Only Ads can't show "the ads Google or Meta would have shown you." Instead it builds its own **first-party, consented** personalization and gets ads from **advertisers who choose to take part**: affiliate networks, advertiser product feeds, and direct advertisers.

The table below is what this MVP actually implements. Statements about third-party platforms are research notes, and every one should be re-checked against the platform's current docs and terms before you build on it.

## 1. What the MVP implements

| Capability | Status | Where |
|---|---|---|
| Personalization from interests the user picks plus in-app engagement (save/open/click/dismiss), with diversity re-ranking and "why you're seeing this" reasons | **Working, unit-tested** | `src/services/ranking.ts` |
| **Server-side ranking of the whole catalog** (`GET /v1/feed`): same scoring as the app, plus aggregate popularity (smoothed click-through percentile, 14 days). Receives only picked interests + coarse category buckets; nothing stored | **Working, integration-tested** | `server/rank.ts` |
| **Merchant domain verification** (`/.well-known/onlyads-verify.txt` token) | **Working, tested** with mocked HTTP; not yet run against a real merchant | `server/verify.ts` |
| **Shopify store catalogs** (`shopify_products_json`) — only for merchants who verified their domain; nothing is fetched otherwise | **Parser + gate tested** against a fixture in the public `/products.json` shape; **not yet run against a live store** (no network here) | `server/adapters.ts` |
| **Column-mapped CSV** (`csv_mapped`) for affiliate network product exports and merchant spreadsheets; fails the run if a mapped column disappears | **Working, tested** with an Awin-style fixture (column names partly confirmed from Awin's docs; real exports vary — check the header of your actual file) | `server/adapters.ts` |
| **Conversion postbacks** (`/v1/postbacks/:network`), token-authenticated, idempotent, pending → confirmed → reversed; funnel report keeps impressions, clicks, attributed conversions and confirmed revenue separate | **Working, tested**; no partner has sent a real postback yet | `server/conversions.ts`, `npm run admin -- report` |
| Location for nearby deals: opt-in, rounded to ~1 km on the device **and** on the server, never stored on the server | **Working** (tested on web; the native permission prompts still need testing on a device) | `src/state/AppState.tsx`, `server/app.ts` |
| Parser for advertiser product feeds in Google Merchant Center / Meta catalog format | **Working, unit + integration tested** | `src/services/providers/productFeed.ts` |
| Server ingestion: scheduled, https-only, 30s timeout, 20 MB cap, upsert, deactivates items removed from a feed, hides stale feeds after 48h | **Working, integration-tested** | `server/ingest.ts` |
| Content policy: advertiser domain allow-list, prohibited categories, implausible discounts and deceptive wording → review queue, new advertisers held for review | **Working, tested** | `server/policy.ts`, `npm run admin -- review:list` |
| Click-out redirect `/v1/click/:id`: re-validates the link and advertiser on every click, counts clicks per offer per day with no personal data, can be revoked instantly by suspending the advertiser | **Working, tested end to end** | `server/app.ts` |
| Strict validation of every offer arriving over the network (unknown fields dropped, https-only links, no credentials/IP hosts) | **Working, tested including a hostile-payload E2E** | `src/services/offerValidation.ts` |
| Disclosure labels on every card and detail page (Sponsored / Affiliate link / Demo), solid pill with ≥ 4.5:1 contrast | **Working** | `src/components/bits.tsx` |
| Feed adapter registry (`merchant_tsv`, `direct_json`, `offers_json_api` with server-side bearer credentials) | **Working, tested** | `server/adapters.ts` |
| Attribution: per-advertiser tracking templates on the click redirect, anonymous click IDs matched by conversion postbacks | **Working, tested** | `server/app.ts`, admin `advertiser:attribution` |
| Ad model: availability by country, last verification time, campaign/network | **Working, tested** | `src/types/offer.ts`, migration 002 |
| Network-specific *API clients* (CJ, Impact, Awin, Rakuten…) | **Not implemented.** Needs publisher approval and a terms review. Their CSV product exports already work through `csv_mapped`. | — |
| Google / Meta user-level ad personalization | **Not possible** (see below) | — |

The app no longer reads advertiser feeds directly: every offer now goes through the server, so it can be moderated, de-duplicated, expired and revoked.

All brands, offers and feeds that ship with the app (including the server's `data/` folder) are **fictional demo content** and are labeled "Demo" in the UI.

## 2. Google

- **Your personalized ads or ad profile:** there is no API. "My Ad Center" is only for the user to look at and change their own settings. It does not expose data to other apps.
- **Google Ads API:** lets advertisers manage *their own* campaigns. Later it could help advertisers onboard (with their OAuth consent, import their assets or promotions), but it has no user-level personalization.
- **Merchant API (Merchant Center):** a merchant can give us access to their product data. Note: Google says the older **Content API for Shopping reached sunset on Aug 18, 2026**. Requests without an extension start failing intermittently from Sep 1, 2026, and the API shuts down fully in early 2027. Any new integration must use the **Merchant API**. Feed *files* uploaded by file, scheduled fetch or Google Sheets are not affected. That is why the MVP starts with the feed-file format, which works today with no Google API access at all.
- **AdMob / Google Ad Manager (us acting as a publisher):** this is the only route to Google's own ad personalization, because Google would choose the ads. But Google's publisher policy does **not allow Google-served ads on screens without publisher content**, and an app whose whole purpose is ads carries real policy risk. You would also need a consent flow (UMP/GDPR, and ATT on iOS). **Recommendation:** don't build the core product on it. If you want to try it, ask Google for a policy review first.

## 3. Meta

- **Your personalized ads or ad interests:** there is no API for third parties.
- **Ad Library API:** a public ad archive. Per third-party summaries, it covers all ads delivered in the EU/UK (because of the EU's Digital Services Act transparency rules) plus political/issue ads elsewhere. Access requires identity verification. It is **not personalized** and was built for transparency and research. Check the terms before any commercial use. At most it could power a "browse what brands are running" feature in the EU.
- **Marketing API:** lets advertisers manage their own accounts. Like the Google Ads API, it's useful only for onboarding advertisers.
- **Commerce catalogs:** use the same core attributes as Merchant Center, so the feed parser that's already implemented accepts them. An advertiser can share the catalog feed URL they already maintain.
- **Audience Network:** a publisher-monetization product with the same "screens made of ads" concern as AdMob. Not recommended.
- **Possible feature (not built):** a user could choose to import their own "Download Your Information" export, and we would parse the ad-topic data **on the device** to seed their interests. The export format has not been verified.

## 4. Affiliate networks and advertiser feeds (the realistic way to get offers)

| Source | What it gives | Requirements | Notes |
|---|---|---|---|
| CJ, Impact, Awin, Rakuten Advertising | Product catalogs, promotions/coupons, tracked links | Approved publisher account. Each advertiser approves us separately. API keys stay on the **server**. | Fastest way to get a broad catalog and the first revenue (commission). The specific endpoints were not re-checked in this session. |
| Merchant Center / Meta catalog feeds from participating advertisers | Full product data, sale prices, sale dates | The advertiser shares a feed URL, or grants Merchant API access | **Parser implemented and tested** |
| Direct / self-serve advertisers | Local deals, promo codes, events | An advertiser portal (not built). For now, JSON at `server/data/direct-offers.json` | Best source of local and food deals |

## 4b. Fastest legitimate paths to real catalogs (researched 2026-10-28)

| Path | Approval needed | Time to first real offers | Status in code |
|---|---|---|---|
| **Direct merchants** (e.g. a Shopify store owner) verify their domain → we read their own `/products.json` | Only the merchant's consent | Same day | Ready: `advertiser:verify-start/check`, `shopify_products_json` |
| **Merchant feed URL** (Google Merchant Center / Meta catalog TSV/CSV the merchant already maintains) | Only the merchant's consent | Same day | Ready: `merchant_tsv` |
| **Affiliate network exports** (Awin, CJ, Impact, Rakuten product feeds as CSV) | Publisher account + each advertiser's approval | Days–weeks | Ready: `csv_mapped` with a per-feed mapping; attribution + postbacks ready |
| **Amazon** (Creators API, which replaces PA-API 5) | Associates enrollment **and** 10 qualifying sales in the trailing 30 days | Weeks+ | Not built |
| **eBay Buy APIs** | eBay Partner Network membership; Buy APIs are for approved partners | Weeks+ | Not built |
| Scraping public store pages or `products.json` without permission | — | — | **Not allowed** — the Shopify adapter refuses unverified domains before fetching |

Sources: [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction) · [PA-API 5 deprecation](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation) · [eBay buying apps](https://developer.ebay.com/develop/get-started/get-started-on-a-buying-application) · [Awin publisher feed FAQ](https://developer.awin.com/docs/enhanced-feeds-publisher-faq) · [Awin feed column descriptions (PDF)](https://cdn.document360.io/ec9ead62-8ecc-46ef-aac7-9b0a9081b40b/Images/Documentation/PM-FeedColumnDescriptions(1).pdf) · CJ requires a publisher account and per-advertiser approval before API keys ([summary](https://apis.io/plans/cj-affiliate/cj-affiliate-plans-pricing/) — confirm in CJ's own docs).

### Activating each source
```bash
# Direct merchant with a Shopify store
npm run admin -- advertiser:add casa "Casa Store" casa-store.com
npm run admin -- advertiser:verify-start casa casa-store.com      # merchant publishes the printed line
npm run admin -- advertiser:verify-check casa
echo '{"currency":"USD","defaultCategory":"home"}' > casa.json
npm run admin -- feed:add casa-shop casa shopify_products_json https://casa-store.com/products.json --mapping casa.json

# Affiliate network export (example column names — copy them from YOUR file's header)
cat > strider.json <<'JSON'
{ "columns": { "id": "aw_product_id", "title": "product_name", "link": "aw_deep_link", "price": "search_price",
               "image_link": "merchant_image_url", "category": "merchant_category", "brand": "brand_name" },
  "currency": "GBP", "categories": { "running shoes": "sneakers", "clothing": "fashion" }, "defaultCategory": "gifts" }
JSON
npm run admin -- advertiser:add strider "Strider" awin1.com --affiliate   # allowed domain = the network's tracking-link domain
npm run admin -- feed:add strider-awin strider csv_mapped https://<feed-url-from-the-network> --mapping strider.json
npm run admin -- advertiser:attribution strider "clickref={click_id}" --network awin   # sub-ID parameter per the network's docs
# then set POSTBACK_TOKEN_AWIN on the server and give the network: npm run admin -- postback:url awin
```
Shopify's public `/products.json` returns a limited page of products per request; very large stores should share a Merchant Center feed URL instead.

## 5. Architecture (what the code implements)

```
 App (Expo)  ──GET /v1/offers──────►  Only Ads API (server/, SQLite)
   on-device ranking, saves,          ├─ scheduled feed ingestion + content policy   ✅
   interests + coarse buckets per    ├─ direct advertiser offers (direct_json feed)  ✅
   request (not stored)               ├─ /v1/feed full-catalog ranking + popularity    ✅
   coarse location (opt-in)           ├─ moderation queue + admin CLI                ✅
            ──GET /v1/click/:id──►    ├─ click redirect + aggregate counts            ✅
                                      ├─ csv_mapped (network exports), shopify (verified) ✅
                                      ├─ conversion postbacks + funnel report          ✅
                                      ├─ network API clients                           ⬜ (need your publisher accounts)
                                      └─ self-serve advertiser portal                 ⬜
```

Each source is mapped to one `Offer` model (`src/types/offer.ts`). The UI never needs to know where an offer came from, apart from showing the disclosure label.

## 6. Compliance checklist (before launch)

- **Ad disclosures:** "Sponsored" and "Affiliate" labels are implemented on every card and on the detail page. Paid placement only breaks ties in ranking; this is tested.
- **Privacy:** the app does no cross-app tracking, so it shouldn't need an ATT prompt as long as that stays true. You'll still need App Store privacy labels and a Play Data Safety form. If you ever move profiles to the server, you'll need GDPR/CCPA consent and data deletion. The "Erase all my data" button already covers the local data.
- **Location:** foreground permission only, coarse (~1 km), never sent to advertisers. The server receives coordinates rounded to 2 decimal places.

### Sources
- Google — Content API for Shopping deprecation and sunset: https://developers.google.com/shopping-content/guides/sunset
- Google — Ads on screens without publisher content: https://support.google.com/publisherpolicies/answer/11112688
- AdMob policy guidance: https://support.google.com/admob/answer/6293636
- Meta Ad Library / DSA repository overview (third-party, verify against Meta's docs): https://adlibrary.com/posts/eu-dsa-ad-repositories-developers
