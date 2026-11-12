// A small page for the browser check of WalletConnect (test/walletconnect.browser.cjs; not part of the app, never built into it).
// It mounts the app's own wallet provider, connect button, connect sheet and transaction button, and replaces only what talks to
// the WalletConnect relay (setWcDriver) with a stand-in wallet the test controls through window.__fake / window.__pair / window.__emit.
// The stand-in is an EIP-1193 provider that records every request it is asked, and answers like the library's provider does
// (eth_chainId and eth_accounts from its own session).
import '../../src/styles.css';
import { createRoot } from 'react-dom/client';
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, toHex, type Address, type WalletClient } from 'viem';
import { quoterV2Abi, vyreTokenAbi } from '@vyrechain/sdk';
import * as v2 from '../../src/lib/padv2';
import { PERMIT_REFUSED_NOTE, PERMIT_UNSIGNED_NOTE } from '../../src/lib/walletError';
import { exact, parse, tradeLabel } from '../../src/lib/format';
import { WalletProvider, useWallet } from '../../src/lib/wallet';
import { ConnectButton, TxButton } from '../../src/components/ui';
import WalletConnectSheet from '../../src/components/WalletConnectSheet';
import { VYRE_CHAIN } from '../../src/lib/chain';
import { setWcDriver, type WcProvider } from '../../src/lib/wc';

const PAD: Address = '0x3333333333333333333333333333333333333333';
const OTHER: Address = '0x4444444444444444444444444444444444444444';
const URI = `wc:${'ab'.repeat(32)}@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=${'cd'.repeat(32)}`;

interface Fake { account: string; chain: number; reject: boolean; lost: boolean; expiry?: number; sessionAccount?: string; signError?: boolean; sendError?: { code: number; message: string }; sendErrorAfter?: number }
type W = {
  __fake: Fake; __sent: { method: string; params: unknown; chain?: string }[]; __asked: string[]; __starts: number; __disconnects: number;
  __pair: { resolve: () => void; reject: (e: unknown) => void } | null; __pairs: { resolve: () => void; reject: (e: unknown) => void }[]; __restoreable: boolean; __emit: (e: string, v: unknown) => void;
  __lastTrade: string; __notes: string[]; __sendsOk: number; __ids: { PAD: string; OTHER: string; URI: string };
};
const w = window as unknown as W;
w.__fake = { account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', chain: VYRE_CHAIN.id, reject: false, lost: false };
w.__sent = []; w.__asked = []; w.__starts = 0; w.__disconnects = 0; w.__pair = null; w.__pairs = []; w.__restoreable = false; w.__lastTrade = ''; w.__notes = []; w.__sendsOk = 0;
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
    if (method === 'eth_sendTransaction' || method === 'eth_signTypedData_v4') {
      w.__sent.push({ method, params, chain });
      if (f.lost) throw new Error('No matching key. session topic doesn\'t exist: abc');
      if (f.reject) throw Object.assign(new Error('User rejected.'), { code: 5000 });
      // a wallet that cannot sign typed data (not a refusal), and one that answers a send with an error of its own
      if (method === 'eth_signTypedData_v4' && f.signError) throw Object.assign(new Error('Method not supported'), { code: -32601 });
      // (after `sendErrorAfter` sends that went through, when that is set: an approval that is mined, then a sale that is not)
      if (method === 'eth_sendTransaction' && f.sendError && w.__sendsOk >= (f.sendErrorAfter ?? 0)) throw Object.assign(new Error(f.sendError.message), { code: f.sendError.code });
      if (method === 'eth_sendTransaction') w.__sendsOk++;
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
      namespaces: { eip155: { accounts: [`eip155:${w.__fake.chain}:${w.__fake.sessionAccount ?? w.__fake.account}`] } },
    };
  },
  async disconnect() { w.__disconnects++; },
} as unknown as WcProvider;

setWcDriver({
  start: ({ onUri, signal }) => new Promise<WcProvider>((resolve, reject) => {
    w.__starts++;
    w.__pair = { resolve: () => resolve(provider), reject };
    w.__pairs.push(w.__pair);
    // like the real library: cancelling does not stop a pairing, so a wallet can still approve it afterwards (signal is not used)
    void signal;
    setTimeout(() => onUri(URI), 0);
  }),
  restore: async () => (w.__restoreable ? provider : null),
});

// A stand-in node for a sale on the new pad: no allowance yet, a quote, and every simulation passes (so whatever stops a sale after
// that is the wallet's doing, not a contract's)
const TOKEN: Address = '0x1111111111111111111111111111111111111111';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const node = createPublicClient({ chain: VYRE_CHAIN, transport: custom({ request: async ({ method, params }: { method: string; params?: unknown }) => {
  switch (method) {
    case 'eth_chainId': return toHex(VYRE_CHAIN.id);
    case 'eth_blockNumber': return '0x10';
    case 'eth_getTransactionCount': return '0x1';
    case 'eth_estimateGas': return '0x7a120';
    case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': return '0x1';
    case 'eth_getBlockByNumber': return { number: '0x10', hash: `0x${'0c'.repeat(32)}`, timestamp: '0x6000', baseFeePerGas: '0x1', gasLimit: '0x1c9c380', transactions: [] };
    case 'eth_getTransactionByHash': return { hash: `0x${'11'.repeat(32)}`, from: w.__fake.account, nonce: '0x1', blockNumber: '0x5', blockHash: `0x${'0b'.repeat(32)}`, transactionIndex: '0x0', input: '0x', to: TOKEN, value: '0x0', gas: '0x1', gasPrice: '0x1', type: '0x0' };
    case 'eth_getTransactionReceipt': return { transactionHash: `0x${'11'.repeat(32)}`, transactionIndex: '0x0', blockHash: `0x${'0b'.repeat(32)}`, blockNumber: '0x5', from: w.__fake.account, to: TOKEN, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', status: '0x1', logs: [], logsBloom: `0x${'00'.repeat(256)}`, type: '0x0', contractAddress: null };
    case 'eth_call': {
      const { to, data, input } = (params as { to: string; data?: `0x${string}`; input?: `0x${string}` }[])[0];
      const d = (data ?? input)!;
      if (same(to, v2.PAD_V2.quoter)) return encodeFunctionResult({ abi: quoterV2Abi, functionName: 'quoteExactInputSingle', result: [50n * 10n ** 18n, 0n, 0, 0n] });
      if (same(to, v2.PAD_V2.swapRouter)) return encodeFunctionResult({ abi: v2.swapRouterAbi, functionName: 'multicall', result: [] });
      const f = decodeFunctionData({ abi: vyreTokenAbi, data: d });
      if (f.functionName === 'allowance') return encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'allowance', result: 0n });
      if (f.functionName === 'name') return encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'name', result: 'My Token' });
      if (f.functionName === 'nonces') return encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'nonces', result: 3n });
      if (f.functionName === 'approve') return encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'approve', result: true });
      return '0x';
    }
    default: throw new Error(`stand-in node: unexpected ${method}`);
  }
} }) });

function Page() {
  const { account, onVyre, provider: p, disconnect } = useWallet();
  return (
    <main className="main narrow">
      <h1 className="h3">WalletConnect</h1>
      <ConnectButton />
      <button id="force" onClick={disconnect}>Disconnect now</button>
      <p id="who">{account ?? 'none'}</p>
      <div id="trade">
        <TxButton label="Buy" run={async () => {
          const wallet = (await onVyre()) as unknown as WalletClient;
          const hash = await wallet.sendTransaction({ chain: VYRE_CHAIN, account: account as Address, to: PAD, data: '0xdeadbeef', value: 0n });
          w.__lastTrade = hash;
          return { hash, text: 'Sent.' };
        }} />
      </div>
      <div id="sell">
        <TxButton label="Sell" run={async (say) => {
          const wallet = await onVyre();
          const r = await v2.sell(wallet as never, node as never, { token: TOKEN, amountIn: 3n * 10n ** 18n, minUsdcOut: 1n }, (what) => {
            w.__notes.push(what);
            say(what === 'permit-unsigned' ? PERMIT_UNSIGNED_NOTE : PERMIT_REFUSED_NOTE);
          });
          return { hash: r.hash, text: 'Sold.' };
        }} />
      </div>
      {/* the trade panel's button on a narrow phone: the label the page makes for a long amount, and a worst case (every decimal, a long ticker) */}
      <div className="trade-card" id="narrow">
        <TxButton label={tradeLabel('sell', parse('11714096.582707705307803293'), 'MINTA')} run={async () => ({ text: 'x' })} />
        <TxButton label={`Sell ${exact(parse('11714096.582707705307803293')!)} ${'W'.repeat(28)}`} run={async () => ({ text: 'x' })} />
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
