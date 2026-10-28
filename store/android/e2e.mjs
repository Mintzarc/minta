// End-to-end checks of the real site at phone, tablet and desktop sizes, no wallet and nothing sent:
//   node store/android/e2e.mjs                       against https://minta.vyrechain.com
//   MINTA_SITE=http://127.0.0.1:4173 node store/android/e2e.mjs    against a local `npm run build && npx vite preview`
//   node store/android/e2e.mjs phone                 one size (phone | tablet | desktop)
// Exit code 0 only when no check FAILs. Each line is PASS, FAIL or WARN (WARN is a fact to know, not a failure).
// STRICT_TOUCH=1 turns the 48 x 48 touch-target findings into FAILs.
// Needs the repo's packages and Playwright's Chromium (npx playwright install chromium).
import { chromium } from 'playwright';
import { SITE, skipSplash, firstTokenHash } from './viewports.mjs';

const SIZES = {
  phone:   { viewport: { width: 360, height: 640 },   mobile: true,  touch: true },
  tablet:  { viewport: { width: 800, height: 1280 },  mobile: true,  touch: true },
  desktop: { viewport: { width: 1920, height: 1080 }, mobile: false, touch: false },
};
const only = process.argv[2];
let failed = 0;
const say = (lvl, size, msg) => { if (lvl === 'FAIL') failed += 1; console.log(`${lvl} [${size}] ${msg}`); };
const ok = (size, cond, msg, detail = '') => say(cond ? 'PASS' : 'FAIL', size, cond ? msg : `${msg} ${detail}`.trim());

const browser = await chromium.launch();

async function overflow(page) {
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
}
/** Visible controls smaller than 48 x 48 CSS px (= 48 dp). Links inside a line of text are exempt, as in WCAG. */
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a, [role=button], [role=tab], [role=menuitem]')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;
      if (el.tagName === 'A' && (cs.display === 'inline') && el.closest('p, li, span, small, td')) continue; // inline text link
      if (r.width < 48 || r.height < 48) out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return [...new Set(out)];
  });
}

for (const [size, cfg] of Object.entries(SIZES)) {
  if (only && only !== size) continue;
  const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1, isMobile: cfg.mobile, hasTouch: cfg.touch, locale: 'en-US' });
  const page = await ctx.newPage();
  await skipSplash(page);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500); };
  const go = async (p) => { await page.goto(`${SITE}${p}`, { waitUntil: 'domcontentloaded' }); await settle(); };

  // 1. Explore: the list loads with at least one launch
  await go('/#/');
  const tokenHash = await firstTokenHash(page).catch(() => null);
  ok(size, !!tokenHash, 'Explore lists at least one launch (a link to a token page)');
  let o = await overflow(page);
  ok(size, o.sw <= o.iw + 1, 'Explore has no sideways overflow', `(${o.sw} > ${o.iw})`);
  ok(size, !(await page.title()).includes('undefined') && /MINTA/.test(await page.title()), 'the page has a MINTA title');

  // 2. A token page: real data (price, market cap, a Buy panel, settings with a tax)
  if (tokenHash) {
    await go(`/${tokenHash}`);
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle();
    const t = await page.locator('body').innerText();
    ok(size, /Price/.test(t) && /Market cap/.test(t) && /Buy/.test(t) && /Sell/.test(t), 'the token page shows price, market cap and the Buy / Sell panel');
    ok(size, /\d+(\.\d+)?%/.test(t) && /tax/i.test(t), 'the token page shows its tax in plain words');
    o = await overflow(page);
    ok(size, o.sw <= o.iw + 1, 'the token page has no sideways overflow', `(${o.sw} > ${o.iw})`);

    // 3. Report a token: the button opens a panel with the message and the two ways to send it; nothing is sent from the page
    const rep = page.getByRole('button', { name: 'Report this token' });
    if (await rep.count()) {
      await rep.click();
      const panel = page.locator('.report-token');
      const txt = await panel.innerText();
      ok(size, /Report token \$/.test(txt) && /0x[0-9a-fA-F]{40}/.test(txt), 'Report this token shows the message with the ticker and address');
      const hrefs = await panel.locator('a').evaluateAll((as) => as.map((a) => a.href));
      ok(size, hrefs.some((h) => h.startsWith('https://t.me/')) && hrefs.some((h) => h.startsWith('https://x.com/MintaLaunchpad')), 'Report this token links to MINTA on Telegram and X');
    } else {
      say('WARN', size, 'Report this token is not on this site yet (it comes with this branch once deployed): run against a local build to test it');
    }
  }

  // 4. The launch wizard walks to its last step with no wallet, and nothing is sent
  await go('/#/launch');
  const sent = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /rpc\./.test(r.url()) && /eth_sendRawTransaction|eth_sendTransaction/.test(r.postData() || '')) sent.push(r.url()); });
  if (await page.getByText('Launches are closed', { exact: false }).count()) {
    say('WARN', size, 'the wizard shows a launches-closed notice: its steps are not reachable');
  } else {
    await page.getByLabel('Token name').fill('Test Walk').catch(() => {});
    await page.getByPlaceholder('MYT', { exact: false }).first().fill('WALK').catch(() => {});
    await page.locator('textarea').first().fill('A walk through the steps. Nothing is sent.').catch(() => {});
    // without a wallet the last step offers "Connect Wallet" where a connected one gets "Review"
    const last = page.locator('.wz-panel').getByText('Final check.', { exact: true });
    let clicks = 0;
    for (let i = 0; i < 6 && !(await last.count()); i++) {
      const next = page.getByRole('button', { name: /Next step/ });
      if (!(await next.count()) || !(await next.first().isEnabled())) break;
      await next.first().click(); clicks += 1; await page.waitForTimeout(500);
    }
    ok(size, (await last.count()) === 1 && clicks === 4, 'the wizard walks four Next steps to "Review & launch / Final check"', `(Next clicked ${clicks} times)`);
    const t = await page.locator('.wz-panel').innerText();
    ok(size, /\$WALK/.test(t) && /Test Walk/.test(t) && /Buy \/ sell tax/.test(t), 'the final step shows what was typed (ticker, name) and the tax');
    ok(size, (await page.getByRole('button', { name: 'Connect Wallet' }).count()) >= 1, 'with no wallet the last step asks to connect one (there is nothing to send)');
    o = await overflow(page);
    ok(size, o.sw <= o.iw + 1, 'the wizard has no sideways overflow', `(${o.sw} > ${o.iw})`);
    ok(size, sent.length === 0, 'no transaction was sent');
  }

  // 5. Pages that must load: wallet, docs, terms, privacy, AI assistants
  for (const [p, re, label] of [['/#/wallet', /YOUR USDC|Your USDC/i, 'Wallet'], ['/#/docs', /MINTA DOCS|Docs/i, 'Docs'], ['/terms/', /Terms of Service/i, 'Terms'], ['/privacy/', /Privacy Policy/i, 'Privacy'], ['/agents/', /AI assistant/i, 'AI assistants']]) {
    await go(p);
    const t = await page.locator('body').innerText();
    ok(size, re.test(t), `${label} page loads`);
    o = await overflow(page);
    ok(size, o.sw <= o.iw + 1, `${label} page has no sideways overflow`, `(${o.sw} > ${o.iw})`);
  }
  await go('/privacy/');
  ok(size, (await page.locator('#delete').count()) === 1, 'the privacy page has the "Deleting your data" section (#delete)');

  // 6. Digital Asset Links file (what lets the Android app open without a browser bar)
  const al = await ctx.request.get(`${SITE}/.well-known/assetlinks.json`);
  ok(size, al.status() === 200 && /application\/json/.test(al.headers()['content-type'] || ''), 'assetlinks.json is served as application/json', `(status ${al.status()}, ${al.headers()['content-type']})`);
  if (al.status() === 200) {
    const j = await al.json().catch(() => null);
    if (Array.isArray(j) && j.length === 0) say('WARN', size, 'assetlinks.json is empty: add the Play signing fingerprint after the first upload (docs/ANDROID.md step 9)');
    else ok(size, Array.isArray(j) && j.every((e) => e.target?.package_name === 'com.vyrechain.minta'), 'assetlinks.json names com.vyrechain.minta');
  }
  const mf = await (await ctx.request.get(`${SITE}/manifest.webmanifest`)).json().catch(() => ({}));
  ok(size, mf.display === 'standalone' && (mf.icons || []).some((i) => i.purpose === 'maskable'), 'the web manifest is standalone and has a maskable icon');

  // 7. Touch targets of 48 dp on the screens that matter (phone and tablet)
  if (cfg.touch) {
    for (const [p, label] of [['/#/', 'Explore'], ['/#/launch', 'Launch'], [tokenHash ? `/${tokenHash}` : '/#/', 'Token']]) {
      await go(p);
      const small = await smallTargets(page);
      // a finding about the site's own styling, not a failure of the wrapper: WARN, or FAIL with STRICT_TOUCH=1
      if (small.length === 0) say('PASS', size, `${label}: every button, field and menu link is at least 48 x 48`);
      else say(process.env.STRICT_TOUCH ? 'FAIL' : 'WARN', size, `${label}: ${small.length} controls under 48 x 48: ${small.slice(0, 8).join('; ')}`);
    }
  }

  // 8. Text scaling (150%, an approximation of the phone's font-size setting) and rotation
  if (cfg.touch) { // phones and tablets: the font-size setting; a desktop browser zooms the whole page instead
    await go('/#/');
    await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
    await page.waitForTimeout(500);
    o = await overflow(page);
    ok(size, o.sw <= o.iw + 1, 'Explore at 150% text size has no sideways overflow', `(${o.sw} > ${o.iw})`);
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  }
  if (cfg.mobile) {
    const { width, height } = cfg.viewport;
    await page.setViewportSize({ width: height, height: width });
    for (const p of ['/#/', '/#/launch']) { await go(p); o = await overflow(page); ok(size, o.sw <= o.iw + 1, `${p} turned sideways has no sideways overflow`, `(${o.sw} > ${o.iw})`); }
    await page.setViewportSize(cfg.viewport);
  }

  const uniqErrors = [...new Set(errors)]; // read here: the offline step below makes its own network errors on purpose

  // 9. Slow network and offline
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  const t0 = Date.now();
  await page.goto(`${SITE}/#/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('a[href^="#/token/0x"]', { timeout: 90000 }).then(() => ok(size, true, `on a slow connection (400 kbit/s, 400 ms) the list appears after ${Math.round((Date.now() - t0) / 1000)} s`), () => ok(size, false, 'on a slow connection the list did not appear within 90 s'));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await go('/#/');
  await ctx.setOffline(true);
  await page.goto(`${SITE}/#/docs`).catch(() => {}); // same document: the app is already loaded, so this route still draws
  await page.waitForTimeout(800);
  const offlineText = await page.locator('body').innerText().catch(() => '');
  ok(size, /DOCS|Docs/i.test(offlineText), 'offline, a page already loaded still draws other pages of the app');
  const reloaded = await page.reload({ timeout: 8000 }).then(() => true, () => false);
  say('WARN', size, reloaded ? 'offline reload works (cached)' : 'offline, a fresh start shows the browser\'s offline page: the app has no offline mode (it needs the network for every figure)');
  await ctx.setOffline(false);

  // 10. Console errors across the whole run
  const uniq = uniqErrors;
  ok(size, uniq.length === 0, 'no console errors', `(${uniq.length}: ${uniq.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
