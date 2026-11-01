// Whether the page is open inside MINTA's Android app (a Trusted Web Activity). That app is Chrome showing this site full
// screen: it has no wallet extension and no wallet app can reach into it, so a wallet cannot connect the way it does in a
// wallet app's own browser. Where it is detected, the connect places point to the ways that work: WalletConnect (the wallet
// app opens, the person approves there, and every transaction is signed there) or the wallet app's own browser.
// Pure: no app imports, so node unit tests can call it.

export const TWA_PACKAGE = 'com.vyrechain.minta';
const KEY = 'minta.twa';
/** The address people open in their wallet app's browser, and the one Trust Wallet is sent to */
export const SITE_ADDRESS = 'minta.vyrechain.com';
export const SITE_URL = `https://${SITE_ADDRESS}`;
/** Trust Wallet's open-in-browser link, in the form Trust Wallet documents (coin_id 60 is its code for the Ethereum family of chains) */
export const TRUST_WALLET_LINK = `https://link.trustwallet.com/open_url?coin_id=60&url=${SITE_URL}`;
export const TWA_NOTE = `Connect with WalletConnect: your wallet app opens, you approve there, and every transaction is signed in it. Or open ${SITE_ADDRESS} in your wallet app’s browser.`;

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

/**
 * True when the app opened this page: Chrome sends `android-app://<package>` as the referrer of a Trusted Web Activity's first
 * page, and the app's start address also carries `?app=1`, so detection does not rest on the referrer alone. Once seen it is
 * remembered for the visit (sessionStorage), because the referrer is gone after the first page. Anywhere else both are absent,
 * and nothing changes.
 */
export function detectTwa(referrer: string, search: string, store: Store | null): boolean {
  let seen = false;
  try { seen = store?.getItem(KEY) === '1'; } catch { /* storage blocked */ }
  if (seen) return true;
  const now = new RegExp(`^android-app://${TWA_PACKAGE.replace(/\./g, '\\.')}(?:/|$)`).test(referrer) || new URLSearchParams(search).get('app') === '1';
  if (now) { try { store?.setItem(KEY, '1'); } catch { /* storage blocked */ } }
  return now;
}

/** The query string without `app=1` (so a link shared from inside the app doesn't carry it); '' or '?…' */
export function searchWithoutApp(search: string): string {
  const q = new URLSearchParams(search);
  if (q.get('app') !== '1') return search;
  q.delete('app');
  const rest = q.toString();
  return rest ? `?${rest}` : '';
}

export const IS_TWA: boolean = typeof window !== 'undefined' && (() => {
  let store: Store | null = null;
  try { store = window.sessionStorage; } catch { /* storage blocked */ }
  const is = detectTwa(document.referrer, window.location.search, store);
  // seen and remembered for the visit: the address no longer needs `?app=1`, and a link shared from here shouldn't carry it
  if (is && window.location.search !== searchWithoutApp(window.location.search)) {
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${searchWithoutApp(window.location.search)}${window.location.hash}`); } catch { /* the address stays as it is */ }
  }
  return is;
})();
