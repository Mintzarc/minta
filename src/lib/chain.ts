// The chains the app talks to, and the browser wallet.
// Reads go to VYRE's public RPC through Multicall3 (the RPC serves one request at a time per visitor, so reads made
// together travel as one). Writes go through the visitor's wallet, and every one is simulated first (the SDK does it).
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { arcTestnet, cctpSource, vyreTestnet } from '@vyrechain/sdk';
import { tokenText } from './format';
import { fetchSplit } from './fetchSplit';
import { vyreTransport } from './transport';
import { API_URL } from './api';
import { guardProvider, wasCancelledByCheck } from './txcheck';

/** The network the app works on, and the network USDC is moved to and from. The only place either is chosen: every other file
 * reads them from here (moving MINTA to another network: docs/HANDOFF.md, section 4). */
export const VYRE_CHAIN = vyreTestnet;
export const ARC_CHAIN = arcTestnet;

export const EXPLORER = VYRE_CHAIN.blockExplorers.default.url;
export const ARC_EXPLORER = ARC_CHAIN.blockExplorers.default.url;

export const vyre: PublicClient = createPublicClient({
  chain: VYRE_CHAIN,
  // Requests made together travel as one JSON-RPC batch, at most 5 to a request: the public RPC charges an eth_call 10
  // of a visitor's 60-point burst, so a batch of 7 or more is refused however long it waits. Reads made together go
  // through Multicall3 in chunks of 4 KB of calls (about a hundred balance reads), which keeps each eth_call's gas far
  // under the 10M cap; `fetchSplit` keeps each request under the RPC's body limit. (No `gas` is passed on these reads.) A log
  // read the RPC refuses as too large comes back at once, so the range is halved without waiting, and another call of a batch
  // refused that way is asked once more on its own (`vyreTransport`).
  transport: vyreTransport(fetchSplit),
  batch: { multicall: { wait: 16, batchSize: 4_096 } },
}) as PublicClient;

export const arc: PublicClient = createPublicClient({ chain: ARC_CHAIN, transport: http() }) as PublicClient;

const sources = new Map<number, PublicClient>();
/** A client on a chain USDC can come from (Ethereum, Base or Arbitrum Sepolia), over its free public RPC */
export function sourceClient(chainId: number): PublicClient {
  let c = sources.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: cctpSource(chainId).chain, transport: http() }) as PublicClient;
    sources.set(chainId, c);
  }
  return c;
}

/**
 * Runs `job` one at a time (the RPC takes one request at a time from each visitor): a call while it runs is skipped,
 * or, with `queue`, runs once more when it's done (for a refresh that must land, like after a trade).
 */
export function oneAtATime(job: () => Promise<unknown>): (queue?: boolean) => void {
  let running = false, again = false;
  const run = (queue = false) => {
    if (running) { if (queue) again = true; return; }
    running = true;
    job().catch(() => {}).finally(() => {
      running = false;
      if (again) { again = false; run(); }
    });
  };
  return run;
}

// ---------------------------------------------------------------------------------------------------------------
// Browser wallets: every wallet that announces itself (EIP-6963), or the one at window.ethereum
// ---------------------------------------------------------------------------------------------------------------

export interface WalletInfo {
  id: string;
  name: string;
  /** The wallet's EIP-6963 reverse-DNS name (io.metamask): what the app remembers it by, since its id changes on every
   * page load and its name is only a label */
  rdns?: string;
  icon?: string;
  provider: EIP1193Provider;
}

const found = new Map<string, WalletInfo>();
const listeners = new Set<() => void>();
export function onWalletsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function wallets(): WalletInfo[] {
  const list = [...found.values()];
  const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!list.length && injected) list.push({ id: 'injected', name: 'Browser wallet', provider: injected });
  return list;
}
/** Asks the wallets to announce themselves again and lets listeners re-read `window.ethereum`: a wallet that injects itself
 * after the page started (or never announces) is picked up when the connect menu opens */
export function refreshWallets() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  listeners.forEach((f) => f());
}
if (typeof window !== 'undefined') {
  window.addEventListener('ethereum#initialized', () => listeners.forEach((f) => f()));
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const d = (e as CustomEvent).detail as { info: { uuid: string; name: string; rdns?: string; icon?: string }; provider: EIP1193Provider };
    if (!d?.info?.uuid || !d.provider) return;
    // only data: images as icons (a wallet names its own icon; nothing is fetched from elsewhere)
    const icon = typeof d.info.icon === 'string' && d.info.icon.startsWith('data:image/') ? d.info.icon : undefined;
    const rdns = typeof d.info.rdns === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d.info.rdns) && d.info.rdns.length <= 100 ? d.info.rdns.toLowerCase() : undefined;
    const name = tokenText(String(d.info.name || '')).slice(0, 40) || 'Wallet';
    found.set(d.info.uuid, { id: d.info.uuid, name, rdns, icon, provider: d.provider });
    listeners.forEach((f) => f());
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

const hex = (n: number) => `0x${n.toString(16)}`;
function params(chain: Chain) {
  return {
    chainId: hex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
  };
}

const onChain = async (provider: EIP1193Provider, id: number) => {
  const current = await provider.request({ method: 'eth_chainId' }).catch(() => null);
  return !!current && parseInt(String(current), 16) === id;
};

/** Asks the wallet to switch to a chain, adding it first if it doesn't know it; throws unless it's on it after */
export async function switchTo(provider: EIP1193Provider, chain: Chain): Promise<void> {
  if (await onChain(provider, chain.id)) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(chain.id) }] });
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 4902 || /unrecognized|not been added|unknown chain/i.test(err.message || '')) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [params(chain)] });
      // some wallets add a network without switching to it
      if (!(await onChain(provider, chain.id))) await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(chain.id) }] });
    } else throw e;
  }
  if (!(await onChain(provider, chain.id))) throw new Error(`Your wallet is still on another network: switch it to ${chain.name}, then try again.`);
}

/**
 * A wallet client for VYRE (or Arc, or a chain USDC comes from), for the connected account. On VYRE every transaction it sends
 * is first run through the advisory pre-sign check (lib/txcheck.ts: at most 0.8 s, silent unless it finds something); on any
 * other chain the wallet's own provider is used as it is.
 */
export function walletOn(provider: EIP1193Provider, account: Address, chain: Chain = VYRE_CHAIN): WalletClient {
  return createWalletClient({ account, chain, transport: custom(guardProvider(provider, { chainId: chain.id, vyreChainId: vyre.chain?.id, url: `${API_URL}/txcheck` })) });
}

/** A readable reason from a wallet or node error */
/** Passkey and wallet errors in plain words (null: not one of these) */
export function faceIdReason(e: unknown): string | null {
  const all: unknown[] = [];
  for (let x: unknown = e, i = 0; x && i < 6; x = (x as { cause?: unknown }).cause, i++) all.push(x);
  const names = all.map((x) => (x as { name?: string })?.name);
  const text = all.map((x) => `${(x as { message?: string })?.message ?? ''} ${(x as { details?: string })?.details ?? ''}`).join(' ');
  if (names.includes('NotAllowedError') || /Failed to request credential|The operation either timed out or was not allowed/i.test(text)) return 'Face ID was cancelled, or took too long. Nothing was sent.';
  if (names.includes('NotAWalletPasskeyError')) return 'That passkey isn’t a VYRE wallet’s (it may belong to another site). Pick your VYRE wallet.';
  if (names.includes('InvalidStateError')) return 'This device already has that passkey.';
  if (names.includes('SecurityError')) return 'Passkeys only work on the address they were made on.';
  if (names.includes('FeeTooHighError')) return 'The network fee for this is unusually high right now, so nothing was signed. Try again in a minute.';
  if (/does not have sufficient funds|AA21|didn't pay prefund/i.test(text)) return 'Not enough USDC for this and its network fee.';
  if (/Invalid Smart Account nonce|AA25|already known|replacement underpriced/i.test(text)) return 'Another transaction from this wallet is still going through. Wait a moment, then try again.';
  if (/rate limited|Request exceeds defined limit|busy: try again|one request at a time/i.test(text)) return 'VYRE’s network is busy right now, so nothing was sent. Try again in a moment.';
  return null;
}

export function reason(e: unknown): string {
  if (e === null || e === undefined) return 'It stopped without saying why: check your wallet before trying again.';
  const face = faceIdReason(e);
  if (face) return face;
  const err = e as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  if (wasCancelledByCheck(e)) return 'Cancelled. Nothing was sent.';
  if (err?.code === 4001 || err?.cause?.code === 4001 || /user rejected|denied/i.test(err?.message || '')) return 'Cancelled in your wallet.';
  const m = err?.shortMessage || err?.message || String(e);
  return m.split('\n')[0].slice(0, 220);
}
