// Optional features, and whether this build offers them. Build settings (VITE_…) are public: they end up in the page.

/**
 * Flip to true only after a live (non-test) card checkout has been set up and tested for this site's domain.
 * Until then, non-testnet builds never show the card UI, even with `VITE_CARD_TOPUP=1`.
 */
export const LIVE_CARD_TOPUP_READY = false;

/**
 * Whether the Wallet page offers the card checkout.
 * - Test network: on by default (provider test mode); `VITE_CARD_TOPUP=0` turns it off, `1` leaves it on.
 * - Any other network: off unless both `LIVE_CARD_TOPUP_READY` and `VITE_CARD_TOPUP=1`.
 */
export function cardTopupOffered(setting: unknown, testnet: boolean): boolean {
  if (setting === '0') return false;
  if (testnet) return true;
  return LIVE_CARD_TOPUP_READY && setting === '1';
}
