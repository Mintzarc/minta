// Optional features, and whether this build offers them. Build settings (VITE_…) are public: they end up in the page.

/**
 * Whether the Wallet page offers the card checkout. `VITE_CARD_TOPUP=1` at build time turns it on and `0` turns it off;
 * unset (or anything else), it is on only on a test network, where the checkout runs in the provider's test mode. On any
 * other network it stays off until a live checkout has been set up and tested for this site.
 */
export function cardTopupOffered(setting: unknown, testnet: boolean): boolean {
  if (setting === '1') return true;
  if (setting === '0') return false;
  return testnet;
}
