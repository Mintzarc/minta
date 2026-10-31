// WalletConnect, the parts that need no library: the settings, the connection's states, the guards that run before anything is
// signed, the plain-words messages, and the one wallet deep link whose form is documented (Trust Wallet's).
// Pure: no app imports, so node unit tests can call it. The library itself is only touched in wc.ts.

/** MINTA's WalletConnect project ID. It is public (it ships in every page that uses WalletConnect, and is tied to the domain
 * allowed in the WalletConnect dashboard: minta.vyrechain.com), so it is a setting and not a secret. */
export const WC_PROJECT_ID_DEFAULT = '89d7a1882c0fa9a5bbe0a58accafc100';
/** The WalletConnect relay: the only server the connection talks to while it is open (a secure WebSocket) */
export const WC_RELAY_HOST = 'relay.walletconnect.org';
export const WC_RELAY_URL = `wss://${WC_RELAY_HOST}`;
/** Where a wallet that doesn't know VYRE is told how to add it */
export const ADD_TO_WALLET_URL = 'https://vyrechain.com/add/';
/** What the app asks the wallet to sign: sending a transaction is required; typed-data signing (the launch wizard's signature) is optional */
export const WC_REQUIRED_METHODS = ['eth_sendTransaction'] as const;
export const WC_OPTIONAL_METHODS = ['eth_signTypedData_v4', 'personal_sign'] as const;
export const WC_EVENTS = ['chainChanged', 'accountsChanged'] as const;
/** How long the app waits for the relay to answer before it says the relay can't be reached */
export const WC_RELAY_TIMEOUT_MS = 20_000;

/** The project ID a build uses: its setting when it is 32 hex characters, else the default. Anything else is ignored, never passed on. */
export function wcProjectId(setting: unknown): string {
  return typeof setting === 'string' && /^[0-9a-f]{32}$/.test(setting.trim()) ? setting.trim() : WC_PROJECT_ID_DEFAULT;
}

/** A WalletConnect v2 pairing address (EIP-1328: `wc:<64 hex topic>@2?…`). Only an address of this form is ever drawn as a QR code or put in a link. */
export function isWcUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.length <= 2000 && /^wc:[0-9a-f]{64}@2\?[A-Za-z0-9%=&._~:/,\-[\]]+$/.test(uri);
}

/** Trust Wallet's WalletConnect link, in the form its developer pages give: `https://link.trustwallet.com/wc?uri=<the URL-encoded wc: address>` (null if the address isn't one) */
export function trustWalletWcLink(uri: string): string | null {
  return isWcUri(uri) ? `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The connection's states
// ---------------------------------------------------------------------------------------------------------------

export type WcFailure = 'rejected' | 'relay' | 'timeout' | 'chain' | 'expired' | 'closed' | 'other';
export type WcState =
  | { kind: 'idle' }
  | { kind: 'starting' }                       // asking the relay for a pairing address
  | { kind: 'waiting'; uri: string }           // address shown; waiting for the wallet to approve
  | { kind: 'connected'; account: string }
  | { kind: 'failed'; why: WcFailure; message: string };

export type WcEvent =
  | { type: 'start' }
  | { type: 'uri'; uri: string }
  | { type: 'approved'; account: string }
  | { type: 'fail'; why: WcFailure; message?: string }
  | { type: 'cancel' }
  | { type: 'disconnect' };

/** The connection's next state. A second tap while one is under way changes nothing; a late answer after cancelling is dropped. */
export function wcNext(s: WcState, e: WcEvent): WcState {
  switch (e.type) {
    case 'start': return s.kind === 'idle' || s.kind === 'failed' ? { kind: 'starting' } : s;
    case 'uri': return s.kind === 'starting' && isWcUri(e.uri) ? { kind: 'waiting', uri: e.uri } : s;
    case 'approved': return s.kind === 'starting' || s.kind === 'waiting' ? { kind: 'connected', account: e.account } : s;
    case 'fail':
      // a failure only means something while a connection is being made or is up; "closed" and "expired" are for a connected one
      if (s.kind === 'idle') return s;
      return { kind: 'failed', why: e.why, message: e.message ?? wcMessage(e.why) };
    case 'cancel': return s.kind === 'idle' || s.kind === 'connected' ? s : { kind: 'idle' }; // closing a failure's message too; never ends a live connection
    case 'disconnect': return { kind: 'idle' };
  }
}

/** What to tell the person, in plain words, for each way a connection can fail or end */
export function wcMessage(why: WcFailure): string {
  switch (why) {
    case 'rejected': return 'Cancelled in your wallet. Nothing was sent.';
    case 'relay': return 'Couldn’t reach the WalletConnect service just now. Try again in a moment, or open minta.vyrechain.com in your wallet app’s own browser.';
    case 'timeout': return 'Your wallet didn’t answer in time. Open your wallet app and try again.';
    case 'chain': return `Your wallet can’t use VYRE yet. Add it (${ADD_TO_WALLET_URL}), then connect again.`;
    case 'expired': return 'Your wallet connection has expired, so you’re disconnected. Connect again.';
    case 'closed': return 'Your wallet ended the connection, so you’re disconnected. Connect again.';
    case 'other': return 'The wallet connection failed. Nothing was sent. Try again.';
  }
}

/** Shown when a connection saved on this device is found ended on the next visit */
export const WC_RESTORE_NOTE = 'Your earlier wallet connection has ended. Connect again to launch or trade.';

/** The ways an error from the library or a wallet reads, sorted into the failures above */
export function classifyWcError(e: unknown): WcFailure {
  const all: unknown[] = [];
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) all.push(x);
  const text = all.map((x) => (typeof x === 'string' ? x : `${(x as { message?: string })?.message ?? ''}`)).join(' ');
  const code = all.map((x) => (x as { code?: number })?.code);
  if (code.includes(4001) || code.includes(5000) || code.includes(5001) || /user rejected|rejected by user|user denied|user cancel/i.test(text)) return 'rejected';
  if (/not supported|unsupported chain|unrecognized chain|chain.*not (?:been )?added|non conforming namespaces|missing or invalid.*chain|4902|5100|5101|5102|5103/i.test(text) || code.includes(4902) || code.includes(5100) || code.includes(5101) || code.includes(5102)) return 'chain';
  if (/proposal expired|request expired|session expired|expired/i.test(text)) return 'expired';
  if (/timed? ?out|timeout/i.test(text)) return 'timeout';
  if (/socket|websocket|relay|network error|failed to fetch|connection (?:request )?(?:closed|reset|failed|error)|offline|ENOTFOUND/i.test(text)) return 'relay';
  return 'other';
}

// ---------------------------------------------------------------------------------------------------------------
// The check made before anything is signed
// ---------------------------------------------------------------------------------------------------------------

export interface LiveFacts {
  /** the chain the app needs (VYRE's) */
  wantChain: number;
  /** the chain the connection is on now, as the wallet's answer to eth_chainId (hex string or number) */
  chainId: unknown;
  /** the account the app thinks is connected, and the accounts the connection lists now */
  account: string;
  accounts: unknown;
  /** when the wallet session ends, in seconds since 1970 (omit if unknown), and now in milliseconds */
  expiry?: number;
  now: number;
}

const chainNumber = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' && /^(0x[0-9a-fA-F]{1,16}|[1-9][0-9]{0,15})$/.test(v) ? Number(v) : NaN;

/** Whether a signature may be asked for now: the connection is on the right chain, still lists the account the app shows, and hasn't expired. */
export function wcLiveCheck(f: LiveFacts): { ok: true } | { ok: false; why: WcFailure; message: string } {
  if (typeof f.expiry === 'number' && f.expiry * 1000 <= f.now) return { ok: false, why: 'expired', message: wcMessage('expired') };
  if (chainNumber(f.chainId) !== f.wantChain) return { ok: false, why: 'chain', message: `Your wallet isn’t on VYRE. Nothing was sent. Add VYRE to your wallet (${ADD_TO_WALLET_URL}), then connect again.` };
  const list = Array.isArray(f.accounts) ? f.accounts.filter((a): a is string => typeof a === 'string') : [];
  if (!list.length || list[0].toLowerCase() !== f.account.toLowerCase()) {
    return { ok: false, why: 'other', message: 'The account in your wallet changed, so nothing was sent. Disconnect and connect again.' };
  }
  return { ok: true };
}

/** The accounts and chains a session lists (`eip155:<chain>:<address>`), for a restored session: true only if it lists `account` on `chain` and hasn't expired */
export function sessionHasAccount(accounts: unknown, chain: number, expiry: number | undefined, now: number): string | null {
  if (typeof expiry !== 'number' || expiry * 1000 <= now) return null;
  if (!Array.isArray(accounts)) return null;
  for (const a of accounts) {
    const m = typeof a === 'string' ? /^eip155:(\d{1,16}):(0x[0-9a-fA-F]{40})$/.exec(a) : null;
    if (m && Number(m[1]) === chain) return m[2];
  }
  return null;
}
