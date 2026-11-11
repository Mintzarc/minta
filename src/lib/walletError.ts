// What went wrong, in words, when a wallet or a contract turned something down. Kept apart from lib/chain.ts (which needs a
// browser) so it can be checked on its own; lib/padv2.ts uses the same checks. Nothing here talks to anything, and it imports nothing.
//
// The case that matters most: every write is simulated by the page first (the SDK's sendCall), and only then is the wallet asked to
// send it. If the wallet then answers with an error, the library that talks to it labels that "the contract function reverted with
// the following reason:" and puts the wallet's words on the next line. It was not a revert (the simulation had just passed).
//
// For an error from the send step there are two sentences, and no others:
//   - the person said no in the wallet: "Cancelled in your wallet."
//   - anything else: "Your wallet didn't confirm this. It said: "...". It may still have gone out: check your wallet's activity
//     before trying again."
// The page never says "Nothing was sent." about a send the wallet was asked to make: no code and no wording from a wallet proves
// it (a wallet asked twice, a lost answer, a second broadcast of a sent transaction all earn ordinary-looking refusals). It says
// so only for what the page itself stopped before asking: its own simulation, its own guards, the transaction check's cancel.

type Link = {
  code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; data?: unknown;
  docsPath?: unknown; cause?: unknown; approvalHash?: unknown; thing?: unknown; button?: unknown; hash?: unknown;
};

function* links(e: unknown): Generator<Link> {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 8; x = (x as Link).cause, i++) yield x as Link;
}

/** What the wallet itself answered: the end of the chain of causes (the library wraps it, sometimes several times). It may be
 *  anything a wallet can throw: an object, a bare string, nothing at all. */
function answer(e: unknown): unknown {
  let x: unknown = e;
  for (let i = 0; i < 8 && x && typeof x === 'object' && (x as Link).cause !== undefined && (x as Link).cause !== null; i++) x = (x as Link).cause;
  return x;
}
/** True for an error the library (or the language) made itself, whose text is not a wallet's: the library's own errors carry a
 *  `shortMessage`, and a wallet that throws nothing leaves a TypeError behind */
const notAWalletsWords = (x: unknown): boolean =>
  !!x && typeof x === 'object' && (typeof (x as Link).shortMessage === 'string' || x instanceof TypeError || x instanceof RangeError || x instanceof ReferenceError);
/** The wallet's own words in an error, or '' when it gave none (never the library's text for "something went wrong") */
function saidBy(e: unknown): string {
  const a = answer(e);
  if (typeof a === 'string') return a;
  if (!a || typeof a !== 'object' || a === e || notAWalletsWords(a)) return '';
  const m = (a as Link).message;
  return typeof m === 'string' ? m : '';
}

// How wallets word a refusal by the person when they give no code for it, or the wrong one. Exact openings only: "request
// rejected", "rejected by peer", "denied: rate limit" and the like are not a person saying no.
const SAID_NO = [
  /^user (?:rejected|denied|cancell?ed)\b/i,
  /^(?:metamask tx signature: )?user denied (?:transaction|message) signature/i,
  /^rejected by (?:the )?user\b/i,
  /\(denied by the user\??\)/i, // a Ledger device behind a wallet
];

/** True when the person said no in their wallet: 4001 (a browser wallet), 5000 (WalletConnect), the libraries' own names for it,
 *  or one of the exact wordings wallets use for it (as the wallet's own answer, an object or a bare string) */
export function userRejected(e: unknown): boolean {
  for (const x of links(e)) if (x.code === 4001 || x.code === 5000 || x.code === 'ACTION_REJECTED' || x.name === 'UserRejectedRequestError') return true;
  const a = answer(e);
  const words = (typeof a === 'string' ? a : a && typeof a === 'object' && !notAWalletsWords(a) && typeof (a as Link).message === 'string' ? (a as Link).message as string : '').trim();
  return SAID_NO.some((r) => r.test(words));
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
  for (const x of links(e)) if (x.code === 3 || hasRevertData(x.data) || x.name === 'ContractFunctionZeroDataError') return true;
  // in words: only the node's or wallet's own answer counts (the library's wrappers say "reverted" for any failure, and repeat the
  // call's arguments)
  const a = answer(e);
  const own = typeof a === 'string' ? a : a && typeof a === 'object' && !notAWalletsWords(a) ? [(a as Link).message, (a as Link).details].filter((t) => typeof t === 'string').join(' ') : '';
  return /execution reverted/i.test(own);
}

// Every mark that could pass for a quotation mark (the page puts its own pair around a wallet's words; none may be faked inside them)
const QUOTES = /[\p{Pi}\p{Pf}"'`´¨ʹ-ʼˊˋ̀́‚„′-‷❛-❞❮❯〝-〟＂＇]/gu;

/** One line of someone else's words: no web addresses or bare site names (a wallet's text is not ours to link), no hidden or
 *  look-alike characters, no quotation marks of its own, no line breaks, a length limit */
export const tidy = (t: string, max = 160): string =>
  t.replace(QUOTES, '').normalize('NFKC')
    .replace(/[​-‏‪-‮⁠-⁯﻿­]/g, '')
    .replace(/\b(?:https?:\/\/|wss?:\/\/|www\.)\S+/gi, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?(?=$|[\s,;:!?)])/gi, '')
    .replace(QUOTES, '')
    .replace(/\s+/g, ' ').trim().replace(/[.:;,\s]+$/, '').slice(0, max).trim();

/** The page's own refusals (lib/wc.ts registers each WcError it makes here): only these are shown as the page's own words */
const OWN = new WeakSet<object>();
export const markOwn = (e: object): void => { OWN.add(e); };
/** The page's own refusal, wherever it sits in an error: its words already say that nothing was sent, and are shown as they are.
 *  An object that merely calls itself by the same name (a wallet could) is not one. */
export function ownRefusal(e: unknown): string | null {
  for (const x of links(e)) if (OWN.has(x) && typeof x.message === 'string' && x.message) return x.message;
  return null;
}

// The library's two send steps: a contract call (its error names the step) and a plain transfer (its error has a name of its own)
const sendStep = (x: Link): boolean =>
  (x.name === 'ContractFunctionExecutionError' && x.docsPath === '/docs/contract/writeContract') || x.name === 'TransactionExecutionError';
// The library's own checks inside those steps, which stop before the wallet is asked
const BEFORE_ASKING: ReadonlySet<unknown> = new Set(['ChainMismatchError', 'ChainNotFoundError', 'AccountNotFoundError', 'AccountTypeNotSupportedError']);

/** True for an error made by the library's send step: the wallet was asked (or, for the few checks the library makes itself, about to be) */
export function fromSendStep(e: unknown): boolean {
  for (const x of links(e)) if (sendStep(x)) return true;
  return false;
}
/** True when the send step stopped before the wallet was asked: the library's own check, or the page's own guard */
export function stoppedBeforeAsking(e: unknown): boolean {
  for (const x of links(e)) if (BEFORE_ASKING.has(x.name) || OWN.has(x)) return true;
  return false;
}

/**
 * The wallet's words for a send it did not confirm: an error from the send step that is not the person's refusal, not a revert,
 * and not something that stopped before the wallet was asked. null for anything else. Whatever the wallet answered (any code,
 * any words, nothing), this is "it may have gone out": see the top of this file.
 */
export function sendUnconfirmed(e: unknown): { words: string } | null {
  if (!fromSendStep(e) || stoppedBeforeAsking(e) || userRejected(e) || realRevert(e)) return null;
  return { words: tidy(saidBy(e)) };
}

const MAY_BE_OUT = 'It may still have gone out: check your wallet’s activity before trying again.';

/** The sentence for a send the wallet did not confirm; null for anything else */
export function walletSendFailure(e: unknown): string | null {
  const o = sendUnconfirmed(e);
  if (!o) return null;
  return o.words ? `Your wallet didn’t confirm this. It said: “${o.words}”. ${MAY_BE_OUT}` : `Your wallet didn’t confirm this, and gave no reason. ${MAY_BE_OUT}`;
}

/** A transaction that was sent and whose result could not be read (the SDK's SentButUnconfirmedError): never "nothing was sent" */
export function sentUnread(e: unknown): string | null {
  const top = e as Link | null;
  if (!top || typeof top !== 'object' || top.name !== 'SentButUnconfirmedError') return null;
  return 'Sent, but its result couldn’t be read yet. It may have gone through: check it in your wallet’s activity or on the explorer before sending anything again.';
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
const AFTER_APPROVAL = 'AfterApprovalError';

/** An error for something that stopped after its exact approval was mined, for a caller that is not lib/padv2.ts (the transfer
 *  from another chain): `thing` is what did not happen ("transfer"), `button` the button to press again ("Move") */
export function afterApproval(cause: unknown, thing: string, button: string): Error {
  return Object.assign(new Error(`the approval went through, but the ${thing} did not`, { cause }), { name: AFTER_APPROVAL, thing, button });
}

/**
 * The sentence for something that stopped after its approval went through; null for any other error. The approval is on the
 * chain, so the page always says so, and says what became of the rest by the same rule as any send: cancelled by the person,
 * possibly sent, or (only when the page itself stopped it, or it was mined and failed) not done.
 */
export function afterApprovalFailure(e: unknown): string | null {
  const top = e as Link | null;
  if (!top || typeof top !== 'object' || (top.name !== SALE_AFTER_APPROVAL && top.name !== AFTER_APPROVAL)) return null;
  const thing = top.name === AFTER_APPROVAL && typeof top.thing === 'string' ? top.thing : 'sale';
  const button = top.name === AFTER_APPROVAL && typeof top.button === 'string' ? top.button : 'Sell';
  const inner = top.cause;
  const went = 'The approval went through';
  if (userRejected(inner)) return `${went}. You cancelled the ${thing} in your wallet: press ${button} again when you’re ready.`;
  const o = sendUnconfirmed(inner);
  if (o) return `${went}, but your wallet didn’t confirm the ${thing}.${o.words ? ` It said: “${o.words}”.` : ''} The ${thing} may still have gone out: check your wallet’s activity before pressing ${button} again.`;
  const x = inner as { shortMessage?: unknown; message?: unknown } | null;
  const m = typeof inner === 'string' ? inner : x && typeof x === 'object' ? (typeof x.shortMessage === 'string' ? x.shortMessage : typeof x.message === 'string' ? x.message : '') : '';
  const said = tidy(firstWords(m), 200);
  return `${went}, but the ${thing} did not${said ? `: “${said}”` : ''}. Press ${button} again.`;
}

/** What the trade panel says when a sale could not use a signed permit and asks for an exact approval instead (two confirmations) */
export const PERMIT_UNSIGNED_NOTE = 'Your wallet couldn’t sign the permit, so it is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
export const PERMIT_REFUSED_NOTE = 'This token doesn’t take a permit, so your wallet is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
