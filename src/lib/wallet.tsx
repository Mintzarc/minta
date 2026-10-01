// The connected wallet, shared by every page: a Face ID wallet (a passkey's smart wallet, see faceid.ts), a browser
// wallet, or an email wallet (Circle's, see circle.ts). For a browser wallet the app asks for accounts only when the
// visitor clicks Connect, remembers which wallet they picked (not any key: wallets never hand those out), and follows
// account and network changes. An email wallet's session, or a Face ID wallet's passkey ID and public key (never a
// key that can sign: that stays in the device's secure chip), are kept on this device until sign-out.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAddress, isAddressEqual, type Address, type EIP1193Provider } from 'viem';
import { vyreTestnet, type WalletLike } from '@vyrechain/sdk';
import { onWalletsChanged, switchTo, walletOn, wallets, type WalletInfo } from './chain';
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
const REMEMBER = 'vyre.wallet';
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

  useEffect(() => onWalletsChanged(() => setAvailable(wallets())), []);
  useEffect(() => { walletConfig().then(setEmailConfig).catch(() => setEmailConfig(null)); }, []);

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

  const connect = useCallback(async (w: WalletInfo) => {
    const accounts = (await w.provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!accounts?.[0]) throw new Error('The wallet gave no account.');
    keepEmail(null);
    keepFaceId(null);
    setCurrent(w);
    setAccount(getAddress(accounts[0]));
    store.set(REMEMBER, rememberAs(w));
  }, [keepEmail]);

  const disconnect = useCallback(() => {
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepEmail(null);
    keepFaceId(null);
  }, [keepEmail, keepFaceId]);

  const signInEmail = useCallback(async (address: string, say: (t: string) => void) => {
    const s = await signInWithEmail(address, say);
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepFaceId(null);
    keepEmail(s);
  }, [keepEmail, keepFaceId]);

  const adoptFaceId = useCallback((f: FaceIdSession) => {
    setCurrent(null);
    setAccount(null);
    store.set(REMEMBER, null);
    keepEmail(null);
    setFaceId(f);
  }, [keepEmail]);
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
    if (!p?.on) return;
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
    await switchTo(current.provider, vyreTestnet);
    return walletOn(current.provider, account);
  }, [current, account, email, faceId]);

  const value = useMemo<WalletState>(() => ({
    account: faceId ? faceId.address : email ? email.address : account,
    provider: faceId || email ? null : current?.provider ?? null,
    walletName: faceId ? 'Face ID wallet' : email ? `Email wallet · ${email.email}` : current?.name ?? null,
    available, connect, disconnect, onVyre, email, emailConfig, signInEmail, withEmail,
    faceId, createFaceIdWallet, signInWithFaceId,
    confirmHint: faceId ? 'Confirm with Face ID…' : 'Confirm in your wallet…',
  }), [account, current, available, connect, disconnect, onVyre, email, emailConfig, signInEmail, withEmail, faceId, createFaceIdWallet, signInWithFaceId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

/** True when signed in with an email wallet that can't sign on VYRE yet */
export function useEmailCantTrade(): boolean {
  const { email, emailConfig } = useWallet();
  return !!email && !emailConfig?.vyre.signing;
}
