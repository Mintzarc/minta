// Email sign-in: a wallet made and kept by Circle (user-controlled wallets), no wallet app. VYRE's API
// (a wallet service, api.vyrechain.com/wallet) holds Circle's key and asks Circle for each step; Circle's own window (its web SDK, an iframe
// from pw-auth.circle.com) takes the emailed code and the user's OK for every wallet action. VYRE never sees a key.
//
// On the testnet a Circle wallet lives on Arc (card top-ups land there) and can move its USDC to VYRE. It can't sign
// VYRE transactions yet: Circle's testnet wallets sign only for a fixed list of chain IDs, which lacks VYRE's 7357.
import { getAddress, parseTransaction, recoverTransactionAddress, type Address, type Hash, type PublicClient } from 'viem';
import { API_URL } from './api';

export const EMAIL_TRADE_NOTE = 'Trading with an email wallet opens when Circle supports VYRE; for now connect a browser wallet.';

export interface WalletConfig {
  enabled: boolean;
  appId?: string;
  blockchains: string[];
  arc: { blockchain: string; chainId: number; inbox: string };
  vyre: { chainId: number; signing: boolean; signBlockchain: string; note: string };
}

/** A signed-in email wallet, kept on this device until sign-out (Circle's session lasts up to 14 days) */
export interface EmailSession {
  v: 1;
  email: string;
  deviceId: string;
  userToken: string;
  encryptionKey: string;
  refreshToken: string;
  /** The wallet's address: the same on Arc and on VYRE */
  address: Address;
  arcWalletId: string;
  /** Circle's generic EVM wallet (same address), the kind that can sign for other chains */
  signWalletId: string | null;
}

export class WalletApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number | string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new WalletApiError('VYRE’s sign-in service isn’t reachable right now. Try again soon.', 0);
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string; code?: number | string } & Record<string, unknown>;
  if (!r.ok) throw new WalletApiError(j.error || 'Something went wrong. Try again.', r.status, j.code, j);
  return j as T;
}

let configP: Promise<WalletConfig> | null = null;
/** Whether email sign-in is on, and Circle's app ID for its window (asked once per page load) */
export function walletConfig(): Promise<WalletConfig> {
  if (!configP) configP = api<WalletConfig>('/wallet/config').catch((e) => { configP = null; throw e; });
  return configP;
}

// ---------------------------------------------------------------------------------------------------------------
// The session on this device. Circle's window needs the session token and its encryption key in the page, so they
// can't live in an httpOnly cookie; they're kept in this site's storage until sign-out, and Circle ends the session
// after 14 days at most. Every money move still needs the user's OK in Circle's window.
// ---------------------------------------------------------------------------------------------------------------
const KEY = 'vyre.email';
export function loadSession(): EmailSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as EmailSession | null;
    if (!s || s.v !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(s.address) || !s.userToken || !s.arcWalletId) return null;
    return { ...s, address: getAddress(s.address) };
  } catch { return null; }
}
export function saveSession(s: EmailSession): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: signed in for this visit only */ }
}
export function clearSession(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------------------------------------------
// Circle's web SDK, loaded only when needed (it's a separate download)
// ---------------------------------------------------------------------------------------------------------------
type Sdk = import('@circle-fin/w3s-pw-web-sdk').W3SSdk;
type ChallengeResult = { type?: string; status?: string; data?: { signature?: string; signedTransaction?: string; txHash?: string } };
let sdkP: Promise<{ sdk: Sdk; deviceId: string }> | null = null;

async function circleSdk(appId: string): Promise<{ sdk: Sdk; deviceId: string }> {
  if (!sdkP) {
    sdkP = (async () => {
      const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
      const sdk = new W3SSdk({ appSettings: { appId } });
      // Circle's window in VYRE's colors
      sdk.setThemeColor({
        backdrop: '#000000', backdropOpacity: 0.72, bg: '#07111a', divider: '#15383f', success: '#26f0f2', error: '#ff8a7a',
        textMain: '#f2fbfb', textMain2: '#d3d6cb', textAuxiliary: '#a4a898', textAuxiliary2: '#838878', textPlaceholder: '#838878',
        textInteractive: '#26f0f2', inputText: '#f2fbfb', inputBg: '#0a1621', inputBorderFocused: '#26f0f2',
        mainBtnBg: '#26f0f2', mainBtnText: '#021417', mainBtnBgOnHover: '#6ff6f7', mainBtnTextOnHover: '#021417',
        mainBtnBgDisabled: '#3a3d33', mainBtnTextDisabled: '#838878', secondBtnText: '#f2fbfb', secondBtnBorder: '#4a4d44',
        pinDotActivated: '#26f0f2', plainBtnText: '#26f0f2', plainBtnTextOnHover: '#7ff8f9', titleGradients: ['#26f0f2', '#7ff8f9'],
      });
      // Circle's window must have handed over this browser's device ID before it can run a challenge
      const deviceId = await sdk.getDeviceId();
      return { sdk, deviceId };
    })().catch((e) => {
      sdkP = null;
      throw new Error(`Circle’s sign-in window couldn’t load (${String((e as Error)?.message || e).slice(0, 80)}). Check your connection and try again.`);
    });
  }
  return sdkP;
}

/**
 * Runs one step in Circle's window. Resolves when Circle reports success; rejects on a failure, or when the window is
 * closed without one (the SDK doesn't report a close).
 */
function inCircleWindow<T>(start: (s: { ok: (v: T) => void; fail: (e: Error) => void; note: (e: Error) => void }) => void, closed: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let last: Error | null = null;
    let seen = !!document.getElementById('sdkIframe');
    const finish = () => { done = true; watch.disconnect(); clearTimeout(timer); };
    const watch = new MutationObserver(() => {
      if (document.getElementById('sdkIframe')) { seen = true; return; }
      if (seen && !done) setTimeout(() => { if (!done && !document.getElementById('sdkIframe')) { finish(); reject(last || new Error(closed)); } }, 800);
    });
    watch.observe(document.body, { childList: true });
    const timer = setTimeout(() => { if (!done) { finish(); reject(new Error('Circle’s window timed out. Try again.')); } }, 15 * 60_000);
    start({
      ok: (v) => { if (!done) { finish(); resolve(v); } },
      fail: (e) => { if (!done) { finish(); reject(e); } },
      note: (e) => { last = e; },
    });
  });
}
const circleError = (e: { code?: number; message?: string } | undefined, fallback: string) =>
  new Error(e?.code === 155701 ? 'Cancelled in Circle’s window.' : (e?.message ? `${e.message.replace(/\.$/, '')}.` : fallback));

/** Runs a challenge (wallet creation, a transaction, a signature) in Circle's window; the user confirms it there */
async function execute(s: Pick<EmailSession, 'userToken' | 'encryptionKey'>, appId: string, challengeId: string): Promise<ChallengeResult> {
  const { sdk } = await circleSdk(appId);
  sdk.setAuthentication({ userToken: s.userToken, encryptionKey: s.encryptionKey });
  return inCircleWindow<ChallengeResult>(({ ok, fail }) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) return fail(circleError(error, 'Circle’s window reported a problem.'));
      const r = (result || {}) as ChallengeResult;
      if (r.status && !['COMPLETE', 'IN_PROGRESS', 'PENDING'].includes(r.status)) return fail(new Error(`Circle says the request ${r.status.toLowerCase()}.`));
      ok(r);
    });
  }, 'Circle’s window was closed before you confirmed.');
}

// ---------------------------------------------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------------------------------------------
interface WalletRow { id: string; address: Address | null; blockchain: string; accountType: string; state: string }
export interface WalletsAnswer {
  wallets: WalletRow[];
  arc: { walletId: string; address: Address; balances: { symbol: string; amount: string; native: boolean; tokenAddress: string | null }[] } | null;
}
const listWallets = (userToken: string) => api<WalletsAnswer>('/wallet/wallets', { userToken });

/**
 * Signs in with an emailed code and returns the session, making the user's wallet the first time: Circle's window
 * asks for the code, then for the user's OK to create the wallet.
 */
export async function signInWithEmail(email: string, say: (t: string) => void): Promise<EmailSession> {
  const cfg = await walletConfig();
  if (!cfg.enabled || !cfg.appId) throw new Error('Email sign-in isn’t set up yet.');
  const appId = cfg.appId;
  say('Opening Circle’s sign-in…');
  const { sdk, deviceId } = await circleSdk(appId);
  const askCode = () => api<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string }>('/wallet/email', { email: email.trim(), deviceId });
  say('Sending a code to your email…');
  const first = await askCode();
  say('Enter the code from your email in Circle’s window.');
  const login = await inCircleWindow<{ userToken: string; encryptionKey: string; refreshToken: string }>(({ ok, note }) => {
    const onLogin = (error: { code?: number; message?: string } | undefined, result: { userToken?: string; encryptionKey?: string; refreshToken?: string } | undefined) => {
      // a wrong code leaves the window open for another try: remember the problem in case it's closed
      if (error || !result?.userToken || !result.encryptionKey) return note(circleError(error, 'The code wasn’t accepted.'));
      ok({ userToken: result.userToken, encryptionKey: result.encryptionKey, refreshToken: result.refreshToken || '' });
    };
    const open = (t: { deviceToken: string; deviceEncryptionKey: string; otpToken: string }) => {
      sdk.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken: t.deviceToken, deviceEncryptionKey: t.deviceEncryptionKey, otpToken: t.otpToken } }, onLogin);
      sdk.verifyOtp();
    };
    // "Resend" in Circle's window: a new code (the old one stops working), and the window reopens for it
    sdk.setOnResendOtpEmail(() => {
      say('Sending a new code…');
      askCode().then((t) => { say('Enter the new code in Circle’s window.'); open(t); }, (e: Error) => { note(e); say(e.message); });
    });
    open(first);
  }, 'Circle’s window was closed before the code was entered.');

  say('Setting up your wallet…');
  const init = await api<{ challengeId?: string; ready?: boolean }>('/wallet/init', { userToken: login.userToken });
  if (init.challengeId) {
    say('Confirm your new wallet in Circle’s window.');
    await execute(login, appId, init.challengeId);
  }
  // Circle makes the wallet a moment after the OK
  say('Getting your wallet…');
  let w: WalletsAnswer | null = null;
  for (let i = 0; i < 15; i++) {
    w = await listWallets(login.userToken);
    if (w.arc) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!w?.arc) throw new Error('Your wallet isn’t ready yet. Sign in again in a minute.');
  const sign = w.wallets.find((x) => x.blockchain === cfg.vyre.signBlockchain && x.accountType === 'EOA' && x.state === 'LIVE');
  return {
    v: 1, email: email.trim(), deviceId, ...login,
    address: getAddress(w.arc.address), arcWalletId: w.arc.walletId, signWalletId: sign?.id ?? null,
  };
}

/**
 * Runs `fn` with the session; if Circle says the session has expired, gets a fresh one with the refresh token first
 * (Circle's window isn't needed) and tries once more. `onNew` receives a refreshed session to keep.
 */
export async function withSession<T>(s: EmailSession, fn: (s: EmailSession) => Promise<T>, onNew: (s: EmailSession) => void): Promise<T> {
  try {
    return await fn(s);
  } catch (e) {
    if (!(e instanceof WalletApiError) || e.status !== 401 || !s.refreshToken) throw e;
    const r = await api<{ userToken: string; encryptionKey?: string; refreshToken?: string }>('/wallet/refresh', {
      userToken: s.userToken, refreshToken: s.refreshToken, deviceId: s.deviceId,
    }).catch((x) => {
      // a session that can't be renewed (expired, or this browser's Circle device changed) means signing in again
      if (x instanceof WalletApiError && x.status >= 400 && x.status < 500) throw new WalletApiError('Your sign-in has expired: sign in again.', 401, x.code);
      throw x;
    });
    const next: EmailSession = { ...s, userToken: r.userToken, encryptionKey: r.encryptionKey || s.encryptionKey, refreshToken: r.refreshToken || s.refreshToken };
    onNew(next);
    return fn(next);
  }
}

export const walletsOf = (s: EmailSession) => listWallets(s.userToken);

/**
 * Moves USDC from the email wallet on Arc to the same address on VYRE: the server simulates Inbox.depositEth() with
 * the amount first, Circle's window shows it for the user's OK, and Circle sends it on Arc. Resolves with the Arc
 * transaction's hash once Circle has sent it (VYRE credits the address a few seconds later).
 */
export async function moveToVyre(s: EmailSession, amount: string, say: (t: string) => void): Promise<{ arcTx: Hash | null }> {
  const cfg = await walletConfig();
  if (!cfg.appId) throw new Error('Email sign-in isn’t set up yet.');
  say('Checking it on Arc…');
  const d = await api<{ challengeId: string }>('/wallet/deposit', { userToken: s.userToken, walletId: s.arcWalletId, amount });
  say('Confirm the move in Circle’s window.');
  await execute(s, cfg.appId, d.challengeId);
  say('Confirmed. Circle is sending it on Arc…');
  const end = Date.now() + 180_000;
  let txId: string | undefined;
  while (Date.now() < end) {
    if (!txId) {
      const c = await api<{ status: string; correlationIds: string[]; errorMessage?: string }>('/wallet/challenge', { userToken: s.userToken, challengeId: d.challengeId });
      if (['FAILED', 'EXPIRED'].includes(c.status)) throw new Error(`Circle couldn’t send it (${c.errorMessage || c.status.toLowerCase()}).`);
      txId = c.correlationIds[0];
    }
    if (txId) {
      const t = await api<{ state: string; txHash: Hash | null; errorReason?: string }>('/wallet/transaction', { userToken: s.userToken, id: txId });
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(t.state)) throw new Error(`Circle couldn’t send it (${t.errorReason || t.state.toLowerCase()}).`);
      if (t.txHash && ['SENT', 'CONFIRMED', 'COMPLETE'].includes(t.state)) return { arcTx: t.txHash };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { arcTx: null };
}

// ---------------------------------------------------------------------------------------------------------------
// VYRE transactions from an email wallet: ready for when Circle signs for VYRE's chain ID (the server's switch is off
// until then, and the app shows EMAIL_TRADE_NOTE instead)
// ---------------------------------------------------------------------------------------------------------------
export type VyreAction =
  | { kind: 'buy'; token: Address; usdcIn: string; minTokensOut: string; deadline: number }
  | { kind: 'sell'; token: Address; amountIn: string; minUsdcOut: string; deadline: number }
  | { kind: 'approve'; token: Address; amount: string };

interface VyreTx { chainId: number; nonce: string; to: string; value: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; data: string }

/**
 * Has the server build and simulate a VYRE transaction, the user sign it in Circle's window, checks the signed
 * transaction is exactly that one from this wallet, and broadcasts it on VYRE. Resolves with its hash once mined.
 */
export async function sendVyreTx(s: EmailSession, action: VyreAction, vyre: PublicClient, say: (t: string) => void): Promise<Hash> {
  const cfg = await walletConfig();
  if (!cfg.vyre.signing || !cfg.appId) throw new Error(EMAIL_TRADE_NOTE);
  if (!s.signWalletId) throw new Error('Sign out and in again to finish setting up your wallet for VYRE.');
  say('Checking it on VYRE…');
  const d = await api<{ challengeId: string; transaction: VyreTx }>('/wallet/vyre-tx', { userToken: s.userToken, walletId: s.signWalletId, action });
  say('Confirm in Circle’s window…');
  const r = await execute(s, cfg.appId, d.challengeId);
  const signed = r.data?.signedTransaction as `0x${string}` | undefined;
  if (!signed || !/^0x[0-9a-fA-F]+$/.test(signed)) throw new Error('Circle didn’t return a signed transaction.');
  const t = parseTransaction(signed);
  const want = d.transaction;
  const same = t.chainId === want.chainId && t.chainId === (await vyre.getChainId()) && t.nonce === Number(want.nonce)
    && t.to?.toLowerCase() === want.to.toLowerCase() && (t.value ?? 0n) === BigInt(want.value) && (t.data ?? '0x') === want.data
    && t.gas === BigInt(want.gas) && t.maxFeePerGas === BigInt(want.maxFeePerGas);
  const signer = await recoverTransactionAddress({ serializedTransaction: signed as never });
  if (!same || signer.toLowerCase() !== s.address.toLowerCase()) throw new Error('The signed transaction isn’t the one asked for; it wasn’t sent.');
  say('Sending on VYRE…');
  const hash = await vyre.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await vyre.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('It failed on chain.');
  return hash;
}
