// Reading a long list in pieces. No imports, so the unit tests can run it in node.

/** The most addresses (or alternatives for one topic) one log filter names: the public RPC takes up to 200, and 50 keeps a call light */
export const LOG_LIST_MAX = 50;

/** Reads `xs` in pieces of at most `n`, one piece after another (the public RPC serves one call at a time), the pieces' results in order */
export async function inPieces<X, R>(xs: X[], n: number, read: (piece: X[]) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('a piece holds at least one');
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(await read(xs.slice(i, i + n)));
  return out;
}
