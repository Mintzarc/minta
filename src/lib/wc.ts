// WalletConnect: a second way to connect a wallet, next to the wallets a browser announces. It exists for the Android app (Chrome in
// full screen, where no wallet app can inject itself): the person taps Connect, opens their wallet app (or scans the code with it),
// approves, and every transaction is then signed in the wallet app.
//
// The library (@walletconnect/universal-provider, an EIP-1193 provider; not its ethereum-provider package, which pulls in the
// Reown AppKit modal) is loaded only when someone taps WalletConnect. MINTA draws its own connect sheet. The library is started with
// its telemetry off. The one server it talks to is the relay (wss://relay.walletconnect.org); the wallet app may talk to others.
// The connection is for VYRE's chain only.
import type { EIP1193Provider } from 'viem';
import { VYRE_CHAIN } from './chain';
import { SITE_URL } from './twa';
import {
  WC_EVENTS, WC_OPTIONAL_METHODS, WC_RELAY_TIMEOUT_MS, WC_RELAY_URL, WC_REQUIRED_METHODS, classifyWcError, sessionHasAccount, wcLiveCheck, wcMessage, wcProjectId,
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

const SIGNS: ReadonlySet<string> = new Set(['eth_sendTransaction', 'wallet_sendTransaction', 'eth_signTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4']);
const SWITCHES: ReadonlySet<string> = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
const LOST = /no matching key|session topic doesn.?t exist|missing or invalid\. (?:request|session)|session (?:not found|deleted)|pairing .*(?:not found|expired)/i;

/**
 * The provider the rest of the app uses for a WalletConnect connection. Every request that asks the wallet to sign is first checked:
 * the connection is on VYRE's chain, still lists the account the app shows, hasn't expired, and a transaction is from that account.
 * A request to move the wallet to another chain is refused (this connection is VYRE's only). `onLost` hears when the connection is found gone.
 */
export function guardWc(raw: WcProvider, account: string, onLost: (why: WcFailure) => void): WcProvider {
  const live = async () => {
    const [chainId, accounts] = await Promise.all([raw.request({ method: 'eth_chainId' }).catch(() => null), raw.request({ method: 'eth_accounts' }).catch(() => null)]);
    const r = wcLiveCheck({ wantChain: CHAIN_ID, chainId, account, accounts, expiry: raw.session?.expiry, now: Date.now() });
    if (!r.ok) { if (r.why === 'expired') onLost('expired'); throw new WcError(r.why, r.message); }
  };
  const request = async (args: { method: string; params?: unknown }) => {
    if (args && SWITCHES.has(args.method)) {
      const want = (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId;
      if (typeof want === 'string' && Number(want) === CHAIN_ID) return null; // already on it, by construction
      throw new WcError('chain', `This connection works on ${VYRE_CHAIN.name} only. To use another network, use your wallet app directly.`);
    }
    if (!args || !SIGNS.has(args.method)) return raw.request(args as Parameters<EIP1193Provider['request']>[0]);
    await live();
    if (args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction') {
      const from = (args.params as { from?: unknown }[] | undefined)?.[0]?.from;
      if (typeof from !== 'string' || from.toLowerCase() !== account.toLowerCase()) throw new WcError('other', 'That transaction isn’t from the account you connected, so nothing was sent.');
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
