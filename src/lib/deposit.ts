// The wait after "Move to VYRE" on the Wallet page (src/pages/Wallet.tsx): a deposit sent on Arc, on its way to VYRE, and what
// the transaction button checks once it holds one (src/components/ui.tsx). (No relative imports here: test/deposit.test.mjs runs
// this file with Node as it is.)
import { SentButUnconfirmedError } from '@vyrechain/sdk';
import { getAddress, type Address, type Hash, type PublicClient } from 'viem';

/** What the transaction button says while it holds a deposit that hasn't shown up on VYRE yet */
const NOT_ON_VYRE_YET = 'The deposit was sent from Arc, but it hasn’t shown up on VYRE yet. Check it before sending more: checking doesn’t send anything.';

/**
 * What a held deposit is checked against: the account it is credited to on VYRE, that account's VYRE balance before it was sent,
 * and the amount sent (both in wei, as decimal strings, so the transaction button can keep it for the tab as JSON). A deposit from
 * Arc is credited one for one on VYRE (its value, 18 decimals on both sides), so it arrived once the balance there is at least
 * `before` plus `amount`: a smaller rise (a faucet drip, someone else's transfer) is not it.
 */
export interface DepositWait {
  account: Address;
  before: string;
  amount: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A balance in wei: digits only, no sign, no leading zero, at most 2^256 - 1 (checked below) */
const WEI = /^(0|[1-9][0-9]{0,77})$/;
const MAX_WEI = 2n ** 256n - 1n;

const wei = (v: unknown): v is string => typeof v === 'string' && WEI.test(v) && BigInt(v) <= MAX_WEI;

/** `v` as a held deposit's record (from an error, or read back from the tab's storage) if it is exactly one; anything else is null */
export function depositWaitOf(v: unknown): DepositWait | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const { account, before, amount } = v as Record<string, unknown>;
  if (typeof account !== 'string' || !ADDRESS.test(account) || /^0x0{40}$/.test(account)) return null;
  if (!wei(before) || !wei(amount) || amount === '0') return null;
  return { account: getAddress(account), before, amount };
}

/** Marks a deposit's SentButUnconfirmedError with what a check needs (the account, its VYRE balance before, the amount), and returns it */
export function heldDeposit<E extends SentButUnconfirmedError>(e: E, account: Address, before: bigint, amount: bigint): E & { deposit: DepositWait } {
  return Object.assign(e, { deposit: { account, before: before.toString(), amount: amount.toString() } });
}

/**
 * Whether a held deposit has shown up on VYRE: the account's balance there is at least what it was before the deposit was sent
 * plus the amount. A read that fails throws (no answer: the button keeps it held).
 */
export async function depositArrived(vyre: PublicClient, d: DepositWait): Promise<boolean> {
  return (await vyre.getBalance({ address: d.account })) >= BigInt(d.before) + BigInt(d.amount);
}

/**
 * Waits for a deposit of `amount` already mined on Arc to reach VYRE (seconds, usually): until the account's balance there is at
 * least `before` plus `amount`, as `depositArrived` judges it. Resolves with how long it took, in seconds. A balance read on VYRE
 * that fails doesn't end the wait: it reads again until `timeoutMs` is up. If the USDC hasn't shown up by then, the deposit is
 * still on its way, not lost: with its Arc transaction, a SentButUnconfirmedError for it (its `note` says so in the app's words,
 * its `deposit` is what a check needs), which the transaction button holds as Check it, kept under the button's name: one more
 * press reads Arc and then the balance on VYRE, and says it arrived only once that balance shows the whole amount, so it can't
 * send a second deposit; with none to follow, a plain error saying to check the balance before sending more.
 */
export async function arrival(
  vyre: PublicClient, arcChainId: number, account: Address, before: bigint, amount: bigint, arcTx: Hash | null,
  { timeoutMs = 300_000, pollMs = 500, retryMs = 1_000 }: { timeoutMs?: number; pollMs?: number; retryMs?: number } = {},
): Promise<number> {
  const t0 = Date.now();
  const end = t0 + timeoutMs;
  const target = before + amount;
  let last: unknown = new Error(`no deposit of ${amount} wei reached ${account} on VYRE within ${Math.round(timeoutMs / 1000)} s`);
  for (;;) {
    let wait = pollMs;
    try {
      if ((await vyre.getBalance({ address: account })) >= target) return (Date.now() - t0) / 1000;
    } catch (e) {
      // a read that failed (the network busy, say): read again a little later
      last = e;
      wait = retryMs;
    }
    if (Date.now() >= end) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, Math.max(0, end - Date.now()))));
  }
  if (!arcTx) throw new Error('Sent on Arc, but it hasn’t shown up on VYRE yet. Check your balance here again in a minute before sending more.');
  throw Object.assign(heldDeposit(new SentButUnconfirmedError(arcTx, arcChainId, last), account, before, amount), { note: NOT_ON_VYRE_YET });
}
