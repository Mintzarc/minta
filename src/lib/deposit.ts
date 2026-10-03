// The wait after "Move to VYRE" on the Wallet page (src/pages/Wallet.tsx): a deposit sent on Arc, on its way to VYRE.
import { SentButUnconfirmedError, waitForDeposit } from '@vyrechain/sdk';
import type { Address, Hash, PublicClient } from 'viem';

/** What the transaction button says while it holds a deposit that hasn't shown up on VYRE yet */
const NOT_ON_VYRE_YET = 'The deposit was sent from Arc, but it hasn’t shown up on VYRE yet. Check it before sending more: checking doesn’t send anything.';

/**
 * Waits for a deposit already mined on Arc to reach VYRE (seconds, usually) and resolves with how long it took, in seconds.
 * A balance read on VYRE that fails doesn't end the wait: it reads again until `timeoutMs` is up. If the USDC hasn't shown
 * up by then, the deposit is still on its way, not lost: with its Arc transaction, a SentButUnconfirmedError for it (its
 * `note` says so in the app's words), which the transaction button holds as Check it, kept under the button's name, so one
 * more press only reads Arc and can't send a second deposit; with none to follow, a plain error saying to check the balance
 * before sending more.
 */
export async function arrival(
  vyre: PublicClient, arcChainId: number, account: Address, before: bigint, arcTx: Hash | null,
  { timeoutMs = 300_000, pollMs = 500, retryMs = 1_000 }: { timeoutMs?: number; pollMs?: number; retryMs?: number } = {},
): Promise<number> {
  const t0 = Date.now();
  const end = t0 + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      await waitForDeposit(vyre, { address: account, before, pollMs, timeoutMs: Math.max(0, end - Date.now()) });
      return (Date.now() - t0) / 1000;
    } catch (e) {
      // a read that failed (the network busy, say), or the time is up
      last = e;
      if (Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  if (!arcTx) throw new Error('Sent on Arc, but it hasn’t shown up on VYRE yet. Check your balance here again in a minute before sending more.');
  throw Object.assign(new SentButUnconfirmedError(arcTx, arcChainId, last), { note: NOT_ON_VYRE_YET });
}
