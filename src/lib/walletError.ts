// What went wrong, in words, when a wallet or a contract turned something down. Kept apart from lib/chain.ts (which needs a
// browser) so it can be checked on its own. Nothing here talks to anything.
//
// The case that matters most: every write is simulated by the page first (the SDK's sendCall), and only then is the wallet asked to
// send it. If the wallet then answers with an error, the library that talks to it labels that "the contract function reverted with
// the following reason:" and puts the wallet's words on the next line. It was not a revert (the simulation had just passed): the
// wallet could not send it. So that is what the page says, with the wallet's own words.

type Link = { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; reason?: unknown; data?: unknown; docsPath?: unknown; cause?: unknown };

function* links(e: unknown): Generator<Link> {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 8; x = (x as Link).cause, i++) yield x as Link;
}

/** True when the person said no in their wallet: 4001 (a browser wallet), 5000 (WalletConnect), or the library's own name for it */
export function userRejected(e: unknown): boolean {
  for (const x of links(e)) if (x.code === 4001 || x.code === 5000 || x.name === 'UserRejectedRequestError') return true;
  return false;
}

const hasRevertData = (d: unknown): boolean =>
  (typeof d === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(d)) || (!!d && typeof d === 'object' && hasRevertData((d as { data?: unknown }).data));

/** True when a call really reverted on the chain's own terms: the node answered "execution reverted" (code 3) or gave revert data. A
 *  node that could not be reached, or answered with an internal error and nothing else, did not say the call reverts. */
export function realRevert(e: unknown): boolean {
  for (const x of links(e)) {
    if (x.code === 3 || hasRevertData(x.data)) return true;
    if (x.name === 'ContractFunctionZeroDataError') return true;
    if (typeof x.message === 'string' && /execution reverted/i.test(x.message) && x.name !== 'ContractFunctionExecutionError' && x.name !== 'ContractFunctionRevertedError') return true;
  }
  return false;
}

const oneLine = (t: string, max: number) => t.replace(/\s+/g, ' ').trim().replace(/[.:;,\s]+$/, '').slice(0, max);

/** The sentence for a send the wallet could not make after the page's own simulation passed; null for anything else. Told apart by
 *  where the error was made (the library's send step, not its simulation) and by there being no revert data in it. */
export function walletSendFailure(e: unknown): string | null {
  let fromSend = false;
  for (const x of links(e)) {
    if (x.docsPath === '/docs/contract/writeContract') fromSend = true;
    if (hasRevertData(x.data)) return null; // the wallet's own node says the call reverts, with the contract's data: that is a revert
  }
  if (!fromSend) return null;
  let words = '';
  for (const x of links(e)) {
    if (typeof x.details === 'string' && x.details.trim()) { words = x.details; break; }
  }
  if (!words) for (const x of links(e)) if (typeof x.reason === 'string' && x.reason.trim()) { words = x.reason; break; }
  if (!words) {
    let last: Link | null = null;
    for (const x of links(e)) last = x;
    const m = last && last !== e ? (typeof last.shortMessage === 'string' ? last.shortMessage : typeof last.message === 'string' ? last.message : '') : '';
    words = m.split('\n')[0] ?? '';
  }
  const said = oneLine(words, 160);
  return said ? `Your wallet couldn’t send this: ${said}. Nothing was sent.` : 'Your wallet couldn’t send this, and gave no reason. Nothing was sent.';
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

/** What the trade panel says when a sale could not use a signed permit and asks for an exact approval instead (two confirmations) */
export const PERMIT_UNSIGNED_NOTE = 'Your wallet couldn’t sign the permit, so it is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
export const PERMIT_REFUSED_NOTE = 'This token doesn’t take a permit, so your wallet is asking for an approval of exactly this amount first, then the sale. Confirm both in your wallet.';
