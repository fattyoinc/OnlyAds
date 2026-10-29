/**
 * End-to-end user journeys (Playwright, iPhone 13 viewport) against real web exports.
 *
 * Setup (see docs/OPERATIONS.md → "Running the E2E suite"):
 *   1. npm run server                                   (API on :8787, demo data)
 *   2. staging export  → node e2e/serve-dist.js <dir> 8081
 *        EXPO_PUBLIC_APP_ENV=staging EXPO_PUBLIC_OFFERS_API_URL=http://localhost:8787 EXPO_PUBLIC_SUPPORT_EMAIL=support@example.com
 *   3. production export → node e2e/serve-dist.js <dir> 8082
 *        EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_OFFERS_API_URL=https://api.onlyads.invalid
 *   4. node e2e/journeys.js [screenshotDir]
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const STAGING = process.env.STAGING_URL ?? 'http://localhost:8081';
const PROD = process.env.PROD_URL ?? 'http://localhost:8082';
const OUT = process.argv[2] ?? path.join(__dirname, '..', 'docs', 'screenshots', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const helpers = {
    t: (s) => page.getByText(s, { exact: true }).filter({ visible: true }).first(),
    visible: async (s, exact = true) => (await page.getByText(s, { exact }).filter({ visible: true }).count()) > 0,
    shot: async (n) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${n}.png`) });
    },
  };
  return { ctx, page, errors, ...helpers };
}

async function onboard(h, interests = ['Food & Drink', 'Fashion', 'Tech'], opts = {}) {
  await h.page.waitForTimeout(1500);
  if (opts.optOut) await h.page.getByRole('switch', { name: 'Share anonymous usage stats' }).click();
  for (const c of interests) await h.page.getByRole('button', { name: c, exact: true }).first().click();
  await h.page.getByRole('button', { name: /^Start exploring/ }).click();
  await h.page.waitForTimeout(1800);
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- staging
  {
    const h = await newPage(browser);
    const { page } = h;
    await page.goto(STAGING);
    await page.waitForTimeout(1500);
    check('onboarding offers a clear usage-stats choice', await h.visible('Share anonymous usage stats'));
    const feedUrls = [];
    page.on('request', (r) => r.url().includes('/v1/feed') && feedUrls.push(r.url()));
    const eventsPosted = page.waitForResponse((r) => r.url().endsWith('/v1/events') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
    await onboard(h);
    const evRes = await eventsPosted;
    check('usage stats reach the server after onboarding (202 accepted)', !!evRes && evRes.status() === 202, evRes ? String(evRes.status()) : 'no request');

    // Pagination: scrolling to the end of the feed loads page 2 with the cursor.
    const page2 = page.waitForRequest((r) => /\/v1\/feed\?.*cursor=/.test(r.url()), { timeout: 15000 }).catch(() => null);
    await page.mouse.move(190, 500);
    for (let i = 0; i < 40 && !(await h.visible('You’re all caught up. New offers arrive daily.')); i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(250);
    }
    const p2 = await page2;
    check('infinite scroll requests the next page by cursor', !!p2, p2?.url());
    check('end of feed is stated, not a blank or spinner', await h.visible('You’re all caught up. New offers arrive daily.'));
    check('offers restricted to other countries are hidden (CA-only product, US device)', (await page.getByText('Wool Beanie — Night').count()) === 0);
    await page.mouse.wheel(0, -200000);
    await page.waitForTimeout(500);
    check('staging: feed renders (top picks + masonry "For you")', (await h.visible('Top picks')) && (await h.visible('For you')));
    check('demo content is clearly labeled', await h.visible('Demo build · fictional brands, not real deals'));
    const tabBox = await page.getByText('Discover', { exact: true }).last().boundingBox();
    check('tab bar labels are not clipped', !!tabBox && tabBox.y + tabBox.height <= page.viewportSize().height - 2, JSON.stringify(tabBox));

    // In-place filtering via the discovery bar.
    await page.getByRole('tab', { name: 'Sneakers' }).click();
    await page.waitForTimeout(500);
    check('discovery bar filters the feed in place', (await page.getByText(/^\d+ offers? · Releases/).count()) > 0);
    await page.getByRole('tab', { name: 'Nearby' }).click();
    await page.waitForTimeout(400);
    check('location is explained before any system prompt', (await h.visible('Find deals near you')) && (await h.visible('Turn on location')));
    await page.getByRole('tab', { name: 'For you' }).click();
    await page.waitForTimeout(400);

    // Save from a card → toast with a shortcut to Saved.
    await page.getByLabel(/^Save /).filter({ visible: true }).first().click();
    await page.waitForTimeout(300);
    check('saving shows confirmation toast', await h.visible('Saved to your favorites'));
    await h.t('View').click();
    await page.waitForTimeout(600);
    check('toast "View" opens Saved', (await page.getByText('Saved', { exact: true }).count()) > 0 && (await page.getByText(/kept even after deals change/).count()) > 0);
    await h.t('Discover').click();
    await page.waitForTimeout(500);
    await h.shot('j01-staging-home');

    // Disclosure pills are present and readable.
    check('sponsored placements are labeled on cards', (await page.getByText(/^Sponsored/).count()) > 0);

    // Server-delivered offer, detail, click-out through the redirect.
    await page.getByLabel(/Search deals/).filter({ visible: true }).first().click();
    await page.getByLabel('Search offers').fill('parka');
    await page.waitForTimeout(500);
    check('API offer searchable', await h.visible('Alpine Down Parka'));
    // Tabs keep other screens mounted: click the copy inside the Search results (last in DOM).
    await page.getByText('Alpine Down Parka', { exact: true }).last().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Why you’re seeing this' }).click();
    await page.waitForTimeout(300);
    check('detail shows when the offer was last verified', (await page.getByText(/^Checked .* with the advertiser$/).count()) > 0);
    check('detail shows source + report option', (await h.visible('Source: Advertiser product feed', false)) && (await h.visible('Report')));
    await h.shot('j02-detail');
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    const reqPromise = page.context().waitForEvent('request', { predicate: (r) => r.url().includes('/v1/click/'), timeout: 5000 }).catch(() => null);
    await h.t('Shop now').click();
    const [popup, req] = await Promise.all([popupPromise, reqPromise]);
    check('click-out goes through /v1/click redirect', !!req && req.url().endsWith('/v1/click/northbeam-NB-001'), req?.url());
    if (popup) await popup.close();
    // Double tap protection: two fast taps → at most one more popup.
    let popups = 0;
    page.on('popup', (p) => {
      popups++;
      p.close().catch(() => {});
    });
    await page.waitForTimeout(1600);
    await h.t('Shop now').click();
    await h.t('Shop now').click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    check('double tap opens only one tab', popups <= 1, `popups=${popups}`);

    // Save then cold-start deep link to the offer (fresh page, same storage).
    await page.getByLabel(/^Save Alpine/).filter({ visible: true }).first().click();
    const deep = await page.context().newPage();
    await deep.goto(`${STAGING}/offer/northbeam-NB-001`);
    await deep.waitForTimeout(300);
    const flashedNotFound = (await deep.getByText('Offer not found').count()) > 0;
    await deep.waitForTimeout(2000);
    check('cold-start deep link opens the offer (no "not found" flash)', !flashedNotFound && (await deep.getByText('Alpine Down Parka').filter({ visible: true }).count()) > 0);
    await deep.close();
    check('feed is ranked server-side with the picked interests', feedUrls.some((u) => u.includes('interests=fashion,food,tech')), feedUrls.at(-1));

    // Shopping list: create from the detail page, find it in Saved, share it.
    await page.getByRole('button', { name: 'Add to a list' }).click();
    await page.waitForTimeout(300);
    await h.t('New list').click();
    await page.getByLabel('List name').fill('Winter trip');
    await h.t('Create and add').click();
    await page.waitForTimeout(500);
    check('offer added to a new shopping list', await h.visible('In “Winter trip”'));
    await page.goto(`${STAGING}/saved`);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Winter trip, 1 items?/ }).click();
    await page.waitForTimeout(400);
    check('list shows its offers in Saved', (await page.getByText('Alpine Down Parka').filter({ visible: true }).count()) > 0);
    await h.shot('j02b-list');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Share' }).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('list can be shared as text with links', clip.startsWith('Winter trip') && clip.includes('Alpine Down Parka') && clip.includes('https://'), clip.slice(0, 60));
    await page.goto(STAGING);
    await page.waitForTimeout(1500);

    // Offline: API unreachable → cached offers + offline banner, then recovery.
    await page.route('**/v1/feed**', (r) => r.abort('internetdisconnected'));
    await page.goto(STAGING);
    await page.waitForTimeout(4500); // retries with backoff
    check('offline: banner + cached API offers still shown', (await h.visible('You’re offline', false)) && (await page.getByText('Alpine Down Parka').count()) > 0);
    await h.shot('j03-offline-banner');
    await page.unroute('**/v1/feed**');
    await h.t('Retry').click();
    await page.waitForTimeout(2000);
    check('retry recovers when the network returns', !(await h.visible('You’re offline', false)));

    // Server errors: 500s are retried, then reported without blanking the feed.
    let hits = 0;
    await page.route('**/v1/feed**', (r) => {
      hits++;
      r.fulfill({ status: 503, body: '{}' });
    });
    await page.goto(STAGING);
    await page.waitForTimeout(4500);
    check('5xx retried (3 attempts) and surfaced as a banner', hits === 3 && ((await h.visible('You’re offline', false)) || (await h.visible('Some offers couldn’t load', false))), `attempts=${hits}`);
    await page.unroute('**/v1/feed**');

    // Malicious payload from a compromised API is dropped, app keeps working.
    await page.route('**/v1/feed**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ offers: [{ id: 'evil', title: 'Evil', url: 'javascript:alert(1)', category: 'tech', advertiser: { id: 'x', name: 'X' } }, { id: 'weird', title: 'Weird', url: 'https://ok.example.com', category: 'tech', advertiser: { id: 'x', name: 'X' }, tags: 5, price: 'free', creative: { icon: 'not-a-glyph' } }] }),
      }),
    );
    await page.goto(STAGING);
    await page.waitForTimeout(2500);
    await page.getByLabel(/Search deals/).filter({ visible: true }).first().click();
    await page.getByLabel('Search offers').fill('weird');
    await page.waitForTimeout(400);
    check('hostile payload: unsafe offer dropped, malformed fields sanitized, no crash', (await h.visible('Weird')) && !(await h.visible('Evil')) && h.errors.length === 0);
    await page.unroute('**/v1/feed**');

    // Legal pages + erase data.
    await page.goto(`${STAGING}/profile`);
    await page.waitForTimeout(1500);
    await page.mouse.move(190, 500);
    await page.mouse.wheel(0, 3000);
    await h.t('Privacy Policy').click();
    await page.waitForTimeout(500);
    check('privacy policy reachable in-app', await h.visible('Privacy Policy'));
    await h.shot('j04-privacy');
    await page.getByLabel('Back').filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    await h.t('Erase all my data').click();
    await page.waitForTimeout(1200);
    check('erase all data returns to onboarding and clears storage', (await page.getByRole('button', { name: /^Start exploring/ }).count()) > 0 && (await page.evaluate(() => localStorage.getItem('onlyads:offers-cache:v1'))) === null);

    check('staging: no uncaught page errors', h.errors.length === 0, h.errors.join(' | '));
    await h.ctx.close();
  }

  // ------------------------------------------------------------- production
  {
    const h = await newPage(browser);
    const { page } = h;
    await page.goto(PROD);
    await onboard(h);
    await page.waitForTimeout(5000);
    const demoVisible = (await page.getByText(/Forno Nove|Smashville|Demo catalog/).count()) > 0;
    check('production: no demo ads anywhere', !demoVisible);
    check('production: honest error state when API unreachable', (await h.visible('Can’t load offers')) && (await h.visible('Try again')));
    await h.shot('j05-prod-error');
    await page.goto(`${PROD}/nearby`);
    await page.waitForTimeout(2500);
    check('production: Nearby asks for location instead of using a fake city', (await h.visible('Find deals near you')) && (await h.visible('Turn on location')));
    await h.shot('j06-prod-nearby');
    check('production: no uncaught page errors', h.errors.length === 0, h.errors.join(' | '));
    await h.ctx.close();
  }

  // ------------------------------------------------- dark mode + reduced motion
  {
    const h = await newPage(browser, { colorScheme: 'dark', reducedMotion: 'reduce' });
    const { page } = h;
    await page.goto(STAGING);
    await onboard(h, []);
    const bg = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.getBoundingClientRect().height > 600 && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    check('dark mode follows the system appearance', bg === 'rgb(15, 15, 17)', bg);
    check('first-time user with no interests gets a "Make it yours" prompt', await h.visible('Make it yours'));
    await page.getByLabel(/^Save /).filter({ visible: true }).first().click();
    await page.waitForTimeout(300);
    check('reduced motion: interactions still work, no errors', (await h.visible('Saved to your favorites')) && h.errors.length === 0, h.errors.join(' | '));
    await h.shot('j07-dark');
    await h.ctx.close();
  }

  // ------------------------------------------------------------- opt-out
  {
    const h = await newPage(browser);
    const { page } = h;
    let posted = 0;
    page.on('request', (r) => {
      if (/\/v1\/(events|impressions)$/.test(r.url())) posted++;
    });
    await page.goto(STAGING);
    await onboard(h, ['Tech'], { optOut: true });
    await page.getByLabel(/^Save /).filter({ visible: true }).first().click();
    await page.mouse.move(190, 500);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2500);
    check('opting out: no analytics or impression requests are sent', posted === 0, `requests=${posted}`);
    await h.ctx.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('E2E crashed:', e.message);
  process.exit(1);
});
