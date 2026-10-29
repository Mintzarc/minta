// Makes the store pictures from the REAL running site (default https://minta.vyrechain.com; MINTA_SITE=… to point elsewhere):
//   node store/android/make-screenshots.mjs            all sets, the icon and the feature graphic
//   node store/android/make-screenshots.mjs phone      one set (phone | tablet7 | tablet10 | desktop | assets)
// Needs the repo's packages (npm ci) and Playwright's Chromium (npx playwright install chromium) on your computer.
// Only unmodified screens and clips of them are used (see SCREENS in viewports.mjs): nothing is mocked and no style is injected.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SETS, SCREENS, SITE, DOCS_WIDE_LAYOUT, skipSplash, firstTokenHash } from './viewports.mjs';

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, '..', '..');
const only = process.argv[2];
const browser = await chromium.launch();

async function shots(key) {
  const set = SETS[key];
  const out = path.join(HERE, set.dir);
  fs.mkdirSync(out, { recursive: true });
  const ctx = await browser.newContext({ viewport: set.viewport, deviceScaleFactor: set.scale, isMobile: set.mobile, hasTouch: set.touch, locale: 'en-US' });
  const page = await ctx.newPage();
  await skipSplash(page);
  const tokenHash = await firstTokenHash(page);
  let n = 0;
  for (const s of SCREENS) {
    if (s.sets && !s.sets.includes(key)) continue;
    n += 1;
    const base = SITE;
    const file = path.join(out, `${String(n).padStart(2, '0')}-${s.name}.jpg`);
    await page.setViewportSize(set.viewport);
    await page.goto(`${base}${s.path ?? `/${tokenHash}`}`, { waitUntil: 'networkidle' });
    if (s.path === null) await page.reload({ waitUntil: 'networkidle' }); // a hash change alone does not reload the page
    await page.waitForTimeout(3500); // figures, the chart and pictures arrive after the page itself
    let clip;
    if (s.clip === 'below-bar') {
      // the app's top bar (the ticker, the menu, Connect Wallet) is not part of the picture: it starts at the page body, and the
      // window is made that much taller so the picture has the set's full size
      if (set.viewport.width >= 1000) {
        // wide screens: the article column only (the side menu and the promo card are left out), exactly 16:9 on a width that is a
        // multiple of 16, in a 1,280 px layout so the article fills the picture
        await page.setViewportSize({ width: DOCS_WIDE_LAYOUT, height: 900 });
        await page.waitForTimeout(1200);
        const col = await page.evaluate(() => { const r = document.querySelector('.docs-main').getBoundingClientRect(); return { x: r.left, width: r.width, top: document.querySelector('main').getBoundingClientRect().top }; });
        const width = Math.floor(col.width / 16) * 16, height = (width * 9) / 16;
        const top = Math.ceil(col.top);
        await page.setViewportSize({ width: DOCS_WIDE_LAYOUT, height: top + Math.ceil(height) + 40 });
        await page.waitForTimeout(800);
        await page.evaluate(() => window.scrollTo(0, 0));
        const content = await page.evaluate(() => document.querySelector('.docs-main').getBoundingClientRect().bottom);
        if (content - top < height) throw new Error(`${s.name} is shorter than the picture (${Math.round(content - top)} < ${height}): choose a longer article`);
        clip = { x: col.x + (col.width - width) / 2, y: top, width, height };
      } else {
        const top = Math.ceil(await page.evaluate(() => document.querySelector('main').getBoundingClientRect().top));
        await page.setViewportSize({ width: set.viewport.width, height: set.viewport.height + top });
        await page.waitForTimeout(800);
        await page.evaluate(() => window.scrollTo(0, 0));
        // a docs page shorter than the picture is cut where it ends (no empty lower half); never flatter than a square
        const end = await page.evaluate(() => document.querySelector('.docs-main').getBoundingClientRect().bottom);
        const height = Math.max(set.viewport.width, Math.min(set.viewport.height, Math.floor(end - top)));
        clip = { x: 0, y: top, width: set.viewport.width, height };
      }
    } else if (s.clip === 'report') {
      const btn = page.getByRole('button', { name: 'Report this token' });
      if (!(await btn.count())) throw new Error('No "Report this token" button here: take this picture from a build that has it (npm run build, npx vite preview, MINTA_SITE=http://127.0.0.1:4173)');
      await btn.click();
      await page.waitForTimeout(400);
      // from the Report link to the end of the Hide buttons: no picture, no price, no trade panel
      const box = await page.evaluate(() => {
        const r = document.querySelector('.report-token').getBoundingClientRect();
        const h = document.querySelector('.hide-row-page').getBoundingClientRect();
        return { x: 0, y: r.top + window.scrollY, bottom: h.bottom + window.scrollY + 8 };
      });
      clip = { x: 0, y: box.y, width: set.viewport.width, height: box.bottom - box.y };
      // Play wants the long side at most twice the short side
      clip.height = Math.min(clip.height, 2 * clip.width);
      clip.height = Math.min(clip.height, 2 * clip.width);
      if (clip.height < 0.5 * clip.width) throw new Error(`report clip ${clip.width}x${clip.height} is too flat`);
    } else if (s.scrollTo) {
      await page.evaluate((t) => {
        const h = [...document.querySelectorAll('h1,h2,h3')].find((e) => e.textContent.trim().includes(t));
        if (!h) throw new Error(`no heading "${t}"`);
        window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 70);
      }, s.scrollTo);
      await page.waitForTimeout(300);
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // JPEG has no alpha channel: Google Play wants JPEG or 24-bit PNG without alpha
    await page.screenshot({ path: file, type: 'jpeg', quality: 92, ...(clip ? { clip, fullPage: s.clip === 'report' } : {}) });
    const w = Math.round((clip ? clip.width : set.viewport.width) * set.scale), h = Math.round((clip ? clip.height : set.viewport.height) * set.scale);
    console.log(`${set.dir}/${path.basename(file)}  ${w}x${h}  ${s.note}`);
  }
  await ctx.close();
}

async function assets() {
  const out = HERE;
  const logo = fs.readFileSync(path.join(ROOT, 'public', 'icon-512.png')).toString('base64');
  const hero = fs.readFileSync(path.join(ROOT, 'public', 'art', 'hero.webp')).toString('base64');
  const word = fs.readFileSync(path.join(ROOT, 'public', 'brand', 'minta-wordmark.webp')).toString('base64');
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // the 512 x 512 icon: the app's own icon, as a 32-bit PNG (with an alpha channel, as Play asks). Chromium writes a PNG without an
  // alpha channel when every pixel is opaque, so one corner pixel is left clear (it cannot be seen: Play masks the icon anyway)
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(`<body style="margin:0;background:transparent"><img src="data:image/png;base64,${logo}" width="512" height="512" style="display:block;clip-path:polygon(0 1px,1px 1px,1px 0,100% 0,100% 100%,0 100%)"></body>`);
  await page.screenshot({ path: path.join(out, 'icon-512.png'), omitBackground: true, type: 'png' });
  // the 1024 x 500 feature graphic: MINTA's own art, the name and a line that says what the app does; no interface, no prices, no claims
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.setContent(`<style>
    body{margin:0;width:1024px;height:500px;position:relative;overflow:hidden;background:#03070b url(data:image/webp;base64,${hero}) center/cover;font-family:system-ui,sans-serif;color:#e9f5f4}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,7,11,.92) 0%,rgba(3,7,11,.75) 42%,rgba(3,7,11,0) 75%)}
    .t{position:absolute;left:56px;top:150px}
    .t img{width:400px;display:block}
    .t p{margin:26px 0 0;width:430px;font-size:32px;line-height:1.25;font-weight:600;letter-spacing:.2px}
    .t small{display:block;margin-top:12px;font-size:21px;opacity:.8}
  </style><div class="shade"></div><div class="t"><img src="data:image/webp;base64,${word}" alt="MINTA"><p>Browse and report tokens on VYRE</p><small>Real USDC. Tokens can fall to zero.</small></div>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'feature-graphic.jpg'), type: 'jpeg', quality: 93 });
  console.log('icon-512.png  512x512 (32-bit PNG)\nfeature-graphic.jpg  1024x500 (JPEG, no alpha)');
  await ctx.close();
}

if (!only || only === 'assets') await assets();
for (const k of Object.keys(SETS)) if (!only || only === k) await shots(k);
await browser.close();
