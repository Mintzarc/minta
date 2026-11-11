// What went wrong, in words, when a wallet or a contract turned something down. Kept apart from lib/chain.ts (which needs a
// browser) so it can be checked on its own; lib/padv2.ts uses the same checks. Nothing here talks to anything, and it imports nothing.
//
// The case that matters most: every write is simulated by the page first (the SDK's sendCall), and only then is the wallet asked to
// send it. If the wallet then answers with an error, the library that talks to it labels that "the contract function reverted with
// the following reason:" and puts the wallet's words on the next line. It was not a revert (the simulation had just passed).
// The page may say "Nothing was sent." only when that is certain:
//   (a) the page itself stopped before the wallet was asked (its own simulation or guards, the transaction check's cancel);
//   (b) the person said no in the wallet ("Cancelled in your wallet.");
//   (c) the wallet's own answer (the innermost error, not the library's wrappers around it) carries a standard provider code that
//       cannot follow a broadcast: unauthorized (4100), unsupported method (4200), disconnected (4900, 4901), unknown chain (4902),
//       method not found (-32601), invalid parameters (-32602).
// Every other answer from the send step, whatever its words (a timeout, "already known", "nonce too low", an internal error, even
// "insufficient funds": words are a wallet's to choose, and a second broadcast of a sent transaction earns many of them), reads:
// "Your wallet didn't confirm this. It said: "...". It may still have gone out: check your wallet's activity before trying again."
// Nothing is decided by matching words, and nothing is read from the library's wrapper messages (they repeat the call's own
// arguments, a token's name among them).

type Link = {
  code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; reason?: unknown; data?: unknown;
  docsPath?: unknown; cause?: unknown; approvalHash?: unknown;
};

function* links(e: unknown): Generator<Link> {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 8; x = (x as Link).cause, i++) yield x as Link;
}

/** The wallet's own answer: the innermost error of the chain (the library wraps it, sometimes several times) */
function innermost(e: unknown): Link | null {
  let last: Link | null = null;
  for (const x of links(e)) last = x;
  return last;
}
const wordsIn = (x: Link | null): string => (x ? [x.message, x.details].filter((t): t is string => typeof t === 'string').join(' ') : '');

// How wallets word a refusal when they give no code for it, or the wrong one (a hardware wallet behind an internal error, say)
const SAID_NO = /user (?:rejected|denied|cancell?ed|declined|refused)|(?:rejected|denied|cancell?ed|declined|refused) by (?:the )?user|denied (?:transaction|message|request|account)|request (?:rejected|denied)/i;

/** True when the person said no in their wallet: 4001 (a browser wallet), 5000 (WalletConnect), the library's own name for it, or
 *  the wallet's own words for it at any code */
export function userRejected(e: unknown): boolean {
  for (const x of links(e)) if (x.code === 4001 || x.code === 5000 || x.name === 'UserRejectedRequestError') return true;
  return SAID_NO.test(wordsIn(innermost(e)));
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
  }
  // in words: only the node's or wallet's own answer counts (the library's wrappers say "reverted" for any failure, and repeat the
  // call's arguments)
  return /execution reverted/i.test(wordsIn(innermost(e)));
}

// Every mark that could pass for a quotation mark (the page puts its own pair around a wallet's words; none may be faked inside them)
const QUOTES = /[\p{Pi}\p{Pf}"'`´\u00A8\u02B9-\u02BC\u02CA\u02CB\u0300\u0301\u201A\u201E\u2032-\u2037\u275B-\u275E\u276E\u276F\u301D-\u301F\uFF02\uFF07]/gu;

/** One line of someone else's words: no web addresses or bare site names (a wallet's text is not ours to link), no hidden or
 *  look-alike characters, no quotation marks of its own, no line breaks, a length limit */
export const tidy = (t: string, max = 160): string =>
  t.replace(QUOTES, '').normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    .replace(/\b(?:https?:\/\/|wss?:\/\/|www\.)\S+/gi, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?(?=$|[\s,;:!?)])/gi, '')
    .replace(QUOTES, '')
    .replace(/\s+/g, ' ').trim().replace(/[.:;,\s]+$/, '').slice(0, max).trim();

// The standard provider codes that cannot follow a broadcast (see the top of this file)
const NOT_SENT_CODES: ReadonlySet<unknown> = new Set([4100, 4200, 4900, 4901, 4902, -32601, -32602]);
// The library's two send steps: a contract call (its error names the step) and a plain transfer (its error has a name of its own)
const fromSendStep = (x: Link): boolean =>
  (x.name === 'ContractFunctionExecutionError' && x.docsPath === '/docs/contract/writeContract') || x.name === 'TransactionExecutionError';
// The library's own checks inside those steps, and the page's guard, which stop before the wallet is asked
const BEFORE_ASKING: ReadonlySet<unknown> = new Set(['ChainMismatchError', 'ChainNotFoundError', 'AccountNotFoundError', 'AccountTypeNotSupportedError', 'WcError']);

/**
 * What a failed send was, when the error is the wallet's answer to the library's send step (the page had simulated it first):
 * `refused` only when the wallet's own code proves nothing was broadcast, `unconfirmed` for every other answer (it may have gone
 * out). null for anything else: not from a send, stopped before the wallet was asked, a refusal by the person, or a revert.
 */
export function sendOutcome(e: unknown): { kind: 'refused' | 'unconfirmed'; words: string } | null {
  let fromSend = false;
  for (const x of links(e)) {
    if (fromSendStep(x)) fromSend = true;
    if (BEFORE_ASKING.has(x.name)) return null;
  }
  if (!fromSend || userRejected(e) || realRevert(e)) return null;
  const own = innermost(e);
  // the wallet's code: the innermost error's, or the nearest one above it when the innermost carries none
  let code: unknown;
  for (const x of links(e)) if (typeof x.code === 'number') code = x.code;
  const said = own && own !== e && typeof own.message === 'string' ? own.message : typeof own?.details === 'string' ? own.details : '';
  return { kind: NOT_SENT_CODES.has(code) ? 'refused' : 'unconfirmed', words: tidy(said) };
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

/** The page's own refusal from the WalletConnect guard (lib/wc.ts), wherever it sits in an error: its words are the page's own and
 *  already say that nothing was sent, so they are shown as they are, never quoted as a wallet's */
export function ownRefusal(e: unknown): string | null {
  for (const x of links(e)) if (x.name === 'WcError' && typeof x.message === 'string' && x.message) return x.message;
  return null;
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
