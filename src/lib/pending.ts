// Transfers from other chains still on their way to Arc, kept in this browser so a reload doesn't lose track of them.
// Only what's needed to follow one is kept (its hash, chain, recipient and amounts: nothing secret). Everything read
// back is checked, and anything that isn't a well-formed transfer from one of the source chains is dropped.
// (No relative imports here: test/pending.test.mjs runs this file with Node as it is.)
import { CCTP_SOURCES } from '@vyrechain/sdk';
import { getAddress, type Address, type Hash } from 'viem';

export interface PendingTransfer {
  /** The burn, on the source chain */
  hash: Hash;
  /** The source chain's ID (one of CCTP_SOURCES) */
  chainId: number;
  /** Who gets it on Arc */
  account: Address;
  /** USDC burned, in the source chain's units (6 decimals) */
  amount: bigint;
  /** The most Circle takes out of it: at least amount less this arrives */
  maxFee: bigint;
  /** When it was sent (ms since 1970) */
  at: number;
}

export const PENDING_KEY = 'vyre.fromChain.pending';
/** The most kept (the newest) */
export const MAX_PENDING = 20;

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNITS = /^\d{1,30}$/;

function read(x: unknown): PendingTransfer | null {
  if (typeof x !== 'object' || x === null) return null;
  const { hash, chainId, account, amount, maxFee, at } = x as Record<string, unknown>;
  if (typeof hash !== 'string' || !HASH.test(hash)) return null;
  if (typeof chainId !== 'number' || !CCTP_SOURCES.some((s) => s.id === chainId)) return null;
  if (typeof account !== 'string' || !ADDRESS.test(account) || /^0x0{40}$/.test(account)) return null;
  if (typeof amount !== 'string' || !UNITS.test(amount) || typeof maxFee !== 'string' || !UNITS.test(maxFee)) return null;
  const a = BigInt(amount);
  const f = BigInt(maxFee);
  if (a <= 0n || f >= a) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  return { hash: hash.toLowerCase() as Hash, chainId, account: getAddress(account), amount: a, maxFee: f, at };
}

/** The transfers in `raw` (what localStorage holds): the well-formed ones, each once, oldest first, at most MAX_PENDING */
export function parsePending(raw: string | null): PendingTransfer[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: PendingTransfer[] = [];
  for (const x of list) {
    const t = read(x);
    if (t && !out.some((o) => o.hash === t.hash)) out.push(t);
  }
  return out.slice(-MAX_PENDING);
}

export function serializePending(list: PendingTransfer[]): string {
  return JSON.stringify(list.slice(-MAX_PENDING).map((t) => ({ ...t, amount: String(t.amount), maxFee: String(t.maxFee) })));
}

/** The storage in use: localStorage, which can be missing or refuse (a private window, blocked site data) */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const local = (): KeyValue | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadPending(store: KeyValue | null = local()): PendingTransfer[] {
  try {
    return parsePending(store?.getItem(PENDING_KEY) ?? null);
  } catch {
    return [];
  }
}

/** Adds (or replaces) one; false if this browser won't keep it */
export function addPending(t: PendingTransfer, store: KeyValue | null = local()): boolean {
  return save([...loadPending(store).filter((x) => x.hash !== t.hash.toLowerCase()), { ...t, hash: t.hash.toLowerCase() as Hash }], store);
}

/** Forgets one (once it's arrived, or failed, or the user stops following it) */
export function removePending(hash: Hash, store: KeyValue | null = local()): boolean {
  return save(loadPending(store).filter((x) => x.hash !== hash.toLowerCase()), store);
}

function save(list: PendingTransfer[], store: KeyValue | null): boolean {
  if (!store) return false;
  try {
    store.setItem(PENDING_KEY, serializePending(list));
    return true;
  } catch {
    return false;
  }
}
