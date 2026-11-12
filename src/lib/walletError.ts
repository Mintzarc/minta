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

/** The hex a node or a wallet attached to an error, wherever it puts it (`data`, `data.data`, `data.originalError.data`, `data.cause.data`), or '' */
function attached(d: unknown, depth = 0): string {
  if (typeof d === 'string') return /^0x(?:[0-9a-fA-F]{2}){4,}$/.test(d) ? d.toLowerCase() : '';
  if (!d || typeof d !== 'object' || depth > 3) return '';
  const o = d as { data?: unknown; originalError?: unknown; cause?: unknown };
  return attached(o.data, depth + 1) || attached(o.originalError, depth + 1) || attached(o.cause, depth + 1);
}
/** The node's own words for a revert: they open its message (a message that only quotes them, "rate limited (last error: execution reverted)", does not) */
const REVERT_WORDS = /^execution reverted\b/i;
/**
 * The codes a revert in words comes under: 3 (what a node gives one: VYRE's RPC answers every revert as code 3 and a message
 * opening "execution reverted"), the general -32000 (some nodes), -32603 (an older wallet provider puts its node's revert there,
 * keeping the node's message, because 3 is no code it knows), or none at all. Under any other code (a limit's -32005, say) the
 * words are a quotation, not the node's verdict.
 */
const revertCode = (c: unknown): boolean => c === undefined || c === null || c === 3 || c === -32000 || c === -32603;
/** Revert data that says so by itself: Solidity's Error(string) or Panic(uint256). (Any other hex may be a contract's own error,
 *  or may be anything at all: it counts only next to a node's "execution reverted".) */
export const hasRevertData = (d: unknown): boolean => /^0x(?:08c379a0|4e487b71)/.test(attached(d));

/** A wallet's provider that wraps its node's answer puts it under `data` (or `data.originalError`, `data.cause`): {code: -32603,
 *  message: 'Internal JSON-RPC error.', data: {code: 3, message: 'execution reverted', data: '0x…'}}. That inner answer is the node's
 *  own, so its code 3 or its "execution reverted" (under a code a revert comes with) counts, whatever hex is beside it (none, or a
 *  contract's own 4-byte error). */
function saysRevert(d: unknown, depth = 0): boolean {
  if (!d || typeof d !== 'object' || depth > 3) return false;
  const o = d as { code?: unknown; message?: unknown; data?: unknown; originalError?: unknown; cause?: unknown };
  if (o.code === 3 || (revertCode(o.code) && typeof o.message === 'string' && REVERT_WORDS.test(o.message.trim()))) return true;
  return saysRevert(o.data, depth + 1) || saysRevert(o.originalError, depth + 1) || saysRevert(o.cause, depth + 1);
}

/**
 * Whether a call really reverted, on the chain's own terms. One rule (the same as the SDK's own):
 *   - code 3 anywhere in the error, or in the node's answer a wallet's provider wrapped (under `data`, `data.originalError`, `data.cause`);
 *   - a message that OPENS with "execution reverted" (any letter case), as the node's own answer or the wrapped one, under code 3,
 *     -32000, -32603 or no code;
 *   - Solidity's own revert data, Error(string) or Panic(uint256), wherever it is attached;
 *   - nothing returned where a value was due.
 * Anything else is not a revert: a node that could not be reached, a limit (whatever its message quotes), an internal error whose
 * message is not the node's "execution reverted", an EVM failure in other words (out of gas), some other hex attached.
 */
export function realRevert(e: unknown): boolean {
  for (const x of links(e)) if (x.code === 3 || hasRevertData(x.data) || saysRevert(x.data) || x.name === 'ContractFunctionZeroDataError') return true;
  // in words: only the node's or wallet's own answer counts (the library's wrappers say "reverted" for any failure, and repeat the
  // call's arguments), only when the words open it, and only under a code a revert comes with
  const a = answer(e);
  if (typeof a === 'string') return REVERT_WORDS.test(a.trim());
  if (!a || typeof a !== 'object' || notAWalletsWords(a) || !revertCode((a as Link).code)) return false;
  return [(a as Link).message, (a as Link).details].some((t) => typeof t === 'string' && REVERT_WORDS.test(t.trim()));
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
/** A connection the page found gone AFTER the wallet had been asked (lib/wc.ts): the page's own error, but not proof of anything */
const LOST_AFTER_ASKING = new WeakSet<object>();
export const markLostAfterAsking = (e: object): void => { LOST_AFTER_ASKING.add(e); };
const lostAfterAsking = (e: unknown): boolean => { for (const x of links(e)) if (LOST_AFTER_ASKING.has(x)) return true; return false; };

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
export function sendUnconfirmed(e: unknown): { words: string; lost?: true } | null {
  // the wallet was asked and its connection ended before it answered: nothing is known of what it did
  if (lostAfterAsking(e)) return { words: '', lost: true };
  if (!fromSendStep(e) || stoppedBeforeAsking(e) || userRejected(e) || realRevert(e)) return null;
  return { words: tidy(saidBy(e)) };
}

const MAY_BE_OUT = 'It may still have gone out: check your wallet’s activity before trying again.';

/** The sentence for a send the wallet did not confirm; null for anything else */
export function walletSendFailure(e: unknown): string | null {
  const o = sendUnconfirmed(e);
  if (!o) return null;
  if (o.lost) return `Your wallet’s connection ended before it confirmed this, so you’re disconnected. ${MAY_BE_OUT} Then connect again.`;
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
  if (o?.lost) return `${went}, but your wallet’s connection ended before it confirmed the ${thing}, so you’re disconnected. The ${thing} may still have gone out: check your wallet’s activity before pressing ${button} again.`;
  if (o) return `${went}, but your wallet didn’t confirm the ${thing}.${o.words ? ` It said: “${o.words}”.` : ''} The ${thing} may still have gone out: check your wallet’s activity before pressing ${button} again.`;
  const x = inner as { shortMessage?: unknown; message?: unknown } | null;
  const m = typeof inner === 'string' ? inner : x && typeof x === 'object' ? (typeof x.shortMessage === 'string' ? x.shortMessage : typeof x.message === 'string' ? x.message : '') : '';
  const said = tidy(firstWords(m), 200);
  return `${went}, but the ${thing} did not${said ? `: “${said}”` : ''}. Press ${button} again.`;
}

/** What the trade panel says when a sale could not use a signed permit and asks for an exact approval instead (two confirmations) */
export const PERMIT_UNSIGNED_NOTE = 'Your wallet couldn’t sign the permit, so it is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
export const PERMIT_REFUSED_NOTE = 'This token doesn’t take a permit, so your wallet is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';

/**
 * The launch dialog's main button. While a send the wallet did not confirm is unsettled for this wallet (`unsure`), it sends
 * nothing and says to check the wallet first, whatever else is going on (a launch taking another's place too): only a separate,
 * deliberate "It isn't in my wallet" press brings the ordinary label back.
 */
export function createLabel(o: { replacing: boolean; unsure: boolean; failed: boolean }): string {
  if (o.unsure) return 'Check your wallet first';
  if (o.replacing) return 'Create it in its place';
  return o.failed ? 'Try again' : 'Create token';
}

/** How long the launch button stays off after "It isn't in my wallet" is pressed: a double press, or a held key, sends nothing */
export const AFTER_CHECK_MS = 1500;

/**
 * Whether the approval asked for in this press is on the chain, when the press then failed with `error`. `reachedNext`: the next
 * step (the transfer) had begun, which only happens once the approval is mined. Before that, an error that is the approval's own
 * (the wallet's answer to it, a refusal, a transaction sent and unread, or replaced) says nothing certain about it, so the answer
 * is no: the error is shown as the approval's. Otherwise something else failed after the approval was asked for, and the allowance
 * itself is read (`read`, given a short time): the approval is in if it covers `needed`.
 */
export async function approvalIsIn(o: { asked: boolean; reachedNext: boolean; error: unknown; read: () => Promise<unknown>; needed: bigint; timeoutMs?: number }): Promise<boolean> {
  if (!o.asked) return false;
  if (o.reachedNext) return true;
  const name = (o.error as Link | null)?.name;
  if (fromSendStep(o.error) || userRejected(o.error) || name === 'SentButUnconfirmedError' || name === 'TransactionReplacedError') return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const got = await Promise.race([o.read(), new Promise<null>((r) => { timer = setTimeout(() => r(null), o.timeoutMs ?? 4000); })]);
    return typeof got === 'bigint' && got >= o.needed;
  } catch {
    return false; // not readable now: the error is shown as it is
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
