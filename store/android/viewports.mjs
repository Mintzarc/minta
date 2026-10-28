// The screen sizes used for the store pictures and the end-to-end checks. Sizes are CSS pixels; the picture is size x scale.
// Google Play (read 2026-10-28, "Add preview assets"): phone pictures 320-3840 px a side with the long side at most twice the
// short side (9:16 qualifies the app for featuring at 1080 x 1920 or more); large screens (7-inch and 10-inch tablets,
// Chromebooks): 1,080-7,680 px, 16:9 or 9:16, at least 4 pictures; JPEG or 24-bit PNG without alpha; up to 8 per device type.
export const SITE = process.env.MINTA_SITE || 'https://minta.vyrechain.com';
export const SETS = {
  phone:      { dir: 'phone',      viewport: { width: 360,  height: 640 },  scale: 3, mobile: true,  touch: true },  // 1080 x 1920
  tablet7:    { dir: 'tablet-7in', viewport: { width: 600,  height: 1067 }, scale: 2, mobile: true,  touch: true },  // 1200 x 2134 (9:16)
  tablet10:   { dir: 'tablet-10in', viewport: { width: 1280, height: 720 }, scale: 2, mobile: true,  touch: true },  // 2560 x 1440 (16:9)
  desktop:    { dir: 'desktop',    viewport: { width: 1920, height: 1080 }, scale: 1, mobile: false, touch: false }, // 1920 x 1080 (Chromebook / large screen)
};
/** The same real screens in every set, in the order they are shown */
export const SCREENS = [
  { name: 'explore', path: '/#/', note: 'Explore: the launches list' },
  { name: 'token', path: null, note: "A token's page (the first one on the list)" },
  { name: 'launch', path: '/#/launch', note: 'The launch wizard, step 1' },
  { name: 'wallet', path: '/#/wallet', note: 'Wallet (signed out)' },
  { name: 'docs', path: '/#/docs', note: 'MINTA docs' },
  { name: 'agents', path: '/agents/', note: 'Use MINTA with an AI assistant' },
  { name: 'terms', path: '/terms/', note: 'Terms' },
];
/** The opening film is remembered by the app: tell it it played just now, so the first screen is the app itself */
export const skipSplash = (page) => page.addInitScript(() => {
  try { for (const id of [3045, 7357]) window.localStorage.setItem(`minta.splash:${id}`, String(Date.now())); } catch { /* storage blocked */ }
});
/** The address of the first token on the Explore list, read from the live page (the page is the source, nothing is made up) */
export async function firstTokenHash(page) {
  await page.goto(`${SITE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a[href^="#/token/0x"]', { timeout: 30000 });
  return page.$eval('a[href^="#/token/0x"]', (a) => a.getAttribute('href'));
}
