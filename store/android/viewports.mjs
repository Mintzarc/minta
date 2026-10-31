// The screen sizes used for the store pictures and the end-to-end checks. Sizes are CSS pixels; the picture is size x scale.
// Google Play (read in October 2026, "Add preview assets"): phone pictures 320-3840 px a side with the long side at most twice the
// short side (9:16 qualifies the app for featuring at 1080 x 1920 or more); large screens (7-inch and 10-inch tablets,
// Chromebooks): 1,080-7,680 px, 16:9 or 9:16, at least 4 pictures; JPEG or 24-bit PNG without alpha; up to 8 per device type.
export const SITE = process.env.MINTA_SITE || 'https://minta.vyrechain.com';
export const SETS = {
  phone:      { dir: 'phone',      viewport: { width: 360,  height: 640 },  scale: 3, mobile: true,  touch: true },  // 1080 x 1920
  tablet7:    { dir: 'tablet-7in', viewport: { width: 600,  height: 1067 }, scale: 2, mobile: true,  touch: true },  // 1200 x 2134 (9:16)
  tablet10:   { dir: 'tablet-10in', viewport: { width: 1280, height: 720 }, scale: 2, mobile: true,  touch: true },  // 2560 x 1440 (16:9)
  desktop:    { dir: 'desktop',    viewport: { width: 1920, height: 1080 }, scale: 2, mobile: false, touch: false }, // 3840 x 2160 whole screen, docs clipped to their column (2696 x 1516)
};
/** The same real screens in every set, in the order they are shown. Only unmodified screens, or clips of them, that work in the
 *  Android app (a wallet connects there only through WalletConnect, which a store picture cannot show): no page with the app's navigation, the Connect Wallet button, the network switcher, the
 *  hero ("Build. Launch. Grow."), the launch wizard, the wallet page or a trade panel, and no token picture (the one token on the
 *  chain has cartoon art). The app's pages are clipped below its top bar (`clip: 'below-bar'`); on wide screens a docs page is clipped
 *  to its article column (no side menu, no promo card), at 16:9; the static pages (AI assistants,
 *  terms) are shown as they are; one text page per set (the Terms), not two. Each picture fills with real content: a docs page shorter than the
 *  picture is cut at its end (narrow screens) or an article that fills it is chosen (wide screens). Nothing is hidden by injected styles.
 *  `sets` lists where a screen is used (default: every set). */
export const SCREENS = [
  { name: 'docs-fees', path: '/#/docs/fees', clip: 'below-bar', sets: ['tablet10', 'desktop'], note: 'Docs: fees and revenue' },
  { name: 'docs-tokenomics', path: '/#/docs/tokenomics', clip: 'below-bar', sets: ['phone', 'tablet10', 'desktop'], note: 'Docs: supply and tax' },
  { name: 'docs-tokenomics-narrow', path: '/#/docs/tokenomics', clip: 'below-bar', layoutWidth: 480, sets: ['tablet7'], note: 'Docs: supply and tax, in a 480 px wide layout (a 7-inch tablet in a narrow window) so the article fills a 9:16 picture' },
  { name: 'docs-contracts', path: '/#/docs/contracts', clip: 'below-bar', sets: ['tablet7', 'tablet10', 'desktop'], note: 'Docs: contracts and review status' },
  { name: 'report', path: null, clip: 'report', sets: ['phone'], note: 'A token page cropped to the Report this token panel and the Hide buttons (no picture, no price)' },
  { name: 'agents', path: '/agents/', scrollTo: 'Safety rules', sets: ['phone', 'tablet7'], note: 'Use MINTA with an AI assistant: the safety rules' },
  { name: 'terms', path: '/terms/', scrollTo: 'Terms of', note: 'Terms' },
];
/** Wide screens show a docs page in this layout width (the article column is then 992 px: 16:9 is 992 x 558, every article fills it) */
export const DOCS_WIDE_LAYOUT = 1280;
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
