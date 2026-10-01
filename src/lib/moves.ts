// The Arc addresses a Face ID wallet moved USDC to, kept in this browser (newest first) so MINTA can follow each move,
// with the VYRE block each was started at so a later look starts there and not at the beginning of the chain. Only
// addresses and block numbers: nothing secret. Everything read back is checked; anything else is dropped.
// (No relative imports here: test/moves.test.mjs runs this file with Node as it is.)
import { getAddress, isAddress, type Address } from 'viem';

export interface Move {
  /** The address on Arc the move pays out to */
  dest: Address;
  /** The VYRE block just before it was started, or null when that isn't known (found by address, or saved before this) */
  from: bigint | null;
}

/** The most kept */
export const MAX_MOVES = 5;
/** How far back to look for a move whose start block isn't known: about 10 days at VYRE's fastest (4 blocks a second) */
export const LOOK_BACK_BLOCKS = 3_500_000n;
/** Blocks per log query for those looks (a fifth of them: 7 queries) */
export const LOOK_PAGE_BLOCKS = 500_000n;

export const movesKey = (account: string) => `vyre:moves:${account.toLowerCase()}`;

/** The first VYRE block to read from for `m`, when the newest block is `head` */
export function fromBlockOf(m: Move, head: bigint): bigint {
  if (m.from !== null && m.from <= head) return m.from;
  return head > LOOK_BACK_BLOCKS ? head - LOOK_BACK_BLOCKS : 0n;
}

/** The moves in `raw` (what localStorage holds): the well-formed ones, each address once, at most MAX_MOVES. Older
 * versions kept bare addresses; those come back with no start block */
export function parseMoves(raw: string | null): Move[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: Move[] = [];
  for (const x of list) {
    const d = typeof x === 'string' ? x : typeof x === 'object' && x !== null ? (x as { d?: unknown }).d : undefined;
    if (typeof d !== 'string' || !isAddress(d) || /^0x0{40}$/.test(d)) continue;
    const b = typeof x === 'object' && x !== null ? (x as { b?: unknown }).b : undefined;
    const dest = getAddress(d);
    if (out.some((o) => o.dest === dest)) continue;
    out.push({ dest, from: typeof b === 'string' && /^\d{1,15}$/.test(b) ? BigInt(b) : null });
  }
  return out.slice(0, MAX_MOVES);
}

export function serializeMoves(list: Move[]): string {
  return JSON.stringify(list.slice(0, MAX_MOVES).map((m) => ({ d: m.dest, b: m.from === null ? null : String(m.from) })));
}

/** `m` at the front, and where it was already listed, the earlier start block kept (an earlier move to it is still open) */
export function withMove(list: Move[], m: Move): Move[] {
  const old = list.find((o) => o.dest === m.dest);
  const from = old === undefined ? m.from : old.from === null || m.from === null ? null : old.from < m.from ? old.from : m.from;
  return [{ dest: m.dest, from }, ...list.filter((o) => o.dest !== m.dest)].slice(0, MAX_MOVES);
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

export function loadMoves(account: string, store: KeyValue | null = local()): Move[] {
  try {
    return parseMoves(store?.getItem(movesKey(account)) ?? null);
  } catch {
    return [];
  }
}

/** Keeps `m` (see withMove) and returns the list now; the list is returned even if this browser won't keep it */
export function keepMove(account: string, m: Move, store: KeyValue | null = local()): Move[] {
  const list = withMove(loadMoves(account, store), m);
  try {
    store?.setItem(movesKey(account), serializeMoves(list));
  } catch {
    /* site data blocked: shown until the page reloads */
  }
  return list;
}
