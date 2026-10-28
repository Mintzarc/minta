// Makes the store pictures from the REAL running site (default https://minta.vyrechain.com; MINTA_SITE=… to point elsewhere):
//   node store/android/make-screenshots.mjs            all sets, the icon and the feature graphic
//   node store/android/make-screenshots.mjs phone      one set (phone | tablet7 | tablet10 | desktop | assets)
// Needs the repo's packages (npm ci) and Playwright's Chromium (npx playwright install chromium) on your computer.
// Screens that need a signed-in wallet are shown signed out: that is what a new visitor sees. Nothing is mocked.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SETS, SCREENS, SITE, skipSplash, firstTokenHash } from './viewports.mjs';

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
    n += 1;
    await page.goto(`${SITE}${s.path ?? `/${tokenHash}`}`, { waitUntil: 'networkidle' });
    if (s.name === 'token') await page.reload({ waitUntil: 'networkidle' }); // a hash change alone does not reload the page
    await page.waitForTimeout(3500); // prices, the chart and pictures arrive after the page itself
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = path.join(out, `${String(n).padStart(2, '0')}-${s.name}.jpg`);
    // JPEG has no alpha channel: Google Play wants JPEG or 24-bit PNG without alpha
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log(`${set.dir}/${path.basename(file)}  ${set.viewport.width * set.scale}x${set.viewport.height * set.scale}  ${s.note}`);
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
  // the 1024 x 500 feature graphic: MINTA's own art, the name and the tagline; no interface, no prices, no claims
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.setContent(`<style>
    body{margin:0;width:1024px;height:500px;position:relative;overflow:hidden;background:#03070b url(data:image/webp;base64,${hero}) center/cover;font-family:system-ui,sans-serif;color:#e9f5f4}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,7,11,.92) 0%,rgba(3,7,11,.75) 42%,rgba(3,7,11,0) 75%)}
    .t{position:absolute;left:56px;top:150px}
    .t img{width:400px;display:block}
    .t p{margin:26px 0 0;width:430px;font-size:32px;line-height:1.25;font-weight:600;letter-spacing:.2px}
    .t small{display:block;margin-top:12px;font-size:21px;opacity:.8}
  </style><div class="shade"></div><div class="t"><img src="data:image/webp;base64,${word}" alt="MINTA"><p>Launch and explore tokens on VYRE</p><small>Real USDC. Tokens can fall to zero.</small></div>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'feature-graphic.jpg'), type: 'jpeg', quality: 93 });
  console.log('icon-512.png  512x512 (32-bit PNG)\nfeature-graphic.jpg  1024x500 (JPEG, no alpha)');
  await ctx.close();
}

if (!only || only === 'assets') await assets();
for (const k of Object.keys(SETS)) if (!only || only === k) await shots(k);
await browser.close();
