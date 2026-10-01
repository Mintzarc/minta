// Face ID wallets on MINTA: a passkey (Face ID, a fingerprint or the computer's own lock) owns a smart wallet on
// VYRE, with no app and no seed phrase. This device keeps only the passkey's ID and public key (in localStorage), so
// coming back needs no prompt; the key that signs never leaves the device's secure chip, and the wallet's address is
// worked out here from the public key. On a new phone the person signs in with the passkey their Apple or Google
// account synced there, and the wallet is found from the signature itself (the SDK's signInWithPasskey), with nothing
// asked of VYRE's servers. Before each Face ID prompt MINTA shows the most the operation can cost and waits for a tap
// on "Confirm with Face ID" (the prompt then comes straight from that tap, as phones' browsers want). Operations are
// signed here and sent to VYRE's bundler (api.vyrechain.com/bundler); the wallet pays their gas in USDC.
import { useSyncExternalStore } from 'react';
import {
  checkPasskey, createFaceIdPasskey, faceIdBundler, faceIdWallet, faceIdWalletAddress, operationIn, signInWithPasskey,
  vyrePadAbi, vyreTestnet, type FaceIdWallet, type OperationTracker, type Passkey, type WalletLike,
} from '@vyrechain/sdk';
import {
  getAddress, isAddress, isAddressEqual, parseAbi, parseAbiItem, parseEventLogs,
  type Address, type Chain, type Client, type Hash, type TransactionReceipt, type Transport,
} from 'viem';
import { addresses } from './market';
import { API_URL } from './api';
import { faceIdReason, vyre } from './chain';

export interface FaceIdSession {
  passkey: Passkey;
  address: Address;
}

export const FACEID_KEY = 'vyre.faceid';
/**
 * Face ID wallets are on the roadmap, not in MINTA, for now (the project's call, 2026-10-01): a card purchase can't be delivered to a smart
 * wallet, so MINTA uses plain EVM wallets (a browser wallet) like other chains until the card top-up is sorted out. All the code
 * stays; turning this on again brings back "Create a wallet with Face ID", "Sign in with Face ID" and the confirm dialog, and
 * a session kept in this browser is restored. (The SDK, the bundler and the contracts are untouched.)
 */
export const FACE_ID_OFFERED = false;
const client = vyre as unknown as Client<Transport, Chain, undefined>;

/** The session kept on this device; its address is worked out again from the passkey, never read back */
export function loadFaceId(): FaceIdSession | null {
  if (!FACE_ID_OFFERED) return null;
  try {
    const j = JSON.parse(localStorage.getItem(FACEID_KEY) || 'null');
    if (!j || typeof j !== 'object') return null;
    const passkey = { id: String(j.passkey?.id ?? ''), publicKey: j.passkey?.publicKey };
    checkPasskey(passkey);
    return { passkey, address: faceIdWalletAddress(passkey.publicKey, vyreTestnet.id) };
  } catch {
    return null;
  }
}

function save(s: FaceIdSession) {
  try { localStorage.setItem(FACEID_KEY, JSON.stringify({ passkey: s.passkey })); } catch { /* private mode: signed in until the page closes */ }
}

/** Signs out on this device: the passkey itself stays (on the phone, and in the Apple or Google account) */
export function forgetFaceId() {
  cached = null;
  // (what's in flight stays written down: it's kept by wallet, and signing back in must still look for it)
  try { localStorage.removeItem(FACEID_KEY); } catch { /* nothing kept */ }
}

// ---------------------------------------------------------------------------------------------------------------
// Operations in flight: each is written down here just before it's sent (the SDK's tracker) and crossed out once
// it's mined or refused. The wallet's next operation, from any page and after a reload too, looks for what's still
// here first: went through (say so, send nothing), gone (another took its place), or still going (wait; after two
// minutes the next one takes the same place in the wallet's sequence, so only one of them can ever run)
// ---------------------------------------------------------------------------------------------------------------
const INFLIGHT_KEY = 'vyre.faceid.inflight';
const TAKE_PLACE_AFTER_MS = 2 * 60_000;
const MAX_WALLETS = 32;
const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
/** What's written down for one wallet: its place in the sequence, every operation sent for that place, a block from before */
interface Inflight { nonce: bigint; fromBlock: bigint; hashes: Hash[]; at: number }
// kept by wallet (the lowercase address), so another wallet used on this device never touches it, and it's kept across
// sign-out and sign-in. It lives in localStorage; the copy in memory is followed only where saving it failed (a browser
// that blocks site data, or a full one), while the page is open.
let memory = new Map<string, Inflight>();
let memoryOnly = false;
function loadAll(): Map<string, Inflight> {
  if (memoryOnly) return new Map(memory);
  let raw: string | null;
  try { raw = localStorage.getItem(INFLIGHT_KEY); } catch { return new Map(memory); }
  const all = new Map<string, Inflight>();
  try {
    const j = JSON.parse(raw || '{}');
    for (const [k, v] of Object.entries(j && typeof j === 'object' && !Array.isArray(j) ? j : {})) {
      const r = v as { nonce?: unknown; fromBlock?: unknown; hashes?: unknown; at?: unknown };
      if (!isAddress(k, { strict: false }) || !r || typeof r.nonce !== 'string' || !/^\d{1,78}$/.test(r.nonce)) continue;
      if (typeof r.fromBlock !== 'string' || !/^\d{1,20}$/.test(r.fromBlock) || !Array.isArray(r.hashes) || typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
      const hashes = r.hashes.filter((h: unknown) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h)) as Hash[];
      if (hashes.length) all.set(k.toLowerCase(), { nonce: BigInt(r.nonce), fromBlock: BigInt(r.fromBlock), hashes, at: r.at });
    }
  } catch { /* unreadable: nothing written down */ }
  memory = new Map(all);
  return all;
}
function saveAll(all: Map<string, Inflight>) {
  // the oldest records go first past MAX_WALLETS (each is crossed out once settled, so only unsettled ones pile up)
  const list = [...all].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_WALLETS);
  memory = new Map(list);
  try {
    if (!list.length) localStorage.removeItem(INFLIGHT_KEY);
    else localStorage.setItem(INFLIGHT_KEY, JSON.stringify(Object.fromEntries(list.map(([k, r]) => [k, { nonce: r.nonce.toString(), fromBlock: r.fromBlock.toString(), hashes: r.hashes, at: r.at }]))));
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
}
const recordOf = (sender: Address) => loadAll().get(sender.toLowerCase()) ?? null;
function setRecord(sender: Address, r: Inflight | null) {
  const all = loadAll();
  if (r) all.set(sender.toLowerCase(), r);
  else all.delete(sender.toLowerCase());
  saveAll(all);
}
// hashes sent again while already written down (an identical operation: the bundler answers "already known"): a refusal
// of the repeat mustn't cross out the first, which may still run
const repeats = new Set<string>();
const tracker: OperationTracker = {
  sending(op) {
    const r = recordOf(op.sender);
    if (r && r.nonce === op.nonce) {
      if (!r.hashes.includes(op.hash)) r.hashes.push(op.hash);
      else repeats.add(op.hash.toLowerCase());
      setRecord(op.sender, r);
    } else {
      setRecord(op.sender, { nonce: op.nonce, fromBlock: op.fromBlock, hashes: [op.hash], at: Date.now() });
    }
  },
  settled(hash, mined) {
    if (!mined && repeats.delete(hash.toLowerCase())) return;
    for (const [k, r] of loadAll()) {
      if (!r.hashes.includes(hash)) continue;
      const sender = getAddress(k);
      // mined: its place in the sequence is used, so nothing else written down for that place can run
      if (mined) return setRecord(sender, null);
      r.hashes = r.hashes.filter((h) => h !== hash);
      return setRecord(sender, r.hashes.length ? r : null);
    }
  },
};

// A launch found this way (by whatever the wallet did next, maybe on another page or in another tab) is remembered on
// this device for an hour, so the Launch page says so and asks before launching again, as it does after any launch
const LAUNCHED_KEY = 'vyre.faceid.launched';
const REMEMBER_MS = 3600e3;
export interface RecentLaunch { token: Address; symbol: string; hash: Hash }
let launchedMemory: Record<string, RecentLaunch & { at: number }> = {};
// (an entry stamped more than an hour ahead, by a clock that went back, counts as old)
const fresh = (at: unknown) => typeof at === 'number' && Math.abs(Date.now() - at) < REMEMBER_MS;
function launchedAll(): Record<string, RecentLaunch & { at: number }> {
  try {
    const j = JSON.parse(localStorage.getItem(LAUNCHED_KEY) || '{}');
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      // (only entries that are objects: anything else written there is left out, never read)
      launchedMemory = Object.fromEntries(Object.entries(j).filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v))) as typeof launchedMemory;
    }
  } catch { /* site data blocked: the copy in memory */ }
  return launchedMemory;
}
function rememberLaunch(sender: Address, l: RecentLaunch) {
  const all = launchedAll();
  for (const [k, v] of Object.entries(all)) if (!fresh(v.at)) delete all[k];
  all[sender.toLowerCase()] = { ...l, at: Date.now() };
  launchedMemory = all;
  try { localStorage.setItem(LAUNCHED_KEY, JSON.stringify(all)); } catch { /* kept in memory */ }
}
/** A launch by this wallet found in the last hour by its next transaction (checkEarlier), if any */
export function recentLaunch(sender: Address): RecentLaunch | null {
  const v = launchedAll()[sender.toLowerCase()];
  if (!v || !fresh(v.at)) return null;
  if (typeof v.token !== 'string' || !isAddress(v.token, { strict: false }) || typeof v.symbol !== 'string' || typeof v.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v.hash)) return null;
  return { token: getAddress(v.token), symbol: v.symbol.slice(0, 64), hash: v.hash as Hash };
}
/** Forgets it (the person pressed "Launch another") */
export function forgetLaunch(sender: Address) {
  const all = launchedAll();
  delete all[sender.toLowerCase()];
  launchedMemory = all;
  try { localStorage.setItem(LAUNCHED_KEY, JSON.stringify(all)); } catch { /* memory only */ }
}
/** Calls `fn` when another tab of this device changes the launch memory; returns the way to stop */
export function onLaunchMemory(fn: () => void): () => void {
  const h = (e: StorageEvent) => { if (e.key === LAUNCHED_KEY || e.key === null) fn(); };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}

/**
 * The launch an operation made for `creator`, from its own logs in a receipt (a bundle can carry other operations, the
 * same wallet's too)
 */
export function launchIn(receipt: TransactionReceipt, creator: Address, op: Hash): { token: Address; symbol: string } | undefined {
  const logs = operationIn(receipt, ENTRY_POINT, op)?.logs ?? [];
  const e = parseEventLogs({ abi: vyrePadAbi, eventName: 'LaunchCreated', logs })
    .find((x) => isAddressEqual(x.address, addresses().pad) && isAddressEqual(x.args.creator, creator));
  return e ? { token: e.args.token, symbol: e.args.symbol } : undefined;
}

const userOperationEvent = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
);
const LOG_PAGE = 10_000n;
export type Place =
  // nothing has taken that place yet (an operation signed for it may still run)
  | { state: 'pending' }
  // the wallet's sequence is behind that place: a record from before the test network was reset
  | { state: 'behind' }
  // an operation took it (`op`, in transaction `hash`); op undefined if its event wasn't found
  | { state: 'taken'; op?: Hash; hash?: Hash; success?: boolean };
/**
 * What took a wallet's place `nonce` in its sequence, as of one block: the sequence's next place and the wallet's
 * operations' events from `fromBlock` (a block from before it was signed), both read at that block
 */
export async function placeOf(sender: Address, nonce: bigint, fromBlock: bigint, atBlock?: bigint): Promise<Place> {
  const at = atBlock ?? (await vyre.getBlockNumber({ cacheTime: 0 }));
  const next = await vyre.readContract({
    address: ENTRY_POINT,
    abi: parseAbi(['function getNonce(address sender, uint192 key) view returns (uint256)']),
    functionName: 'getNonce',
    args: [sender, nonce >> 64n],
    blockNumber: at,
  });
  if (next === nonce) return { state: 'pending' };
  if (next < nonce) return { state: 'behind' };
  // forward from the block before it was sent: the operation that took the place is almost always in the first page
  for (let from = fromBlock; from <= at; from += LOG_PAGE) {
    const to = from + LOG_PAGE - 1n < at ? from + LOG_PAGE - 1n : at;
    const logs = await vyre.getLogs({ address: ENTRY_POINT, event: userOperationEvent, args: { sender }, fromBlock: from, toBlock: to });
    const l = logs.find((x) => x.args.nonce === nonce);
    if (l) return { state: 'taken', op: l.args.userOpHash, hash: l.transactionHash, success: l.args.success === true };
  }
  return { state: 'taken' };
}

type Earlier =
  | { state: 'none' }
  | { state: 'mined'; hash: Hash; op: Hash; success: boolean }
  | { state: 'gone' }
  | { state: 'pending'; nonce: bigint };
/**
 * What became of the operations written down for this wallet, as of one block: one of them took their place in the
 * sequence (mined), another did (gone), or nothing yet (pending). A record from before a chain reset is dropped.
 */
async function lookEarlier(sender: Address): Promise<Earlier> {
  const r = recordOf(sender);
  if (!r) return { state: 'none' };
  const at = await vyre.getBlockNumber({ cacheTime: 0 });
  if (r.fromBlock > at) { setRecord(sender, null); return { state: 'none' }; }
  const p = await placeOf(sender, r.nonce, r.fromBlock, at);
  if (p.state === 'behind') { setRecord(sender, null); return { state: 'none' }; }
  if (p.state === 'pending') return { state: 'pending', nonce: r.nonce };
  if (p.op && p.hash && r.hashes.some((h) => h.toLowerCase() === p.op!.toLowerCase())) return { state: 'mined', hash: p.hash, op: p.op, success: p.success === true };
  return { state: 'gone' };
}
/** How what's in flight for this wallet at `nonce` is kept: on this device, only while this page is open, or not at all */
export function kept(sender: Address, nonce: bigint): 'device' | 'page' | 'no' {
  const r = recordOf(sender);
  return !r || r.nonce !== nonce ? 'no' : memoryOnly ? 'page' : 'device';
}
/**
 * Crosses out what's written down for this wallet at `nonce`: for a page that found its own operation mined at that
 * place (so nothing else written down for it can run)
 */
export function resolveEarlier(sender: Address, nonce: bigint) {
  const r = recordOf(sender);
  if (r && r.nonce === nonce) setRecord(sender, null);
}
/**
 * Whether what's written down for this wallet is at `nonce` and has been pending long enough for the next operation
 * to take its place (or the device's clock went back)
 */
export function mayTakePlace(sender: Address, nonce: bigint): boolean {
  const r = recordOf(sender);
  if (!r || r.nonce !== nonce) return false;
  const age = Date.now() - r.at;
  return age < 0 || age >= TAKE_PLACE_AFTER_MS;
}
/**
 * Before a Face ID wallet's next operation: throws (sending nothing) if an earlier one went through, failed or is
 * still going; returns the place in the sequence to take if an earlier one has been pending two minutes or more (or
 * the device's clock went back). What went through is thrown with its transaction (`hash`) and operation (`op`).
 */
export async function checkEarlier(sender: Address): Promise<bigint | undefined> {
  let e: Earlier;
  try { e = await lookEarlier(sender); } catch { throw new Error('Your earlier transaction couldn’t be checked right now, so nothing was sent. Try again in a moment.'); }
  if (e.state === 'none') return undefined;
  if (e.state === 'gone') { setRecord(sender, null); return undefined; }
  if (e.state === 'mined') {
    // what it did is read before it's crossed out, so whatever page asks next can say it (a launch in particular): if
    // the receipt can't be read, or doesn't hold the operation, it stays written down and the next try looks again (one
    // that failed did nothing: there's nothing to read)
    let launch: { token: Address; symbol: string } | undefined;
    if (e.success) {
      const receipt = await vyre.getTransactionReceipt({ hash: e.hash }).catch(() => null);
      if (!receipt || !operationIn(receipt, ENTRY_POINT, e.op)) throw new Error('Your earlier transaction went through, but it couldn’t be read just now, so nothing new was sent. Try again in a moment.');
      launch = launchIn(receipt, sender, e.op);
      // (remembering it can never stop the record being crossed out)
      if (launch) try { rememberLaunch(sender, { ...launch, hash: e.hash }); } catch { /* not remembered */ }
    }
    setRecord(sender, null);
    throw Object.assign(new Error(!e.success
      ? 'Your earlier transaction failed on chain (linked here): nothing it asked for happened. Nothing new was sent; you can go ahead now.'
      : launch ? `Your earlier transaction went through (linked here): it launched $${launch.symbol}. Nothing new was sent.`
      : 'Your earlier transaction went through (linked here), so nothing new was sent. Check what it did before doing anything again.'),
    { hash: e.hash, op: e.op, success: e.success, earlier: true, ...(launch ? { launch } : {}) });
  }
  if (!mayTakePlace(sender, e.nonce)) throw new Error('Your earlier transaction is still going through, so nothing new was sent. Wait a moment, then try again.');
  return e.nonce;
}

function supported() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('This browser can’t use passkeys. Open MINTA in Safari or Chrome on your phone, or in an up-to-date browser.');
  }
}
const plain = (e: unknown) => { const t = faceIdReason(e); return t ? new Error(t) : e instanceof Error ? e : new Error(String(e)); };

/** Makes a new Face ID wallet: a new passkey (Face ID asks), and the wallet's address from it */
export async function createFaceId(): Promise<FaceIdSession> {
  supported();
  let passkey: Passkey;
  try {
    // named with the time, so two wallets made the same day can be told apart when signing in
    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    passkey = await createFaceIdPasskey({ name: `VYRE wallet ${at}` });
  } catch (e) { throw plain(e); }
  const s = { passkey, address: faceIdWalletAddress(passkey.publicKey, vyreTestnet.id) };
  save(s);
  return s;
}

/**
 * Signs in with a Face ID wallet's passkey. `confirmAgain` is awaited before a second Face ID prompt, needed only for
 * a wallet that's never been used (the page shows a button for it: browsers allow a prompt only right after a tap).
 */
export async function signInFaceId(confirmAgain?: () => Promise<void>): Promise<FaceIdSession> {
  supported();
  try {
    const f = await signInWithPasskey(client, { confirmAgain });
    const s = { passkey: f.passkey, address: f.address };
    save(s);
    return s;
  } catch (e) { throw plain(e); }
}

// ---------------------------------------------------------------------------------------------------------------
// "Confirm with Face ID": one request at a time, shown by <FaceIdConfirm /> (components/ui.tsx)
// ---------------------------------------------------------------------------------------------------------------
export interface ConfirmRequest {
  maxCost: bigint;
  confirm: () => void;
  cancel: () => void;
}
let request: ConfirmRequest | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
// a trade's deadline (10 minutes) starts before the dialog: after 3 minutes it closes, so nothing is signed that
// would fail on chain for being late
const CONFIRM_WITHIN_MS = 3 * 60_000;
function askConfirm(info: { maxCost: bigint }): Promise<void> {
  request?.cancel();
  return new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); request = null; emit(); };
    const timer = setTimeout(() => { done(); reject(new Error('Not confirmed within 3 minutes, so nothing was sent. Try again.')); }, CONFIRM_WITHIN_MS);
    request = {
      maxCost: info.maxCost,
      confirm: () => { done(); resolve(); },
      cancel: () => { done(); reject(new Error('Cancelled. Nothing was sent.')); },
    };
    emit();
  });
}
/** The confirmation waiting to be answered, if any */
export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => request, () => null);
}

let cached: { id: string; signer: WalletLike } | null = null;

/**
 * What sends a Face ID wallet's operations: a bundler client with the wallet as its account (for the SDK's functions).
 * `pin`: the place in the wallet's sequence its next operation takes (checkEarlier's answer)
 */
export async function faceIdSigner(s: FaceIdSession, pin?: bigint): Promise<WalletLike> {
  const signer = await signerFor(s);
  (signer.account as unknown as FaceIdWallet).pinNonce(pin);
  return signer;
}
async function signerFor(s: FaceIdSession): Promise<WalletLike> {
  if (cached?.id === s.passkey.id) return cached.signer;
  const account = await faceIdWallet({ client, passkey: s.passkey, confirm: askConfirm, track: tracker });
  const signer = faceIdBundler({ client, account, url: `${API_URL}/bundler` }) as unknown as WalletLike;
  cached = { id: s.passkey.id, signer };
  return signer;
}
