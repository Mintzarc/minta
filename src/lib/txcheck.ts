// An advisory check before a wallet is asked to sign a transaction on VYRE. The check service (api.vyrechain.com, through
// the SDK's `checkTransaction`) runs the transaction without sending it and looks up the addresses in it with a security
// service. MINTA wraps the browser wallet's `eth_sendTransaction`, so every send on VYRE (launch, buy, sell, approve, the
// Wallet page's sends) goes through here without each page doing anything.
//
// The rules, which the tests (test/txcheck.test.mjs) hold in place:
//  - ADVISORY AND FAIL-OPEN. It waits at most CHECK_BUDGET_MS. Any error, a timeout, HTTP 429 or 500, a body that isn't
//    the expected answer, an answer where the simulation didn't happen: the transaction goes on, silently. A problem with
//    the service is never shown to anyone as a warning.
//  - Only when the answer carries a flag (or says the transaction would fail) does a dialog open, BEFORE the wallet's own
//    prompt, with Continue anyway and Cancel. No flag: nothing is shown, and nothing is said about the transaction at all.
//  - What the dialog says is MINTA's own wording for each kind of flag. The service's own sentences are never shown, and
//    the only thing taken from its answer into the text is an address that passed an address check, so a hostile answer
//    can't put words or markup in front of someone.
//  - Only VYRE's chain is ever checked; a wallet client for another chain is passed through untouched.
//
// No imports from the app (only viem and the SDK) so that node can run this file in the unit tests.
import { isAddress, type Address, type EIP1193Provider } from 'viem';
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
const ROLES: ReadonlySet<string> = new Set<ConcernRole>(['to', 'spender', 'counterparty']);
/** How many flags of an answer are read, and how many different concerns are kept (a hostile answer can't make the dialog long) */
const READ_AT_MOST = 50;
const KEEP_AT_MOST = 6;

const addressOf = (v: unknown): Address | undefined => (typeof v === 'string' && isAddress(v, { strict: false }) ? (v as Address) : undefined);

/**
 * What to tell someone about a check's answer: a list of concerns, empty when there is nothing to say. Empty for every kind of
 * "no answer" (the SDK's `{ available: false }`, an answer whose simulation didn't happen, anything malformed).
 */
export function concernsOf(answer: TxCheck | unknown): Concern[] {
  try {
    const a = answer as Partial<Record<string, unknown>> | null;
    if (!a || typeof a !== 'object' || a.available !== true || a.advisory !== true || a.simulated !== true) return [];
    const out: Concern[] = [];
    const seen = new Set<string>();
    const add = (c: Concern) => {
      const key = `${c.code}|${c.address?.toLowerCase() ?? ''}|${c.role ?? ''}`;
      if (!seen.has(key) && out.length < KEEP_AT_MOST) { seen.add(key); out.push(c); }
    };
    if (a.reverts === true) add({ code: 'reverts' });
    const flags = Array.isArray(a.flags) ? a.flags.slice(0, READ_AT_MOST) : [];
    for (const f of flags as unknown[]) {
      if (!f || typeof f !== 'object') continue;
      const { code, spender, address, role } = f as Record<string, unknown>;
      if (typeof code !== 'string' || !CODES.has(code)) continue;
      if (code === 'reverts') add({ code });
      else if (code === 'flagged_address') add({ code, address: addressOf(address), role: typeof role === 'string' && ROLES.has(role) ? (role as ConcernRole) : undefined });
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
      return { text: 'It would let a contract spend an unlimited amount of a token from your wallet.', address: c.address };
    case 'approval_to_unknown_spender':
      return { text: 'It would let a contract that isn’t one of the launchpad’s own contracts spend a token from your wallet.', address: c.address };
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
/** Opens the dialog; true when someone chose Continue anyway, false for Cancel (or if another question took its place: nothing is sent then either) */
export function askToContinue(concerns: Concern[]): Promise<boolean> {
  pending?.cancel();
  return new Promise<boolean>((resolve) => {
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
}

// ---------------------------------------------------------------------------------------------------------------
// The wrapper around the wallet
// ---------------------------------------------------------------------------------------------------------------
export interface GuardOptions {
  /** The chain the wallet client is for: anything but VYRE's is passed through unchecked */
  chainId: number;
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

/** Asks the service, waiting no longer than the budget; always resolves, with the concerns to show ([] for no answer, whatever the reason) */
async function concernsWithin(tx: NonNullable<ReturnType<typeof readTx>>, o: GuardOptions): Promise<Concern[]> {
  const budget = o.budgetMs ?? CHECK_BUDGET_MS;
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Concern[]>((resolve) => { timer = setTimeout(() => { stop.abort(); resolve([]); }, budget); });
  try {
    const asked = checkTransaction({ chain: { id: o.chainId } }, tx, { ...(o.url ? { url: o.url } : {}), timeoutMs: budget, signal: stop.signal }).then(concernsOf, () => []);
    return await Promise.race([asked, late]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the check for one `eth_sendTransaction`'s parameter. Resolves to go on; throws CheckCancelled and nothing else, only if someone chose Cancel. */
export async function reviewBeforeSend(params: unknown, o: GuardOptions): Promise<void> {
  if (o.chainId !== vyreTestnet.id) return;
  let concerns: Concern[] = [];
  try {
    const tx = readTx(Array.isArray(params) ? params[0] : undefined, o.chainId);
    if (tx) concerns = await concernsWithin(tx, o);
  } catch {
    concerns = [];
  }
  if (!concerns.length) return;
  let go = false;
  try { go = await (o.ask ?? askToContinue)(concerns); } catch { go = false; }
  if (!go) throw new CheckCancelled();
}

/**
 * The wallet's provider with its `eth_sendTransaction` going through the check first; everything else is passed to the
 * wallet as it is. For any chain but VYRE's, the provider itself comes back, untouched.
 */
export function guardProvider(provider: EIP1193Provider, o: GuardOptions): EIP1193Provider {
  if (o.chainId !== vyreTestnet.id) return provider;
  const request = async (args: { method: string; params?: unknown }) => {
    if (args && args.method === 'eth_sendTransaction') await reviewBeforeSend(args.params, o);
    return provider.request(args as Parameters<EIP1193Provider['request']>[0]);
  };
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request;
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
