// The wait after "Move to VYRE" on the Wallet page (src/pages/Wallet.tsx): a deposit sent on Arc, on its way to VYRE, and what
// the transaction button checks once it holds one (src/components/ui.tsx). (No relative imports here: test/deposit.test.mjs runs
// this file with Node as it is.)
import { SentButUnconfirmedError, waitForDeposit } from '@vyrechain/sdk';
import { getAddress, type Address, type Hash, type PublicClient } from 'viem';

/** What the transaction button says while it holds a deposit that hasn't shown up on VYRE yet */
const NOT_ON_VYRE_YET = 'The deposit was sent from Arc, but it hasn’t shown up on VYRE yet. Check it before sending more: checking doesn’t send anything.';

/**
 * What a held deposit is checked against: the account it is credited to on VYRE, and that account's VYRE balance before it was
 * sent (in wei, as a decimal string, so the transaction button can keep it for the tab as JSON). It arrived once the balance
 * there is above that.
 */
export interface DepositWait {
  account: Address;
  before: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A balance in wei: digits only, no sign, no leading zero, at most 2^256 - 1 (checked below) */
const WEI = /^(0|[1-9][0-9]{0,77})$/;
const MAX_WEI = 2n ** 256n - 1n;

/** `v` as a held deposit's record (from an error, or read back from the tab's storage) if it is exactly one; anything else is null */
export function depositWaitOf(v: unknown): DepositWait | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { account, before } = v as Record<string, unknown>;
  if (typeof account !== 'string' || !ADDRESS.test(account) || /^0x0{40}$/.test(account)) return null;
  if (typeof before !== 'string' || !WEI.test(before) || BigInt(before) > MAX_WEI) return null;
  return { account: getAddress(account), before };
}

/** Marks a deposit's SentButUnconfirmedError with what a check needs (the account and its VYRE balance before), and returns it */
export function heldDeposit<E extends SentButUnconfirmedError>(e: E, account: Address, before: bigint): E & { deposit: DepositWait } {
  return Object.assign(e, { deposit: { account, before: before.toString() } });
}

/**
 * Whether a held deposit has shown up on VYRE: the account's balance there is above what it was before the deposit was sent.
 * A read that fails throws (no answer: the button keeps it held).
 */
export async function depositArrived(vyre: PublicClient, d: DepositWait): Promise<boolean> {
  return (await vyre.getBalance({ address: d.account })) > BigInt(d.before);
}

/**
 * Waits for a deposit already mined on Arc to reach VYRE (seconds, usually) and resolves with how long it took, in seconds.
 * A balance read on VYRE that fails doesn't end the wait: it reads again until `timeoutMs` is up. If the USDC hasn't shown
 * up by then, the deposit is still on its way, not lost: with its Arc transaction, a SentButUnconfirmedError for it (its
 * `note` says so in the app's words, its `deposit` is what a check needs), which the transaction button holds as Check it,
 * kept under the button's name: one more press reads Arc and then the balance on VYRE, and says it arrived only once that
 * balance has risen, so it can't send a second deposit; with none to follow, a plain error saying to check the balance before
 * sending more.
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
  throw Object.assign(heldDeposit(new SentButUnconfirmedError(arcTx, arcChainId, last), account, before), { note: NOT_ON_VYRE_YET });
}
