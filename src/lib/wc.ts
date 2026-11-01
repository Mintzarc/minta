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
  session?: { expiry?: number; namespaces?: Record<string, { accounts?: string[] }> };
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
  constructor(public why: WcFailure, message?: string) { super(message ?? wcMessage(why)); this.name = 'WcError'; }
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

const realDriver: WcDriver = {
  async start({ onUri, signal }) {
    let p: Awaited<ReturnType<typeof library>>;
    try { p = await withTimeout(library(), WC_RELAY_TIMEOUT_MS, 'relay'); } catch (e) { throw e instanceof WcError ? e : new WcError(classifyWcError(e)); }
    if (signal.aborted) throw new WcError('other');
    const show = (u: unknown) => { if (typeof u === 'string') onUri(u); };
    p.on('display_uri', show);
    const gone = () => { try { p.abortPairingAttempt(); } catch { /* nothing to stop */ } };
    signal.addEventListener('abort', gone, { once: true });
    try {
      // VYRE is the chain asked for. (Read from the library, v2.26: it folds "required" namespaces into the optional ones before
      // sending, "requiredNamespaces are deprecated", so a wallet may approve without VYRE. That is why a session that doesn't
      // list an account on VYRE is refused below, and again before every signature.)
      await p.connect({ optionalNamespaces: { eip155: namespaceOf([...WC_REQUIRED_METHODS, ...WC_OPTIONAL_METHODS]) } });
    } catch (e) {
      throw new WcError(classifyWcError(e));
    } finally {
      p.removeListener('display_uri', show);
      signal.removeEventListener('abort', gone);
    }
    // approved after the person cancelled: end that connection at once
    if (signal.aborted) { await p.disconnect?.().catch(() => {}); throw new WcError('other'); }
    // whatever the wallet agreed to, it must list an account on VYRE: if not, end it
    if (!vyreAccount(p)) { await p.disconnect?.().catch(() => {}); throw new WcError('chain'); }
    return p;
  },
  async restore() {
    // nothing saved: don't even load the library or ask the relay
    if (!savedMark()) return null;
    let p: Awaited<ReturnType<typeof library>>;
    try { p = await withTimeout(library(), WC_RELAY_TIMEOUT_MS, 'relay'); } catch { return null; }
    if (!vyreAccount(p)) { await p.disconnect?.().catch(() => {}); return null; }
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
    const domain = (doc as { domain?: { chainId?: unknown } } | null)?.domain;
    return !!domain && typeof domain === 'object' && chainNumber(domain.chainId) === CHAIN_ID;
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
export function guardWc(raw: WcProvider, account: string, onLost: (why: WcFailure) => void): WcProvider {
  const live = async () => {
    const [chainId, accounts] = await Promise.all([raw.request({ method: 'eth_chainId' }).catch(() => null), raw.request({ method: 'eth_accounts' }).catch(() => null)]);
    const r = wcLiveCheck({ wantChain: CHAIN_ID, chainId, account, accounts, expiry: raw.session?.expiry, now: Date.now() });
    if (!r.ok) { if (r.why === 'expired') onLost('expired'); throw new WcError(r.why, r.message); }
    // eth_accounts and the session must name the same VYRE account (a lying provider must not show one address and sign as another)
    const onSession = sessionHasAccount(raw.session?.namespaces?.eip155?.accounts, CHAIN_ID, raw.session?.expiry, Date.now());
    if (!onSession || onSession.toLowerCase() !== account.toLowerCase()) {
      throw new WcError('other', 'The account in your wallet changed, so nothing was sent. Disconnect and connect again.');
    }
  };
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
      return await (raw.request as (a: unknown, chain?: string) => Promise<unknown>)(args, CAIP);
    } catch (e) {
      const text = `${(e as { message?: string })?.message ?? ''}`;
      if (LOST.test(text)) { onLost('closed'); throw new WcError('closed'); }
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
