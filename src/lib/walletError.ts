// What went wrong, in words, when a wallet or a contract turned something down. Kept apart from lib/chain.ts (which needs a
// browser) so it can be checked on its own; lib/padv2.ts uses the same checks. Nothing here talks to anything, and it imports nothing.
//
// The case that matters most: every write is simulated by the page first (the SDK's sendCall), and only then is the wallet asked to
// send it. If the wallet then answers with an error, the library that talks to it labels that "the contract function reverted with
// the following reason:" and puts the wallet's words on the next line. It was not a revert (the simulation had just passed).
// What the page may say depends on what the wallet's answer proves:
//   - a refusal that shows nothing was broadcast (not enough funds for gas, a nonce or fee the node turns down, a method or chain
//     the wallet does not take): "Your wallet couldn't send this: ... Nothing was sent."
//   - anything else (a timeout, a lost connection, an internal error with no more to go on): the answer may simply have been lost
//     on its way back, after the wallet did send it. The page must not invite a second send: "Your wallet didn't confirm this: ...
//     It may still have gone out: check your wallet's activity before trying again."

type Link = {
  code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; reason?: unknown; data?: unknown;
  docsPath?: unknown; cause?: unknown; approvalHash?: unknown;
};

function* links(e: unknown): Generator<Link> {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 8; x = (x as Link).cause, i++) yield x as Link;
}

/** True when the person said no in their wallet: 4001 (a browser wallet), 5000 (WalletConnect), or the library's own name for it */
export function userRejected(e: unknown): boolean {
  for (const x of links(e)) if (x.code === 4001 || x.code === 5000 || x.name === 'UserRejectedRequestError') return true;
  return false;
}

/** Revert data, wherever a node or a wallet puts it: `data`, `data.data`, or `data.originalError.data` */
export function hasRevertData(d: unknown, depth = 0): boolean {
  if (typeof d === 'string') return /^0x[0-9a-fA-F]{8,}$/.test(d);
  if (!d || typeof d !== 'object' || depth > 3) return false;
  const o = d as { data?: unknown; originalError?: unknown };
  return hasRevertData(o.data, depth + 1) || hasRevertData(o.originalError, depth + 1);
}

/** True when a call really reverted on the chain's own terms: the node answered "execution reverted" (code 3, or in so many words)
 *  or gave revert data. A node that could not be reached, or answered with an internal error and nothing else, did not say that. */
export function realRevert(e: unknown): boolean {
  for (const x of links(e)) {
    if (x.code === 3 || hasRevertData(x.data) || x.name === 'ContractFunctionZeroDataError') return true;
    // the library's own wrappers repeat "reverted" for any failure, so only what came from the node or wallet counts
    if (x.name === 'ContractFunctionExecutionError' || x.name === 'ContractFunctionRevertedError') continue;
    for (const t of [x.message, x.details]) if (typeof t === 'string' && /execution reverted/i.test(t)) return true;
  }
  return false;
}

/** One line of someone else's words: no web addresses or bare site names (a wallet's text is not ours to link), no hidden or
 *  look-alike characters, no quotation marks of its own, no line breaks, a length limit */
export const tidy = (t: string, max = 160): string =>
  t.normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    .replace(/\b(?:https?:\/\/|wss?:\/\/|www\.)\S+/gi, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?(?=$|[\s,;:!?)])/gi, '')
    .replace(/[“”„‟"«»]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/[.:;,\s]+$/, '').slice(0, max).trim();

// An answer that can mean "it was sent and the answer was lost": never proof that nothing went out. A node that says "nonce too
// low", "replacement transaction underpriced" or "already known" is one of these: that is what a wallet hears when its first
// broadcast landed and it tried again.
const MAYBE_SENT = /tim(?:e|ed)[ -]?out|timeout|expired|web ?socket|socket|closed|\b1006\b|failed to fetch|fetch failed|network|connection|disconnect|no response|relay|already known|known transaction|already imported|nonce too low|nonce has already been used|replacement/i;
// What a wallet or its node says when it turns a transaction down before it goes anywhere
const NOT_SENT = /insufficient funds|insufficient balance|not enough (?:funds|balance|gas)|nonce too high|underpriced|fee cap|max fee per gas less than|max priority fee|tip (?:above|higher than)|intrinsic gas|gas limit|exceeds block gas|gas required exceeds|transaction type not supported|invalid (?:params|parameters|input|argument|sender|chain)|method not (?:found|supported|available)|unsupported method|not supported|chain (?:id )?mismatch|unrecognized chain|unknown chain|does not match the target chain|unauthorized|not authorized/i;
// The codes for the same: bad request or parameters, unknown method, unauthorized, unsupported method, unknown chain. (-32603,
// "internal error", and -32003, "transaction rejected", say nothing either way: a node rejects a second copy of a transaction too.)
const NOT_SENT_CODES: ReadonlySet<unknown> = new Set([-32600, -32601, -32602, 4100, 4200, 4902]);

/** The wallet's own words in an error from a send, or '' */
function wordsOf(e: unknown): string {
  for (const x of links(e)) if (typeof x.details === 'string' && x.details.trim()) return x.details;
  for (const x of links(e)) if (typeof x.reason === 'string' && x.reason.trim()) return x.reason;
  let last: Link | null = null;
  for (const x of links(e)) last = x;
  if (!last || last === e) return '';
  const m = typeof last.shortMessage === 'string' ? last.shortMessage : typeof last.message === 'string' ? last.message : '';
  return m.split('\n')[0] ?? '';
}

/**
 * What a failed send was, when the error comes from the library's send step (after the page's own simulation passed) and is not a
 * revert: `refused` when the answer proves nothing was broadcast, `unconfirmed` when it does not (it may have gone out). null for
 * anything else: an error that is not from a send, or a revert (with data, or said by the wallet's node), which reads as a revert.
 */
export function sendOutcome(e: unknown): { kind: 'refused' | 'unconfirmed'; words: string } | null {
  let fromSend = false;
  for (const x of links(e)) if (x.docsPath === '/docs/contract/writeContract') fromSend = true;
  if (!fromSend || realRevert(e) || userRejected(e)) return null;
  const raw = wordsOf(e);
  let refused = false;
  let maybe = MAYBE_SENT.test(raw);
  for (const x of links(e)) {
    if (NOT_SENT_CODES.has(x.code)) refused = true;
    for (const t of [x.message, x.details]) if (typeof t === 'string') { if (NOT_SENT.test(t)) refused = true; if (MAYBE_SENT.test(t)) maybe = true; }
  }
  return { kind: refused && !maybe ? 'refused' : 'unconfirmed', words: tidy(raw) };
}

const MAY_BE_OUT = 'It may still have gone out: check your wallet’s activity before trying again.';

/** The sentence for a send the wallet did not make, or did not confirm, after the page's own simulation passed; null for anything else */
export function walletSendFailure(e: unknown): string | null {
  const o = sendOutcome(e);
  if (!o) return null;
  if (o.kind === 'refused') return o.words ? `Your wallet couldn’t send this. It said: “${o.words}”. Nothing was sent.` : 'Your wallet couldn’t send this. Nothing was sent.';
  return o.words ? `Your wallet didn’t confirm this. It said: “${o.words}”. ${MAY_BE_OUT}` : `Your wallet didn’t confirm this, and gave no reason. ${MAY_BE_OUT}`;
}

/** The first line of a message, and the line after it when the first only announces it ("... reverted with the following reason:") */
export function firstWords(message: string): string {
  const lines = message.split('\n').map((l) => l.trim());
  const first = lines[0] ?? '';
  if (/:$/.test(first)) {
    // the very next line with words, unless it is the start of the library's own listing ("Contract Call:", "Docs: ...")
    const next = lines.slice(1).find((l) => l);
    if (next && !/:$/.test(next) && !/^(Docs|Details|Version|URL|Request body):/i.test(next)) return `${first} ${next}`.slice(0, 220);
  }
  return first.slice(0, 220);
}

/** The name lib/padv2.ts gives an error raised after a sale's exact approval was mined (it carries `approvalHash` and the cause) */
export const SALE_AFTER_APPROVAL = 'SaleAfterApprovalError';

/**
 * The sentence for a sale that stopped after its approval went through; null for any other error. The approval is on the chain,
 * so the page says so, and says what became of the sale by the same rule as any send: not sent, or possibly sent.
 */
export function afterApprovalFailure(e: unknown): string | null {
  const top = e as Link | null;
  if (!top || typeof top !== 'object' || top.name !== SALE_AFTER_APPROVAL) return null;
  const inner = top.cause;
  const went = 'The approval went through';
  if (userRejected(inner)) return `${went}. You cancelled the sale in your wallet: press Sell again when you’re ready.`;
  const o = sendOutcome(inner);
  const quoted = o?.words ? ` It said: “${o.words}”.` : '';
  if (o?.kind === 'refused') return `${went}, but your wallet couldn’t send the sale.${quoted} The sale was not sent: press Sell again.`;
  if (o) return `${went}, but your wallet didn’t confirm the sale.${quoted} The sale may still have gone out: check your wallet’s activity before pressing Sell again.`;
  const x = inner as { shortMessage?: unknown; message?: unknown } | null;
  const m = x && typeof x === 'object' ? (typeof x.shortMessage === 'string' ? x.shortMessage : typeof x.message === 'string' ? x.message : '') : '';
  const said = tidy(firstWords(m), 200);
  return `${went}, but the sale did not${said ? `: “${said}”` : ''}. Press Sell again.`;
}

/** What the trade panel says when a sale could not use a signed permit and asks for an exact approval instead (two confirmations) */
export const PERMIT_UNSIGNED_NOTE = 'Your wallet couldn’t sign the permit, so it is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
export const PERMIT_REFUSED_NOTE = 'This token doesn’t take a permit, so your wallet is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
