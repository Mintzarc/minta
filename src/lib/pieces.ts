// Reading long lists and long block ranges in pieces. Imports only the SDK, so the unit tests can run it in node.
import { LOG_PAGE_BLOCKS, readLogsSplitting } from '@vyrechain/sdk';

/** The most addresses (or alternatives for one topic) one log filter names: the public RPC takes up to 200, and 50 keeps a call light */
export const LOG_LIST_MAX = 50;

/** Reads `xs` in pieces of at most `n`, one piece after another (the public RPC serves one call at a time), the pieces' results in order */
export async function inPieces<X, R>(xs: X[], n: number, read: (piece: X[]) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('a piece holds at least one');
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(await read(xs.slice(i, i + n)));
  return out;
}

/**
 * Every log between two blocks, a page of blocks at a time (newest page first), until `stop` says there's enough. A page the public RPC
 * refuses as too large (a very busy pool) is halved and read in pieces.
 */
export async function pagedLogs<T>(read: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, stop?: (got: T[]) => boolean): Promise<T[]> {
  const out: T[] = [];
  for (let hi = to; hi >= from; hi -= LOG_PAGE_BLOCKS) {
    const lo = hi - LOG_PAGE_BLOCKS + 1n > from ? hi - LOG_PAGE_BLOCKS + 1n : from;
    out.push(...(await readLogsSplitting(read, lo, hi)));
    if (stop?.(out)) break;
  }
  return out;
}
