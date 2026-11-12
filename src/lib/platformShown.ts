// Which platform wallet a page shows for what the chain answered (lib/platform.ts reads it). Imports nothing, so the tests load it as it is.

export type PlatformWalletRead = 'reading' | 'failed' | `0x${string}`;

/** Shown beside the address when the chain could not be read */
export const PLATFORM_WALLET_UNREAD = 'as written in the app: the launchpad contract couldn’t be read just now';

/**
 * The address to show and a note for it: the chain's answer when there is one (whatever the app has written down); the app's own
 * record while the read is on its way (no note) or when it failed or answered something that is not an address (with the note).
 */
export function platformWalletShown<A extends `0x${string}`>(got: PlatformWalletRead, recorded: A): { address: A; note: string } {
  if (got === 'reading') return { address: recorded, note: '' };
  if (got === 'failed' || !/^0x[0-9a-fA-F]{40}$/.test(got) || /^0x0{40}$/.test(got)) return { address: recorded, note: PLATFORM_WALLET_UNREAD };
  return { address: got as A, note: '' };
}
