// The connected wallet, shared by every page: a Face ID wallet (a passkey's smart wallet, see faceid.ts), a browser
// wallet, or an email wallet (Circle's, see circle.ts). For a browser wallet the app asks for accounts only when the
// visitor clicks Connect, remembers which wallet they picked (not any key: wallets never hand those out), and follows
// account and network changes. An email wallet's session, or a Face ID wallet's passkey ID and public key (never a
// key that can sign: that stays in the device's secure chip), are kept on this device until sign-out.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { getAddress, isAddressEqual, type Address, type EIP1193Provider } from 'viem';
import { type WalletLike } from '@vyrechain/sdk';
import { NETWORK } from './network';
import { VYRE_CHAIN, onWalletsChanged, switchTo, walletOn, wallets, type WalletInfo } from './chain';
import { storeKey } from './storeKey';
import { WcError, assertWcLive, guardWc, isWcProvider, savedMark, setSavedMark, wcDriver, type WcProvider } from './wc';
import { WC_RESTORE_NOTE, classifyWcError, sessionHasAccount, wcLiveCheck, wcMessage, wcNext, type WcFailure, type WcState } from './wcstate';
import { FACEID_KEY, checkEarlier, createFaceId, faceIdSigner, forgetFaceId, loadFaceId, signInFaceId, type FaceIdSession } from './faceid';
import {
  EMAIL_TRADE_NOTE, WalletApiError, clearSession, loadSession, saveSession, signInWithEmail, walletConfig, walletsOf, withSession,
  type EmailSession, type WalletConfig,
} from './circle';

interface WalletState {
  account: Address | null;
  provider: EIP1193Provider | null;
  walletName: string | null;
  available: WalletInfo[];
  connect: (w: WalletInfo) => Promise<void>;
  disconnect: () => void;
  /**
   * What sends on VYRE for the connected account: a wallet client (after switching the wallet to VYRE), or a Face ID
   * wallet's bundler client. The SDK's functions take either. `inPlaceOf`: a Face ID operation meant to take an earlier
   * one's place in the wallet's sequence; refused (nothing sent) unless it's that wallet and that place is still open.
   */
  onVyre: (inPlaceOf?: { sender: Address; nonce: bigint }) => Promise<WalletLike>;
  /** Signed in with Face ID: the wallet's passkey and address (null otherwise) */
  faceId: FaceIdSession | null;
  /** Makes a new Face ID wallet (asks for Face ID) */
  createFaceIdWallet: () => Promise<void>;
  /**
   * Signs in with a Face ID wallet's passkey already on this device or synced to it; `confirmAgain` is awaited before a
   * second Face ID prompt (a wallet never used needs one)
   */
  signInWithFaceId: (confirmAgain?: () => Promise<void>) => Promise<void>;
  /** WalletConnect: the connection's state (the connect sheet shows it), a notice when a connection ended or its wallet moved, and the two buttons */
  wcState: WcState;
  wcNotice: string;
  connectWalletConnect: () => void;
  cancelWalletConnect: () => void;
  /** What to tell someone while their wallet asks them to confirm */
  confirmHint: string;
  /** Signed in with email: the session (null for a browser wallet or none) */
  email: EmailSession | null;
  /** Whether email sign-in is on (null while asking, or if VYRE's API can't be reached) */
  emailConfig: WalletConfig | null;
  signInEmail: (email: string, say: (t: string) => void) => Promise<void>;
  /** Runs a call with the email session, renewing it first if it has expired */
  withEmail: <T>(fn: (s: EmailSession) => Promise<T>) => Promise<T>;
}

const Ctx = createContext<WalletState | null>(null);
const REMEMBER = storeKey('vyre.wallet', VYRE_CHAIN.id);
// a wallet is remembered by its EIP-6963 rdns (io.metamask), never its name (any extension can call itself anything)
const rememberAs = (w: WalletInfo) => (w.rdns ? `rdns:${w.rdns}` : w.id);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<WalletInfo[]>(wallets());
  const [account, setAccount] = useState<Address | null>(null);
  const [current, setCurrent] = useState<WalletInfo | null>(null);
  const [email, setEmail] = useState<EmailSession | null>(loadSession);
  const [emailConfig, setEmailConfig] = useState<WalletConfig | null>(null);
  const [faceId, setFaceId] = useState<FaceIdSession | null>(loadFaceId);

  const [wcState, dispatchWc] = useReducer(wcNext, { kind: 'idle' } as WcState);
  const [wcNotice, setWcNotice] = useState('');
  const wcAbort = useRef<AbortController | null>(null);
  const wcRaw = useRef<WcProvider | null>(null);

  useEffect(() => onWalletsChanged(() => setAvailable(wallets())), []);
  // email sign-in is a testnet offer: on mainnet the sign-in service is never asked (nothing about the visit leaves for it)
  useEffect(() => { if (NETWORK.emailSignIn) walletConfig().then(setEmailConfig).catch(() => setEmailConfig(null)); }, []);

  const keepEmail = useCallback((s: EmailSession | null) => {
    setEmail(s);
    if (s) saveSession(s); else clearSession();
  }, []);

  // signing in or out with Face ID in another tab: this tab follows
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === FACEID_KEY || e.key === null) setFaceId(loadFaceId()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const keepFaceId = useCallback((f: FaceIdSession | null) => {
    setFaceId(f);
    if (!f) forgetFaceId();
  }, []);

  /** Ends a WalletConnect connection here (the wallet app is told, if it can be reached) */
  const dropWc = useCallback(() => {
    const raw = wcRaw.current;
    wcRaw.current = null;
    setSavedMark(false);
    raw?.disconnect?.().catch(() => {});
  }, []);
  /** A WalletConnect connection found ended (by the wallet, by time, or by a change of account): clear it and say so */
  const endWc = useCallback((why: WcFailure, message?: string) => {
    if (!wcRaw.current) return;
    dropWc();
    setCurrent(null);
    setAccount(null);
    dispatchWc({ type: 'disconnect' });
    setWcNotice(message ?? wcMessage(why));
  }, [dropWc]);

  const connect = useCallback(async (w: WalletInfo) => {
    const accounts = (await w.provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts?.[0]) throw new Error('The wallet gave no account.');
    dropWc();
    dispatchWc({ type: 'disconnect' });
    setWcNotice('');
    keepEmail(null);
    keepFaceId(null);
    setCurrent(w);
    setAccount(getAddress(accounts[0]));
    store.set(REMEMBER, rememberAs(w));
  }, [keepEmail, dropWc]);

  const disconnect = useCallback(() => {
    dropWc();
    dispatchWc({ type: 'disconnect' });
    setWcNotice('');
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepEmail(null);
    keepFaceId(null);
  }, [keepEmail, keepFaceId, dropWc]);

  const signInEmail = useCallback(async (address: string, say: (t: string) => void) => {
    const s = await signInWithEmail(address, say);
    dropWc();
    dispatchWc({ type: 'disconnect' });
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepFaceId(null);
    keepEmail(s);
  }, [keepEmail, keepFaceId, dropWc]);

  const adoptFaceId = useCallback((f: FaceIdSession) => {
    dropWc();
    dispatchWc({ type: 'disconnect' });
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepEmail(null);
    setFaceId(f);
  }, [keepEmail, dropWc]);
  const createFaceIdWallet = useCallback(async () => { adoptFaceId(await createFaceId()); }, [adoptFaceId]);
  const signInWithFaceId = useCallback(async (confirmAgain?: () => Promise<void>) => { adoptFaceId(await signInFaceId(confirmAgain)); }, [adoptFaceId]);

  const withEmail = useCallback(async <T,>(fn: (s: EmailSession) => Promise<T>): Promise<T> => {
    if (!email) throw new Error('Sign in with email first.');
    try {
      return await withSession(email, fn, keepEmail);
    } catch (e) {
      // the session can't be renewed: signed out
      if (e instanceof WalletApiError && e.status === 401) keepEmail(null);
      throw e;
    }
  }, [email, keepEmail]);


  // ---- WalletConnect (lib/wc.ts) ----
  /** Takes a WalletConnect provider that the wallet approved: checks it's on VYRE and lists an account, wraps it in the signing guard, and makes it the connected wallet */
  const adoptWc = useCallback(async (raw: WcProvider) => {
    const [chainId, accounts] = await Promise.all([raw.request({ method: 'eth_chainId' }), raw.request({ method: 'eth_accounts' })]);
    const first = Array.isArray(accounts) && typeof accounts[0] === 'string' ? (accounts[0] as string) : '';
    const live = first ? wcLiveCheck({ wantChain: VYRE_CHAIN.id, chainId, account: first, accounts, expiry: raw.session?.expiry, now: Date.now() }) : null;
    // the address eth_accounts shows must be the one the WalletConnect session lists on VYRE (not merely “some” account on VYRE)
    const onSession = first ? sessionHasAccount(raw.session?.namespaces?.eip155?.accounts, VYRE_CHAIN.id, raw.session?.expiry, Date.now()) : null;
    if (!first || !live || !live.ok || !onSession || onSession.toLowerCase() !== first.toLowerCase()) {
      await raw.disconnect?.().catch(() => {});
      const why = live && !live.ok ? live.why : (!onSession ? 'chain' : 'other');
      throw new WcError(why, live && !live.ok ? live.message : undefined);
    }
    const addr = getAddress(first);
    wcRaw.current = raw;
    const guarded = guardWc(raw, addr, (why) => endWc(why));
    keepEmail(null);
    keepFaceId(null);
    store.set(REMEMBER, null);
    setSavedMark(true);
    setWcNotice('');
    setCurrent({ id: 'walletconnect', name: 'WalletConnect', provider: guarded });
    setAccount(addr);
    dispatchWc({ type: 'approved', account: addr });
  }, [keepEmail, keepFaceId, endWc]);

  const connectWalletConnect = useCallback(() => {
    if (wcAbort.current || wcRaw.current) return; // a second tap while one is under way, or one is already connected
    const ac = new AbortController();
    wcAbort.current = ac;
    setWcNotice('');
    dispatchWc({ type: 'start' });
    wcDriver().start({ onUri: (uri) => { if (!ac.signal.aborted) dispatchWc({ type: 'uri', uri }); }, signal: ac.signal })
      .then(async (raw) => {
        if (ac.signal.aborted) { await raw.disconnect?.().catch(() => {}); return; }
        await adoptWc(raw);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        dispatchWc({ type: 'fail', why: e instanceof WcError ? e.why : classifyWcError(e), message: e instanceof WcError ? e.message : undefined });
      })
      .finally(() => { if (wcAbort.current === ac) wcAbort.current = null; });
  }, [adoptWc]);

  const cancelWalletConnect = useCallback(() => {
    wcAbort.current?.abort();
    wcAbort.current = null;
    dispatchWc({ type: 'cancel' });
  }, []);

  // a connection saved on this device: asked again on load, and used only if it is still good (not ended, not expired, lists an account on VYRE)
  useEffect(() => {
    if (!savedMark()) return;
    let stale = false;
    wcDriver().restore().then(async (raw) => {
      if (stale) return;
      if (!raw) { setSavedMark(false); setWcNotice(WC_RESTORE_NOTE); return; }
      await adoptWc(raw);
    }).catch(() => { if (!stale) { setSavedMark(false); setWcNotice(WC_RESTORE_NOTE); } });
    return () => { stale = true; };
  }, [adoptWc]);

  // while connected through WalletConnect: the wallet ending the connection, a different account, another network, and the session's end
  useEffect(() => {
    const raw = wcRaw.current;
    if (!raw || !current || !isWcProvider(current.provider) || !account) return;
    const onGone = () => endWc('closed');
    const onAccounts = (a: unknown) => {
      const first = Array.isArray(a) && typeof a[0] === 'string' ? (a[0] as string) : '';
      if (!first || first.toLowerCase() !== account.toLowerCase()) endWc('other', 'The account in your wallet changed, so you’re disconnected. Connect again.');
    };
    const onChain = (c: unknown) => {
      if (Number(c) === VYRE_CHAIN.id) setWcNotice(''); else setWcNotice(`Your wallet moved off ${VYRE_CHAIN.name}. Switch it back before you trade; nothing is sent until you do.`);
    };
    raw.on('session_delete', onGone);
    raw.on('disconnect', onGone);
    raw.on('accountsChanged', onAccounts);
    raw.on('chainChanged', onChain);
    const end = raw.session?.expiry;
    const timer = typeof end === 'number' ? setTimeout(() => endWc('expired'), Math.min(Math.max(end * 1000 - Date.now(), 0), 2_000_000_000)) : undefined;
    return () => {
      raw.removeListener('session_delete', onGone);
      raw.removeListener('disconnect', onGone);
      raw.removeListener('accountsChanged', onAccounts);
      raw.removeListener('chainChanged', onChain);
      if (timer) clearTimeout(timer);
    };
  }, [current, account, endWc]);

  // a saved email session: check it's still good (renewing it if needed), quietly
  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    withSession(s, walletsOf, keepEmail).catch((e) => { if (e instanceof WalletApiError && e.status === 401) keepEmail(null); });
  }, [keepEmail]);

  // reconnect quietly to the browser wallet picked last time, if it still lists an account for this site
  useEffect(() => {
    const id = store.get(REMEMBER);
    const w = id && available.find((x) => rememberAs(x) === id);
    if (!w || current || email || faceId) return;
    w.provider.request({ method: 'eth_accounts' }).then((a) => {
      const list = a as string[];
      if (list?.[0]) { setCurrent(w); setAccount(getAddress(list[0])); }
    }).catch(() => {});
  }, [available, current, email, faceId]);

  // follow the wallet's account changes
  useEffect(() => {
    const p = current?.provider as (EIP1193Provider & { on?: (e: string, f: (x: unknown) => void) => void; removeListener?: (e: string, f: (x: unknown) => void) => void }) | undefined;
    if (!p?.on || isWcProvider(current?.provider)) return;
    const onAccounts = (a: unknown) => {
      const list = a as string[];
      if (list?.[0]) setAccount(getAddress(list[0]));
      else { setAccount(null); setCurrent(null); }
    };
    p.on('accountsChanged', onAccounts);
    return () => p.removeListener?.('accountsChanged', onAccounts);
  }, [current]);

  const onVyre = useCallback(async (inPlaceOf?: { sender: Address; nonce: bigint }): Promise<WalletLike> => {
    // a Face ID wallet looks for its earlier operation first, if one's result couldn't be read
    if (faceId) {
      const pin = await checkEarlier(faceId.address);
      if (inPlaceOf && (!isAddressEqual(faceId.address, inPlaceOf.sender) || pin !== inPlaceOf.nonce)) {
        throw new Error('It can’t take the earlier one’s place right now (it may have gone through), so nothing was sent. Check the earlier one again.');
      }
      return faceIdSigner(faceId, pin);
    }
    if (inPlaceOf) throw new Error('Sign in with the Face ID wallet that sent the earlier one. Nothing was sent.');
    // an email wallet can't sign VYRE transactions until Circle signs for VYRE's chain ID
    if (email) throw new Error(EMAIL_TRADE_NOTE);
    if (!current || !account) throw new Error('Connect a wallet first.');
    // a WalletConnect connection is on VYRE by construction and is checked again before every signature (wc.ts); it can't be switched
    if (isWcProvider(current.provider)) await assertWcLive(current.provider);
    else await switchTo(current.provider, VYRE_CHAIN);
    return walletOn(current.provider, account);
  }, [current, account, email, faceId]);

  const value = useMemo<WalletState>(() => ({
    account: faceId ? faceId.address : email ? email.address : account,
    provider: faceId || email ? null : current?.provider ?? null,
    walletName: faceId ? 'Face ID wallet' : email ? `Email wallet · ${email.email}` : current?.name ?? null,
    wcState, wcNotice, connectWalletConnect, cancelWalletConnect,
    available, connect, disconnect, onVyre, email, emailConfig, signInEmail, withEmail,
    faceId, createFaceIdWallet, signInWithFaceId,
    confirmHint: faceId ? 'Confirm with Face ID…' : 'Confirm in your wallet…',
  }), [account, current, wcState, wcNotice, connectWalletConnect, cancelWalletConnect, available, connect, disconnect, onVyre, email, emailConfig, signInEmail, withEmail, faceId, createFaceIdWallet, signInWithFaceId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

/** True when signed in with an email wallet that can't sign on VYRE yet. On mainnet it always is: the service that builds an email wallet's
 * trades was written for the first launchpad's app router, not the new pad's SwapRouter, so no email wallet trades or launches there */
export function useEmailCantTrade(): boolean {
  const { email, emailConfig } = useWallet();
  return !!email && (!NETWORK.testnet || !emailConfig?.vyre.signing);
}
