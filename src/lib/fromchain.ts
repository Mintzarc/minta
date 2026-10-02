// What the "From another chain" form (src/pages/Wallet.tsx) throws when something goes wrong after its burn was sent.
import { SentButUnconfirmedError } from '@vyrechain/sdk';
import type { Hash } from 'viem';

/** The SDK's error for a transaction whose receipt was read and says it failed */
const REVERTED = /^transaction 0x[0-9a-fA-F]{64} reverted$/;

/**
 * Once the burn was sent (its hash known, and followed below the form), only a receipt that says it failed means nothing was
 * burned: then a plain error, linked, and the button can send again. Anything else (its receipt couldn't be read, or
 * something unexpected) means it may well be on its way: a SentButUnconfirmedError for the hash the form follows (the
 * newest, if it was sped up in the wallet), which the button holds as Check it, so a second press only reads the chain and
 * can't burn the same USDC again.
 */
export function burnSentError(e: unknown, hash: Hash, from: { id: number; name: string }): Error {
  const m = e instanceof Error ? e.message : '';
  if (!(e instanceof SentButUnconfirmedError) && REVERTED.test(m)) {
    return Object.assign(new Error(`The transfer failed on ${from.name}: nothing was burned (only its gas was spent).`), { hash, chainId: from.id });
  }
  return new SentButUnconfirmedError(hash, from.id, e);
}
