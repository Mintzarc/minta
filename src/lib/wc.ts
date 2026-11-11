// WalletConnect: a second way to connect a wallet, next to the wallets a browser announces. It exists for the Android app (Chrome in
// full screen, where no wallet app can inject itself): the person taps Connect, opens their wallet app (or scans the code with it),
// approves, and every transaction is then signed in the wallet app.
//
// The library (@walletconnect/universal-provider, an EIP-1193 provider; not its ethereum-provider package, which pulls in the
// Reown AppKit modal) is loaded when someone taps WalletConnect (and on a later visit while a saved connection exists). MINTA draws its own connect sheet. The library is started with
// its telemetry off. The page talks to the relay (wss://relay.walletconnect.org), and the library opens WalletConnect's verification
// frame at each connect or sign request; the wallet app may talk to others.
// The connection is for VYRE's chain only.
import type { EIP1193Provider } from 'viem';
import { VYRE_CHAIN } from './chain';
import { markOwn } from './walletError';
import { SITE_URL } from './twa';
import {
  WC_EVENTS, WC_OPTIONAL_METHODS, WC_RELAY_TIMEOUT_MS, WC_RELAY_URL, WC_REQUIRED_METHODS,
  classifyWcError, sessionHasAccount, wcLiveCheck, wcMessage, wcProjectId,
  type WcFailure,
} from './wcstate';

/** An EIP-1193 provider with events, as the WalletConnect provider is. `session` is the library's record of the connection (it has the end time). */
export interface WcProvider extends EIP1193Provider {
  on(event: string, fn: (x: unknown) => void): unknown;
  removeListener(event: string, fn: (x: unknown) => void): unknown;
  session?: { topic?: string; pairingTopic?: string; expiry?: number; namespaces?: Record<string, { accounts?: string[] }> };
  disconnect?: () => Promise<void>;
}

/** What starts and restores a connection. The real one is below; tests give a stand-in (setWcDriver). */
export interface WcDriver {
  /** Asks for a connection; `onUri` gets the pairing address to show; resolves with the provider once the wallet approves */
  start(o: { onUri: (uri: string) => void; signal: AbortSignal }): Promise<WcProvider>;
  /** The provider of a connection saved on this device, or null (nothing saved, ended, expired or not on VYRE) */
  restore(): Promise<WcProvider | null>;
}

export class WcError extends Error {
  // (registered as the page's own refusal: lib/walletError.ts shows only these in their own words, never an object that borrows the name)
  constructor(public why: WcFailure, message?: string) { super(message ?? wcMessage(why)); this.name = 'WcError'; markOwn(this); }
}

const PROJECT_ID = wcProjectId(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID);
const CHAIN_ID = VYRE_CHAIN.id;
const CAIP = `eip155:${CHAIN_ID}`;

const withTimeout = <T,>(p: Promise<T>, ms: number, why: WcFailure): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new WcError(why)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

type Universal = {
  init(o: Record<string, unknown>): Promise<WcProvider & {
    connect(o: Record<string, unknown>): Promise<unknown>;
    namespaces?: Record<string, unknown>;
    cleanupPendingPairings(): Promise<void>;
    abortPairingAttempt(): void;
    client?: {
      disconnect(o: { topic: string; reason: { code: number; message: string } }): Promise<void>;
      session?: { getAll?: () => { topic: string; pairingTopic?: string }[] };
    };
  }>;
};

let loaded: ReturnType<Universal['init']> | null = null;
/** The library, started once per page (a failed start is forgotten so the next tap tries again) */
function library() {
  if (!loaded) {
    loaded = (async () => {
      const mod = (await import('@walletconnect/universal-provider')) as unknown as { default: Universal };
      return mod.default.init({
        projectId: PROJECT_ID,
        relayUrl: WC_RELAY_URL,
        logger: 'error',
        telemetryEnabled: false,
        metadata: { name: 'MINTA', description: 'Launch, trade and explore tokens on VYRE', url: window.location.origin, icons: [`${SITE_URL}/icon-192.png`] },
      });
    })();
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}

const namespaceOf = (methods: readonly string[]) => ({
  chains: [CAIP], methods: [...methods], events: [...WC_EVENTS], rpcMap: { [CHAIN_ID]: VYRE_CHAIN.rpcUrls.default.http[0] },
});

/** The accounts the saved/new session lists on VYRE's chain: null when it lists none (so it's refused) */
function vyreAccount(p: WcProvider): string | null {
  const s = p.session;
  return sessionHasAccount(s?.namespaces?.eip155?.accounts, CHAIN_ID, s?.expiry, Date.now());
}

/** The pairing's own address (its topic) in a `wc:` pairing link, which names one attempt among any others */
const pairingOf = (uri: string): string | null => /^wc:([0-9a-f]{64})@/i.exec(uri)?.[1]?.toLowerCase() ?? null;

type Lib = Awaited<ReturnType<typeof library>>;
type Session = NonNullable<WcProvider['session']>;
const USER_DISCONNECTED = { code: 6000, message: 'User disconnected.' };

/** The session MINTA last handed on as the connected one (so it can be put back if a late approval overwrites the library's pointer) */
let liveSession: Session | null = null;

/** Ends one session by its topic, and never calls the library's own disconnect(): that clears the library's current session and
 *  deletes every pairing, which would take down a connection or pairing that is still wanted. If the library's pointer was left on
 *  the ended session, it is put back on the live one (when it still exists) or cleared. */
async function endTopic(p: Lib, topic: string | undefined): Promise<void> {
  if (!topic) return;
  try { await p.client?.disconnect({ topic, reason: USER_DISCONNECTED }); } catch { /* already gone */ }
  if (p.session?.topic === topic) {
    const alive = liveSession && liveSession.topic !== topic && p.client?.session?.getAll?.().some((x) => x.topic === liveSession!.topic);
    p.session = alive ? liveSession! : undefined;
  }
}

/** Ends the session that came from one pairing attempt: the one whose pairing is this attempt's, never "whatever the library holds" */
async function endAttempt(p: Lib, pairing: string | null): Promise<void> {
  const mine = pairing ? p.client?.session?.getAll?.().find((x) => x.pairingTopic?.toLowerCase() === pairing) : undefined;
  // not listed (a stand-in or an older library): the session the library holds, when it carries this pairing or none
  const held = p.session && (!p.session.pairingTopic || p.session.pairingTopic.toLowerCase() === pairing) ? p.session.topic : undefined;
  await endTopic(p, mine?.topic ?? held);
}

/** One pairing with the library, shared by every start() made while it waits: the library has one connect() in flight at a time
 *  (its `display_uri` and `session` are shared, and it cannot cancel one: abortPairingAttempt does nothing in 2.26), so a person who
 *  cancels and taps again is shown the same code and the same approval, never a second pairing that could be mixed up with the first. */
interface Waiter { onUri: (uri: string) => void; signal: AbortSignal; resolve: (p: WcProvider) => void; reject: (e: unknown) => void }
interface Inflight { waiters: Set<Waiter>; uri: string | null; pairing: string | null }
let inflight: Inflight | null = null;

function begin(p: Lib): Inflight {
  const f: Inflight = { waiters: new Set(), uri: null, pairing: null };
  // only the first address this connect() shows is its own; a waiter that was cancelled is not shown anything
  const show = (u: unknown) => {
    if (typeof u !== 'string' || f.uri !== null) return;
    f.uri = u; f.pairing = pairingOf(u);
    for (const w of f.waiters) if (!w.signal.aborted) w.onUri(u);
  };
  p.on('display_uri', show);
  const fail = (e: unknown) => { for (const w of f.waiters) w.reject(e); };
  void (async () => {
    try {
      // VYRE is the chain asked for. (Read from the library, v2.26: it folds "required" namespaces into the optional ones before
      // sending, "requiredNamespaces are deprecated", so a wallet may approve without VYRE. That is why a session that doesn't
      // list an account on VYRE is refused below, and again before every signature.)
      await p.connect({ optionalNamespaces: { eip155: namespaceOf([...WC_REQUIRED_METHODS, ...WC_OPTIONAL_METHODS]) } });
    } catch (e) {
      if (inflight === f) inflight = null;
      p.removeListener('display_uri', show);
      fail(new WcError(classifyWcError(e)));
      return;
    }
    if (inflight === f) inflight = null;
    p.removeListener('display_uri', show);
    // the person who is still waiting (the latest one that has not cancelled); nobody: it was approved after cancelling, so end it at once
    const waiting = [...f.waiters].filter((w) => !w.signal.aborted).pop();
    if (!waiting) { await endAttempt(p, f.pairing); fail(new WcError('other')); return; }
    // the library's current session must be this attempt's (a replaced one is ended by its own topic and refused)
    const got = p.session;
    if (f.pairing && got?.pairingTopic !== undefined && got.pairingTopic.toLowerCase() !== f.pairing) {
      await endAttempt(p, f.pairing);
      await endTopic(p, got.topic);
      fail(new WcError('other')); return;
    }
    // whatever the wallet agreed to, it must list an account on VYRE: if not, end it
    if (!vyreAccount(p)) { await endAttempt(p, f.pairing); fail(new WcError('chain')); return; }
    liveSession = p.session ?? null;
    for (const w of f.waiters) { if (w === waiting) w.resolve(p); else w.reject(new WcError('other')); }
  })();
  return f;
}

const realDriver: WcDriver = {
  async start({ onUri, signal }) {
    let p: Lib;
    try { p = await withTimeout(library(), WC_RELAY_TIMEOUT_MS, 'relay'); } catch (e) { throw e instanceof WcError ? e : new WcError(classifyWcError(e)); }
    if (signal.aborted) throw new WcError('other');
    return new Promise<WcProvider>((resolve, reject) => {
      const w: Waiter = { onUri, signal, resolve, reject };
      const f = inflight ?? (inflight = begin(p));
      f.waiters.add(w);
      // cancelling answers this start at once; the pairing itself carries on and is ended if it is approved later
      signal.addEventListener('abort', () => reject(new WcError('other')), { once: true });
      if (f.uri) onUri(f.uri); // resuming a pairing already shown: the same code
    });
  },
  async restore() {
    // nothing saved: don't even load the library or ask the relay
    if (!savedMark()) return null;
    let p: Awaited<ReturnType<typeof library>>;
    try { p = await withTimeout(library(), WC_RELAY_TIMEOUT_MS, 'relay'); } catch { return null; }
    if (!vyreAccount(p)) { await p.disconnect?.().catch(() => {}); return null; }
    liveSession = p.session ?? null;
    return p;
  },
};

let driver: WcDriver = realDriver;
/** For tests: replaces what starts and restores a connection (a stand-in wallet provider) */
export function setWcDriver(d: WcDriver | null): void { driver = d ?? realDriver; }
export const wcDriver = (): WcDriver => driver;

// A note that a WalletConnect connection was made here, so a reload asks the library to restore it (and a visitor who never used
// WalletConnect never loads it). The session itself is the library's, kept in this browser until the person disconnects.
const MARK = `minta.wc:${CHAIN_ID}`;
export function savedMark(): boolean { try { return localStorage.getItem(MARK) === '1'; } catch { return false; } }
export function setSavedMark(on: boolean): void { try { if (on) localStorage.setItem(MARK, '1'); else localStorage.removeItem(MARK); } catch { /* private mode */ } }

/** The only requests that ask the wallet to sign: both are bound to the connected account. Every other method is refused. */
const SIGNS: ReadonlySet<string> = new Set(['eth_sendTransaction', 'eth_signTypedData_v4']);
/** The few plain reads the app makes through this connection (answered by the library from the session) */
const READS: ReadonlySet<string> = new Set(['eth_chainId', 'eth_accounts', 'eth_requestAccounts']);
const SWITCHES: ReadonlySet<string> = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
/** How long a wallet's refusal of a send is kept for the library's follow-up ask (it comes at once) */
const REFUSED_SEND_MS = 5000;
const LOST = /no matching key|session topic doesn.?t exist|missing or invalid\. (?:request|session)|session (?:not found|deleted)|pairing .*(?:not found|expired)/i;

/** The address a signing request names, or null when it names none / can’t be read */
function signingAccount(method: string, params: unknown): string | null {
  if (!Array.isArray(params)) return null;
  if (method === 'eth_sendTransaction') {
    const from = (params[0] as { from?: unknown } | undefined)?.from;
    return typeof from === 'string' ? from : null;
  }
  if (method === 'eth_signTypedData_v4') return typeof params[0] === 'string' ? params[0] : null;
  return null;
}

/** A chain id as a wallet or a typed-data domain may write it (a number, a decimal string or 0x hex), or null when it can't be read */
function chainNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v === 'string' && /^(0x[0-9a-fA-F]{1,16}|[0-9]{1,16})$/.test(v)) return Number(v);
  return null;
}

/** True unless the request names another chain: a transaction's chainId (when it has one) and a typed-data domain's chainId (which must be there) are VYRE's */
function onVyre(method: string, params: unknown): boolean {
  if (!Array.isArray(params)) return false;
  if (method === 'eth_sendTransaction') {
    const tx = params[0] as { chainId?: unknown } | undefined;
    return !tx || typeof tx !== 'object' || tx.chainId === undefined || chainNumber(tx.chainId) === CHAIN_ID;
  }
  if (method === 'eth_signTypedData_v4') {
    let doc: unknown = params[1];
    if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch { return false; } }
    const d = doc as { domain?: { chainId?: unknown }; types?: { EIP712Domain?: unknown } } | null;
    const domain = d?.domain;
    if (!domain || typeof domain !== 'object' || chainNumber(domain.chainId) !== CHAIN_ID) return false;
    // the wallet hashes the domain by its declared fields: a chainId that EIP712Domain does not list would be ignored when signing
    const fields = d?.types?.EIP712Domain;
    return Array.isArray(fields) && fields.some((f) => (f as { name?: unknown } | null)?.name === 'chainId');
  }
  return false;
}

/**
 * The provider the rest of the app uses for a WalletConnect connection. Every request that asks the wallet to sign is first checked:
 * the connection is on VYRE's chain, still lists the account the app shows, hasn't expired, and the request is for that account
 * and on VYRE's chain (a transaction naming another chainId, or typed data whose domain isn't VYRE's, is refused), and it is read
 * once before it is checked. Only a transaction or a typed-data signature may be asked; any other signing method is refused.
 * A request to move the wallet to another chain is refused (this connection is VYRE's only). `onLost` hears when the
 * connection is found gone.
 */
export function guardWc(raw: WcProvider, account: string, onLostRaw: (why: WcFailure) => void): WcProvider {
  // this guard belongs to the session that was current when it was built: a later session's end is not its to report, and it signs for no other
  const topic = raw.session?.topic;
  const sameSession = () => { const now = raw.session?.topic; return topic === undefined || now === undefined || now === topic; };
  const onLost = (why: WcFailure) => { if (sameSession()) onLostRaw(why); };
  const live = async () => {
    if (!sameSession()) throw new WcError('other', 'This connection was replaced by another one, so nothing was sent. Disconnect and connect again.');
    const [chainId, accounts] = await Promise.all([raw.request({ method: 'eth_chainId' }).catch(() => null), raw.request({ method: 'eth_accounts' }).catch(() => null)]);
    const r = wcLiveCheck({ wantChain: CHAIN_ID, chainId, account, accounts, expiry: raw.session?.expiry, now: Date.now() });
    if (!r.ok) { if (r.why === 'expired') onLost('expired'); throw new WcError(r.why, r.message); }
    // eth_accounts and the session must name the same VYRE account (a lying provider must not show one address and sign as another)
    const onSession = sessionHasAccount(raw.session?.namespaces?.eip155?.accounts, CHAIN_ID, raw.session?.expiry, Date.now());
    if (!onSession || onSession.toLowerCase() !== account.toLowerCase()) {
      throw new WcError('other', 'The account in your wallet changed, so nothing was sent. Disconnect and connect again.');
    }
  };
  let refusedSend: { error: unknown; at: number; key: string } | null = null;
  const request = async (given: { method: string; params?: unknown }) => {
    // read the request once: what is checked is exactly what is sent (a getter that answers differently the second time changes nothing)
    let args: { method: string; params?: unknown };
    try {
      const method = given?.method;
      const params = given?.params;
      args = JSON.parse(JSON.stringify({ method, params })) as { method: string; params?: unknown };
    } catch { throw new WcError('other', 'That kind of request isn’t used here, so nothing was sent.'); }
    if (args && SWITCHES.has(args.method)) {
      const want = (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId;
      if (typeof want === 'string' && Number(want) === CHAIN_ID) return null; // already on it, by construction
      throw new WcError('chain', `This connection works on ${VYRE_CHAIN.name} only. To use another network, use your wallet app directly.`);
    }
    if (!args || typeof args.method !== 'string') throw new WcError('other', 'That kind of request isn’t used here, so nothing was sent.');
    if (READS.has(args.method)) return raw.request(args as Parameters<EIP1193Provider['request']>[0]);
    // The wallet library asks again as `wallet_sendTransaction` when a wallet turns `eth_sendTransaction` down with certain codes.
    // That second ask never reaches the wallet (it is not on the list below), and its answer is the wallet's own first answer, so
    // the page shows what the wallet said (not enough funds for gas, say) and not this guard's words.
    // Only for the very same transaction (the same checked parameters), within a few seconds, and only once.
    if (args.method === 'wallet_sendTransaction' && refusedSend) {
      const was = refusedSend;
      refusedSend = null;
      if (Date.now() - was.at < REFUSED_SEND_MS && was.key === JSON.stringify(args.params ?? null)) throw was.error;
    }
    // an allow-list: anything that is not a read above or a bound signing request below never reaches the wallet
    if (!SIGNS.has(args.method)) throw new WcError('other', 'That kind of request isn’t used here, so nothing was sent.');
    await live();
    const who = signingAccount(args.method, args.params);
    if (typeof who !== 'string' || who.toLowerCase() !== account.toLowerCase()) {
      const kind = args.method === 'eth_sendTransaction' ? 'transaction' : 'signature';
      throw new WcError('other', `That ${kind} isn’t from the account you connected, so nothing was sent.`);
    }
    if (!onVyre(args.method, args.params)) {
      throw new WcError('chain', `That request is for another network. This connection works on ${VYRE_CHAIN.name} only, so nothing was sent.`);
    }
    try {
      const answer = await (raw.request as (a: unknown, chain?: string) => Promise<unknown>)(args, CAIP);
      if (args.method === 'eth_sendTransaction') refusedSend = null; // a send that went through: nothing of an earlier refusal is kept
      return answer;
    } catch (thrown) {
      // (a wallet may reject with a bare string or with nothing: made an error the wallet library can read, with those words or none)
      const e: unknown = thrown && typeof thrown === 'object' ? thrown : new Error(typeof thrown === 'string' ? thrown : '');
      const text = `${(e as { message?: string })?.message ?? ''}`;
      if (LOST.test(text)) { onLost('closed'); throw new WcError('closed'); }
      // remembered for the library's one follow-up (see above): a refused send only, never a signature
      refusedSend = args.method === 'eth_sendTransaction' ? { error: e, at: Date.now(), key: JSON.stringify(args.params ?? null) } : refusedSend;
      throw e;
    }
  };
  return new Proxy({} as WcProvider, {
    get(_shell, prop) {
      if (prop === 'request') return request;
      if (prop === 'isMintaWalletConnect') return true;
      if (prop === 'mintaAssertLive') return live;
      const v = Reflect.get(raw, prop, raw) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(raw) : v;
    },
    has: (_shell, prop) => prop === 'isMintaWalletConnect' || prop in raw,
  });
}

/** Runs the signing check now (before a transaction is even built): throws a WcError in plain words unless the connection may sign */
export const assertWcLive = (p: unknown): Promise<void> => (p as { mintaAssertLive: () => Promise<void> }).mintaAssertLive();

/** True for a provider made by guardWc (a connection that works on VYRE only) */
export const isWcProvider = (p: unknown): boolean => !!p && (p as { isMintaWalletConnect?: boolean }).isMintaWalletConnect === true;
