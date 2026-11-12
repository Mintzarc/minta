// The content policy of a MAINNET page.
//
// vercel.json sends one wide policy header for the test network's build, which needs it (other chains' RPCs for transfers, the
// faucet, Circle's email sign-in frame, launch files on any site). Mainnet is held to a narrow one, in two ways:
//  - on the mainnet site's own host (MAINNET_HOST) vercel.json sends the narrow policy as the HEADER, in place of the wide one,
//    so every document on that origin is held to it: the app, and also the terms, the privacy page, a 404;
//  - every mainnet build also carries the narrow lists in its index.html as a <meta> tag (vite.config.ts), so a mainnet build
//    served from any other host (a preview address) is held to them too. A browser applies a header and a meta policy together.
// The lists are the only hosts a mainnet page may fetch from or open a socket to, draw pictures from, or frame. What they do not
// cover: a page can still be navigated elsewhere (a link, window.open, location), and the listed hosts themselves take requests.
// Under the meta tag alone (not on MAINNET_HOST) another document of the same origin that has no tag, such as /terms/, is held
// only to the wide header. It narrows where a script that ended up in the bundle could send things; it does not close every way out.

/** The host the mainnet site is served on: vercel.json sends the narrow policy as a header there */
export const MAINNET_HOST = 'minta.vyrechain.com';
/** The app API a mainnet build talks to unless it is built with VITE_API_URL */
export const DEFAULT_API = 'https://api.vyrechain.com';

/** The origin of the app API a build was configured with (VITE_API_URL), or the default; anything but an https address stops the build */
export function apiOrigin(configured) {
  if (configured === undefined || configured === null || configured === '') return DEFAULT_API;
  let u;
  try { u = new URL(String(configured)); } catch { throw new Error(`VITE_API_URL is not an address: ${JSON.stringify(configured)}`); }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) throw new Error(`VITE_API_URL must be an https address (a mainnet build's content policy names its host): ${JSON.stringify(configured)}`);
  return u.origin;
}

const connect = (api) => [
  "'self'",
  'https://rpc.vyrechain.com', // the chain
  api, // pictures, launch files, the check before signing, card top-up links
  'https://explorer.vyrechain.com', // block times for the 24-hour figures
  'https://rpc.mainnet.arc.io', // the Wallet page's reads of Arc
  'wss://relay.walletconnect.org', // WalletConnect's relay
  'https://verify.walletconnect.org', // WalletConnect's verification service (the same host as its frame)
];
const img = (api) => ["'self'", 'data:', api];
export const MAINNET_CONNECT = connect(DEFAULT_API);
export const MAINNET_IMG = img(DEFAULT_API);
export const MAINNET_FRAME = ['https://verify.walletconnect.org'];

/** The policy string of the meta tag; `api`: the app API's origin (apiOrigin of the build's setting) */
export const mainnetPolicy = (api = DEFAULT_API) => `connect-src ${connect(api).join(' ')}; img-src ${img(api).join(' ')}; frame-src ${MAINNET_FRAME.join(' ')}`;

/** The whole policy sent as a header on MAINNET_HOST: the wide header's own directives with the three lists narrowed */
export const mainnetHeader = () => `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src ${MAINNET_IMG.join(' ')}; media-src 'self'; connect-src ${MAINNET_CONNECT.join(' ')}; frame-src ${MAINNET_FRAME.join(' ')}; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`;

/** The tag, as written right after <head> */
export const mainnetPolicyTag = (api = DEFAULT_API) => `<meta http-equiv="Content-Security-Policy" content="${mainnetPolicy(api)}">`;

/** `html` with the tag as the first thing in its head (so it holds for everything after it) */
export function withMainnetPolicy(html, api = DEFAULT_API) {
  if (!/<head>/.test(html)) throw new Error('index.html has no <head> to put the content policy in');
  return html.replace('<head>', `<head>\n    ${mainnetPolicyTag(api)}`);
}
