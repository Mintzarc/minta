// An advisory check before a wallet is asked to sign a transaction on VYRE. The check service (api.vyrechain.com, through
// the SDK's `checkTransaction`) runs the transaction without sending it and looks up the addresses in it with a security
// service. MINTA wraps the browser wallet's `eth_sendTransaction` (and `wallet_sendTransaction`, which viem falls back to),
// so every send on VYRE (launch, buy, sell, approve, the Wallet page's sends) goes through here without each page doing anything.
//
// The rules, which the tests (test/txcheck.test.mjs) hold in place:
//  - ADVISORY AND FAIL-OPEN. It waits at most CHECK_BUDGET_MS. Any error, a timeout, HTTP 429 or 500, a body that isn't
//    the expected answer, an answer with nothing in it: the transaction goes on, silently. (An answer where the simulation
//    didn't happen still shows a flagged address, which doesn't depend on it, and nothing else.) A problem with
//    the service is never shown to anyone as a warning.
//  - Only when the answer carries a flag (or says the transaction would fail) does a dialog open, BEFORE the wallet's own
//    prompt, with Continue anyway and Cancel. No flag: nothing is shown, and nothing is said about the transaction at all.
//  - What the dialog says is MINTA's own wording for each kind of flag. The service's own sentences are never shown, and
//    the only thing taken from its answer into the text is an address that passed an address check, so a hostile answer
//    can't put words or markup in front of someone.
//  - Only VYRE's chain is ever checked; a wallet client for another chain is passed through untouched.
//  - The check sits between viem's look at the wallet's network and the send (viem's request names no chain, so the wallet
//    signs for whatever network it is on when the send reaches it). So once the check has waited for anything, the wallet's
//    network is asked again right before the send, and if it isn't VYRE's any more nothing is sent.
//
// No imports from the app (only viem and the SDK) so that node can run this file in the unit tests.
import { BaseError, isAddress, type Address, type EIP1193Provider } from 'viem';
import { checkTransaction, vyreTestnet, type TxCheck } from '@vyrechain/sdk';

/** The most the check may add before the wallet's own prompt, in milliseconds (everything counted: connecting, the answer, reading it) */
export const CHECK_BUDGET_MS = 800;

/** The most call data sent for a check, in bytes (what the service takes: more is sent on without a check) */
const MAX_DATA_BYTES = 24 * 1024;

/** What a check can tell someone before they sign */
export type ConcernCode = 'reverts' | 'unlimited_approval' | 'approval_to_unknown_spender' | 'flagged_address';
export type ConcernRole = 'to' | 'spender' | 'counterparty';
export interface Concern {
  code: ConcernCode;
  /** The contract that would get an allowance, or the address that was flagged: only ever a well-formed address */
  address?: Address;
  /** For a flagged address: how it figures in the transaction */
  role?: ConcernRole;
}

const CODES: ReadonlySet<string> = new Set<ConcernCode>(['reverts', 'unlimited_approval', 'approval_to_unknown_spender', 'flagged_address']);
/** How many flags of an answer are read, and how many different concerns are kept (a hostile answer can't make the dialog long) */
const READ_AT_MOST = 50;
const KEEP_AT_MOST = 6;

const ROLE_ORDER: readonly ConcernRole[] = ['to', 'spender', 'counterparty'];
/** How a flagged address figures in the call, from the service's `roles` (an address can have several: the destination counts first) */
const roleOf = (v: unknown): ConcernRole | undefined => {
  if (!Array.isArray(v)) return undefined;
  const have = v.slice(0, 10).filter((r): r is string => typeof r === 'string');
  return ROLE_ORDER.find((r) => have.includes(r));
};
const addressOf = (v: unknown): Address | undefined => (typeof v === 'string' && isAddress(v, { strict: false }) ? (v as Address) : undefined);

/**
 * What to tell someone about a check's answer: a list of concerns, empty when there is nothing to say. Empty for every kind of
 * "no answer" (the SDK's `{ available: false }`, an answer whose simulation didn't happen, anything malformed).
 */
export function concernsOf(answer: TxCheck | unknown): Concern[] {
  try {
    const a = answer as Partial<Record<string, unknown>> | null;
    if (!a || typeof a !== 'object' || a.available !== true || a.advisory !== true || typeof a.simulated !== 'boolean') return [];
    // The address lookup doesn't depend on the simulation: when the simulation didn't happen, a flagged address is still worth
    // saying, and nothing else is (the service sends nothing else then; a hostile answer that does is read the same way)
    const simulated = a.simulated;
    const out: Concern[] = [];
    const seen = new Set<string>();
    const add = (c: Concern) => {
      const key = `${c.code}|${c.address?.toLowerCase() ?? ''}|${c.role ?? ''}`;
      if (!seen.has(key) && out.length < KEEP_AT_MOST) { seen.add(key); out.push(c); }
    };
    if (simulated && a.reverts === true) add({ code: 'reverts' });
    const flags = Array.isArray(a.flags) ? a.flags.slice(0, READ_AT_MOST) : [];
    for (const f of flags as unknown[]) {
      if (!f || typeof f !== 'object') continue;
      const { code, spender, address, roles } = f as Record<string, unknown>;
      if (typeof code !== 'string' || !CODES.has(code)) continue;
      if (code !== 'flagged_address' && !simulated) continue;
      if (code === 'reverts') add({ code });
      else if (code === 'flagged_address') add({ code, address: addressOf(address), role: roleOf(roles) });
      else add({ code: code as ConcernCode, address: addressOf(spender) });
    }
    return out;
  } catch {
    return [];
  }
}

/** The words for one concern: MINTA's own, in plain language (the address, when there is one, is shown beside it) */
export function describe(c: Concern): { text: string; address?: Address; where?: string } {
  switch (c.code) {
    case 'reverts':
      return { text: 'This transaction would most likely fail if it were sent now. You would still pay the network fee.' };
    case 'unlimited_approval':
      return { text: 'It would let a contract spend an unlimited amount of a token from your wallet.', address: c.address, where: 'the contract that would get this permission' };
    case 'approval_to_unknown_spender':
      return { text: 'It would let a contract that isn’t one of the launchpad’s own contracts spend a token from your wallet.', address: c.address, where: 'the contract that would get this permission' };
    case 'flagged_address':
      return {
        text: 'A security service has flagged an address involved in this transaction. That is information, not a verdict: look the address up before you go on.',
        address: c.address,
        where: c.role === 'to' ? 'the contract this transaction calls' : c.role === 'spender' ? 'the address that would get permission to spend a token' : c.role === 'counterparty' ? 'an address that tokens would move to or from' : undefined,
      };
  }
}

/** Thrown to the page's own code when someone chose Cancel: nothing was sent. It carries the wallet's "user rejected" code, so the SDK and viem treat it as a refusal, not a failure. */
export class CheckCancelled extends Error {
  code = 4001;
  constructor() {
    super('Cancelled. Nothing was sent.');
    this.name = 'CheckCancelled';
  }
}

/**
 * Thrown to the page's own code when the wallet was on another network than VYRE's by the time the check had finished: nothing
 * was sent. (A viem error, so viem passes it on as it is and the page shows its words.)
 */
export class WalletMovedNetwork extends BaseError {
  constructor() {
    super('Your wallet moved to another network before this was sent, so nothing was sent. Switch it back to VYRE, then try again.', { name: 'WalletMovedNetwork' });
  }
}

/** Whether an error, or anything it was caused by, is a Cancel from the check's dialog (viem wraps a wallet's refusal around it) */
export function wasCancelledByCheck(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { name?: unknown }).name === 'CheckCancelled') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// The dialog's request: one at a time, shown by <TxCheckDialog /> (components/TxCheckDialog.tsx)
// ---------------------------------------------------------------------------------------------------------------
export interface CheckRequest {
  concerns: Concern[];
  proceed: () => void;
  cancel: () => void;
}
let pending: CheckRequest | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const subscribeRequests = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The question waiting to be answered, if any */
export const currentRequest = (): CheckRequest | null => pending;
let tail: Promise<unknown> = Promise.resolve();
let waiting = 0; // questions on screen or waiting their turn
/**
 * Opens the dialog; true when someone chose Continue anyway, false for Cancel. One question at a time: a second one (two sends in quick
 * succession) waits until the first is answered, so nobody's Cancel is made for them.
 */
export function askToContinue(concerns: Concern[]): Promise<boolean> {
  const show = () => new Promise<boolean>((resolve) => {
    const me: CheckRequest = {
      concerns,
      proceed: () => finish(true),
      cancel: () => finish(false),
    };
    const finish = (go: boolean) => {
      if (pending === me) { pending = null; emit(); }
      resolve(go);
    };
    pending = me;
    emit();
  });
  // (with nothing on screen or waiting, the question opens at once; otherwise it opens when the one before it has been answered)
  const first = waiting === 0;
  waiting++;
  const mine = (first ? show() : tail.then(show)).finally(() => { waiting--; });
  tail = mine.catch(() => undefined);
  return mine;
}

// ---------------------------------------------------------------------------------------------------------------
// The wrapper around the wallet
// ---------------------------------------------------------------------------------------------------------------
export interface GuardOptions {
  /** The chain the wallet client is for: anything but VYRE's is passed through unchecked */
  chainId: number;
  /** VYRE's chain id as this app is built (default: the SDK's testnet): `walletOn` passes the app's own, so the check follows the app when it moves networks */
  vyreChainId?: number;
  /** The check service's address (default: the SDK's for the testnet) */
  url?: string;
  /** Opens the dialog (default: MINTA's own); resolves true to go on */
  ask?: (concerns: Concern[]) => Promise<boolean>;
  /** The time budget in milliseconds (default CHECK_BUDGET_MS) */
  budgetMs?: number;
}

/** The parts of a wallet's `eth_sendTransaction` the check needs, or null when this send isn't one to check (go on without) */
function readTx(p: unknown, chainId: number): { from: string; to: string; data?: string; value?: bigint } | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const t = p as Record<string, unknown>;
  // a transaction that names another chain than VYRE's isn't ours to check
  if (t.chainId !== undefined) {
    const c = typeof t.chainId === 'number' ? t.chainId : typeof t.chainId === 'string' && /^(0|[1-9][0-9]{0,15}|0x[0-9a-fA-F]{1,16})$/.test(t.chainId) ? Number(t.chainId) : NaN;
    if (c !== chainId) return null;
  }
  if (typeof t.from !== 'string' || !isAddress(t.from, { strict: false })) return null;
  if (typeof t.to !== 'string' || !isAddress(t.to, { strict: false })) return null; // a contract creation has no `to`
  const raw = t.data ?? t.input;
  let data: string | undefined;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw) || (raw.length - 2) / 2 > MAX_DATA_BYTES) return null;
    data = raw;
  }
  let value: bigint | undefined;
  if (t.value !== undefined && t.value !== null) {
    if (typeof t.value === 'bigint' && t.value >= 0n) value = t.value;
    else if (typeof t.value === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(t.value)) value = BigInt(t.value);
    else return null;
  }
  return { from: t.from, to: t.to, ...(data !== undefined ? { data } : {}), ...(value !== undefined ? { value } : {}) };
}

/** A flagged address said to be the contract the transaction calls must be the one it really calls (the service can't name another under that sentence) */
export function pinTo(cs: Concern[], to: string): Concern[] {
  return cs.map((c) => (c.code === 'flagged_address' && c.role === 'to' && c.address?.toLowerCase() !== to.toLowerCase() ? { ...c, role: undefined } : c));
}

/** Asks the service, waiting no longer than the budget; always resolves, with the concerns to show ([] for no answer, whatever the reason) */
async function concernsWithin(tx: NonNullable<ReturnType<typeof readTx>>, o: GuardOptions): Promise<Concern[]> {
  const budget = o.budgetMs ?? CHECK_BUDGET_MS;
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Concern[]>((resolve) => { timer = setTimeout(() => { stop.abort(); resolve([]); }, budget); });
  try {
    const asked = checkTransaction({ chain: { id: o.chainId } }, tx, { ...(o.url ? { url: o.url } : {}), timeoutMs: budget, signal: stop.signal }).then((a) => pinTo(concernsOf(a), tx.to), () => []);
    return await Promise.race([asked, late]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the check for one send's parameter. Resolves to go on, with whether it waited for anything (the service, the person);
 * throws CheckCancelled and nothing else, only if someone chose Cancel.
 */
export async function reviewBeforeSend(params: unknown, o: GuardOptions): Promise<boolean> {
  if (o.chainId !== (o.vyreChainId ?? vyreTestnet.id)) return false;
  let concerns: Concern[] = [];
  let waited = false;
  try {
    const tx = readTx(Array.isArray(params) ? params[0] : undefined, o.chainId);
    if (tx) { waited = true; concerns = await concernsWithin(tx, o); }
  } catch {
    concerns = [];
  }
  if (!concerns.length) return waited;
  let go = false;
  try { go = await (o.ask ?? askToContinue)(concerns); } catch { go = false; }
  if (!go) throw new CheckCancelled();
  return true;
}

/** A wallet's answer to `eth_chainId` as a number (NaN when it isn't one) */
const chainIdOf = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && /^(0x[0-9a-fA-F]{1,16}|[1-9][0-9]{0,15})$/.test(v) ? Number(v) : NaN;

/** The sends the check looks at: viem uses `wallet_sendTransaction` for a wallet that refuses `eth_sendTransaction`, with the same parameter */
const SENDS: ReadonlySet<string> = new Set(['eth_sendTransaction', 'wallet_sendTransaction']);
/** The error codes for which viem resends a refused `eth_sendTransaction` as `wallet_sendTransaction` (invalid input or params, method not found or not supported) */
const RESENT_ON: ReadonlySet<unknown> = new Set([-32000, -32602, -32601, -32004]);
const keyOf = (params: unknown): string | null => { try { return JSON.stringify(params) ?? null; } catch { return null; } };

/**
 * The wallet's provider with its sends going through the check first, and the wallet's network asked again after it;
 * everything else is passed to the wallet as it is. For any chain but VYRE's, the provider itself comes back, untouched.
 */
export function guardProvider(provider: EIP1193Provider, o: GuardOptions): EIP1193Provider {
  if (o.chainId !== (o.vyreChainId ?? vyreTestnet.id)) return provider;
  const toWallet = (args: { method: string; params?: unknown }) => provider.request(args as Parameters<EIP1193Provider['request']>[0]);
  // the send the wallet has just refused as `eth_sendTransaction`: viem's very next request is the same one as
  // `wallet_sendTransaction`, which was checked a moment ago and isn't asked about twice
  let refused: string | null = null;
  const request = async (args: { method: string; params?: unknown }) => {
    const resent = refused;
    refused = null;
    if (!args || !SENDS.has(args.method)) return toWallet(args);
    const key = keyOf(args.params);
    if (!(args.method === 'wallet_sendTransaction' && key !== null && key === resent)) {
      // the check may have taken a while (or waited on the person): the send goes to whatever network the wallet is on now
      if (await reviewBeforeSend(args.params, o)) {
        const now = chainIdOf(await toWallet({ method: 'eth_chainId' }));
        if (now !== o.chainId) throw new WalletMovedNetwork(); // (an answer that can't be read isn't VYRE's either)
      }
    }
    try {
      return await toWallet(args);
    } catch (e) {
      if (args.method === 'eth_sendTransaction' && key !== null && RESENT_ON.has((e as { code?: unknown } | null)?.code)) refused = key;
      throw e;
    }
  };
  // (the Proxy's target is an empty shell, not the wallet's provider: a Proxy's `get` must return a frozen provider's own `request`
  // unchanged, and throws when it doesn't, which would stop every send for that wallet; with a shell there is no invariant to break.
  // Everything but `request` is read from the wallet's own provider and bound to it.)
  return new Proxy({} as EIP1193Provider, {
    get(_shell, prop) {
      if (prop === 'request') return request;
      const v = Reflect.get(provider, prop, provider) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(provider) : v;
    },
    has: (_shell, prop) => prop in provider,
  });
}
