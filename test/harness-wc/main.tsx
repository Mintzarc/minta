// A small page for the browser check of WalletConnect (test/walletconnect.browser.cjs; not part of the app, never built into it).
// It mounts the app's own wallet provider, connect button, connect sheet and transaction button, and replaces only what talks to
// the WalletConnect relay (setWcDriver) with a stand-in wallet the test controls through window.__fake / window.__pair / window.__emit.
// The stand-in is an EIP-1193 provider that records every request it is asked, and answers like the library's provider does
// (eth_chainId and eth_accounts from its own session).
import '../../src/styles.css';
import { createRoot } from 'react-dom/client';
import type { Address, WalletClient } from 'viem';
import { WalletProvider, useWallet } from '../../src/lib/wallet';
import { ConnectButton, TxButton } from '../../src/components/ui';
import WalletConnectSheet from '../../src/components/WalletConnectSheet';
import { VYRE_CHAIN } from '../../src/lib/chain';
import { setWcDriver, type WcProvider } from '../../src/lib/wc';

const PAD: Address = '0x3333333333333333333333333333333333333333';
const OTHER: Address = '0x4444444444444444444444444444444444444444';
const URI = `wc:${'ab'.repeat(32)}@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=${'cd'.repeat(32)}`;

interface Fake { account: string; chain: number; reject: boolean; lost: boolean; expiry?: number }
type W = {
  __fake: Fake; __sent: { method: string; params: unknown; chain?: string }[]; __asked: string[]; __starts: number; __disconnects: number;
  __pair: { resolve: () => void; reject: (e: unknown) => void } | null; __restoreable: boolean; __emit: (e: string, v: unknown) => void;
  __lastTrade: string; __ids: { PAD: string; OTHER: string; URI: string };
};
const w = window as unknown as W;
w.__fake = { account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', chain: VYRE_CHAIN.id, reject: false, lost: false };
w.__sent = []; w.__asked = []; w.__starts = 0; w.__disconnects = 0; w.__pair = null; w.__restoreable = false; w.__lastTrade = '';
w.__ids = { PAD, OTHER, URI };

const listeners = new Map<string, Set<(x: unknown) => void>>();
w.__emit = (e, v) => listeners.get(e)?.forEach((f) => f(v));

const provider: WcProvider = {
  async request(args: { method: string; params?: unknown }, chain?: string) {
    const { method, params } = args;
    w.__asked.push(method);
    const f = w.__fake;
    if (method === 'eth_chainId') return `0x${f.chain.toString(16)}`;
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.account];
    if (method === 'eth_sendTransaction' || method === 'eth_signTypedData_v4' || method === 'personal_sign') {
      w.__sent.push({ method, params, chain });
      if (f.lost) throw new Error('No matching key. session topic doesn\'t exist: abc');
      if (f.reject) throw Object.assign(new Error('User rejected.'), { code: 5000 });
      return `0x${'11'.repeat(32)}`;
    }
    throw new Error(`stand-in wallet: unexpected ${method}`);
  },
  on(e, fn) { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e)!.add(fn); return provider; },
  removeListener(e, fn) { listeners.get(e)?.delete(fn); return provider; },
  get session() {
    // always list the stand-in’s account on its chain (the app requires the session and eth_accounts to agree on VYRE)
    return {
      expiry: w.__fake.expiry ?? Math.floor(Date.now() / 1000) + 86_400,
      namespaces: { eip155: { accounts: [`eip155:${w.__fake.chain}:${w.__fake.account}`] } },
    };
  },
  async disconnect() { w.__disconnects++; },
} as unknown as WcProvider;

setWcDriver({
  start: ({ onUri, signal }) => new Promise<WcProvider>((resolve, reject) => {
    w.__starts++;
    w.__pair = { resolve: () => resolve(provider), reject };
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    setTimeout(() => onUri(URI), 0);
  }),
  restore: async () => (w.__restoreable ? provider : null),
});

function Page() {
  const { account, onVyre, provider: p } = useWallet();
  return (
    <main className="main narrow">
      <h1 className="h3">WalletConnect</h1>
      <ConnectButton />
      <p id="who">{account ?? 'none'}</p>
      <div id="trade">
        <TxButton label="Buy" run={async () => {
          const wallet = (await onVyre()) as unknown as WalletClient;
          const hash = await wallet.sendTransaction({ chain: VYRE_CHAIN, account: account as Address, to: PAD, data: '0xdeadbeef', value: 0n });
          w.__lastTrade = hash;
          return { hash, text: 'Sent.' };
        }} />
      </div>
      <div id="other">
        <TxButton label="Send from another account" run={async () => {
          if (!p) throw new Error('Connect a wallet first.');
          await p.request({ method: 'eth_sendTransaction', params: [{ from: OTHER, to: PAD, data: '0x' }] } as never);
          return { text: 'Sent.' };
        }} />
      </div>
      <div id="arc">
        <TxButton label="Move on Arc" run={async () => {
          const { switchTo, ARC_CHAIN } = await import('../../src/lib/chain');
          if (!p) throw new Error('Connect a wallet first.');
          await switchTo(p, ARC_CHAIN);
          return { text: 'Switched.' };
        }} />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<WalletProvider><Page /><WalletConnectSheet /></WalletProvider>);
