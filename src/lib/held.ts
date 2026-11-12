// When a transaction that was sent, and whose result could not be read, may be given up on ("start over"). Only when the chain
// itself has answered that it has no such transaction (never after a read that failed for another reason: a busy node, a rate
// limit, no connection), and only some minutes after it was sent, since a transaction can take that long to be picked up.
// Imports nothing, so the tests load it as it is.

/** How long after the send "start over" is first offered */
export const START_OVER_AFTER_MS = 5 * 60_000;

/** True when a receipt read failed because the chain has no receipt for that hash (viem's TransactionReceiptNotFoundError, anywhere in the error's causes) */
export function receiptNotFound(e: unknown): boolean {
  let x = e as { name?: unknown; cause?: unknown } | null | undefined;
  for (let i = 0; i < 8 && x && typeof x === 'object'; i++) {
    if (x.name === 'TransactionReceiptNotFoundError') return true;
    x = x.cause as typeof x;
  }
  return false;
}

/** Whether "start over" may be offered for a held transaction: the last read said "not found", and it was sent long enough ago */
export function mayStartOver(h: { at?: number; notFound?: boolean } | null | undefined, now: number): boolean {
  return !!h && h.notFound === true && typeof h.at === 'number' && Number.isFinite(h.at) && now - h.at >= START_OVER_AFTER_MS;
}
