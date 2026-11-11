// reason() in src/lib/chain.ts, run for real (the file is loaded with stand-ins for what needs a browser or a network; its own
// code and lib/walletError.ts are the real ones): what the page says for a refusal, a send the wallet could not make, a send whose
// answer may have been lost, a revert, and a sale that stopped after its approval went through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjs = (f) => ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const load = (code, req) => { const m = { exports: {} }; new Function('require', 'module', 'exports', code)(req, m, m.exports); return m.exports; };
const W = load(cjs(new URL('../src/lib/walletError.ts', import.meta.url)), () => { throw new Error('no imports'); });
const viem = require('viem');
const chainOf = (id, name) => ({ id, name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.example'] } }, blockExplorers: { default: { name: 'x', url: 'https://explorer.example' } }, contracts: { multicall3: { address: '0x5555555555555555555555555555555555555555' } } });
const stubs = {
  './walletError': W, viem, '@vyrechain/sdk': { cctpSource: () => null },
  './network': { NETWORK: { name: 'mainnet', testnet: false, vyre: chainOf(3045, 'VYRE Mainnet'), arc: chainOf(5042, 'Arc'), api: 'https://api.example', label: 'VYRE Mainnet' } },
  './format': { tokenText: (t) => t }, './fetchSplit': { fetchSplit: () => fetch }, './transport': { vyreTransport: () => viem.http('https://rpc.example') },
  './api': { API_URL: 'https://api.example' }, './txcheck': { guardProvider: (p) => p, wasCancelledByCheck: () => false },
};
const code = cjs(new URL('../src/lib/chain.ts', import.meta.url)).replace(/import\.meta\.env\.[A-Z_]+/g, 'undefined').replace(/import\.meta\.env/g, '({})');
globalThis.window ??= { addEventListener() {}, dispatchEvent() {}, location: { origin: 'https://minta.vyrechain.com' } };
const C = load(code, (id) => { if (!(id in stubs)) throw new Error('unexpected import ' + id); return stubs[id]; });

const { createWalletClient, custom, toHex, parseAbi } = viem;
const { writeContract } = require('viem/actions');
const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const abi = parseAbi(['function approve(address spender, uint256 value) returns (bool)']);
const chain = stubs['./network'].NETWORK.vyre;
const sendErr = (answer) => writeContract(createWalletClient({ account: ME, chain, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(chain.id);
  throw answer;
} }) }), { address: '0x1111111111111111111111111111111111111111', abi, functionName: 'approve', args: [ME, 5n], chain, gas: 100000n }).then(() => { throw new Error('it did not fail'); }, (e) => e);

test('reason(): the wallet’s refusal, a send that may have gone out, a revert, a cancel, and a plain message each read as what they are', async () => {
  assert.equal(C.reason(await sendErr({ code: -32603, message: 'Internal JSON-RPC error. insufficient funds for gas * price + value' })),
    'Your wallet couldn’t send this. It said: “Internal JSON-RPC error. insufficient funds for gas * price + value”. Nothing was sent.');
  assert.equal(C.reason(await sendErr({ code: -32603, message: 'Request timed out' })),
    'Your wallet didn’t confirm this. It said: “Request timed out”. It may still have gone out: check your wallet’s activity before trying again.');
  assert.equal(C.reason(await sendErr({ code: 3, message: 'execution reverted: Too little received' })),
    'The contract function "approve" reverted with the following reason: execution reverted: Too little received');
  assert.equal(C.reason(await sendErr({ code: 4001, message: 'User rejected the request.' })), 'Cancelled in your wallet.');
  assert.equal(C.reason(await sendErr({ code: 5000, message: 'Rejected' })), 'Cancelled in your wallet.');
  assert.equal(C.reason({ code: 5000, message: 'Rejected' }), 'Cancelled in your wallet.', 'a raw 5000 that never passed through the library');
  // "already known", a nonce the node says is used, a replacement turned down: from the send step these mean it may have gone out,
  // never "wait a moment, then try again"
  for (const m of ['already known', 'nonce too low', 'replacement transaction underpriced']) {
    const t = C.reason(await sendErr({ code: -32000, message: m }));
    assert.equal(t, `Your wallet didn’t confirm this. It said: “${m}”. It may still have gone out: check your wallet’s activity before trying again.`);
    assert.equal(/try again in|Wait a moment|Nothing was sent/i.test(t), false);
  }
  // the same words from somewhere that is not a send keep their own reading
  assert.equal(C.reason(new Error('already known')), 'Another transaction from this wallet is still going through. Wait a moment, then try again.');
  assert.equal(C.reason(new Error('first:\nsecond\nthird')), 'first: second');
  assert.equal(C.reason(new Error('only this\nnot this')), 'only this');
  assert.equal(C.reason(null), 'It stopped without saying why: check your wallet before trying again.');
});

test('reason(): a sale that stopped after its approval says the approval went through, before anything else is considered', async () => {
  const after = (cause) => Object.assign(new Error('the approval went through, but the sale did not', { cause }), { name: W.SALE_AFTER_APPROVAL, approvalHash: '0x' + 'ab'.repeat(32) });
  assert.equal(C.reason(after(await sendErr({ code: -32603, message: 'Request timed out' }))),
    'The approval went through, but your wallet didn’t confirm the sale. It said: “Request timed out”. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  assert.equal(C.reason(after(await sendErr({ code: -32000, message: 'insufficient funds for gas' }))),
    'The approval went through, but your wallet couldn’t send the sale. It said: “insufficient funds for gas”. The sale was not sent: press Sell again.');
  // a busy network after the approval: never "so nothing was sent" (the approval was)
  for (const m of ['rate limited', 'Request exceeds defined limit', 'busy: try again', 'one request at a time']) {
    const t = C.reason(after(new Error(m)));
    assert.match(t, /^The approval went through, but the sale did not: “/, m);
    assert.equal(/nothing was sent/i.test(t), false, m);
  }
  assert.equal(C.reason(after(await sendErr({ code: 4001, message: 'User rejected the request.' }))),
    'The approval went through. You cancelled the sale in your wallet: press Sell again when you’re ready.', 'not just "Cancelled in your wallet."');
});
