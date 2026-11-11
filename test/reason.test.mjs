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
const { sendTransaction } = require('viem/actions');
const sendPlain = (answer) => sendTransaction(createWalletClient({ account: ME, chain, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(chain.id);
  throw answer;
} }) }), { to: '0x1111111111111111111111111111111111111111', value: 5n, gas: 21000n, chain }).then(() => { throw new Error('it did not fail'); }, (e) => e);
const sendErr = (answer) => writeContract(createWalletClient({ account: ME, chain, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(chain.id);
  throw answer;
} }) }), { address: '0x1111111111111111111111111111111111111111', abi, functionName: 'approve', args: [ME, 5n], chain, gas: 100000n }).then(() => { throw new Error('it did not fail'); }, (e) => e);

test('reason(): the wallet’s refusal, a send that may have gone out, a revert, a cancel, and a plain message each read as what they are', async () => {
  const MAYBE = 'It may still have gone out: check your wallet’s activity before trying again.';
  // no code makes it "Nothing was sent."
  for (const code of [4902, 4100, 4200, -32601, -32602]) assert.equal(C.reason(await sendErr({ code, message: 'Unrecognized chain ID' })), `Your wallet didn’t confirm this. It said: “Unrecognized chain ID”. ${MAYBE}`);
  // words prove nothing: an internal error that speaks of funds may still have gone out
  assert.equal(C.reason(await sendErr({ code: -32603, message: 'Internal JSON-RPC error. insufficient funds for gas * price + value' })),
    `Your wallet didn’t confirm this. It said: “Internal JSON-RPC error. insufficient funds for gas * price + value”. ${MAYBE}`);
  // a plain transfer (the Wallet page's Send and Send back) is read by the same rule: a second send there is a second payment
  for (const m of ['already known', 'rate limited', 'Request exceeds defined limit', 'one request at a time', 'nonce too low', 'Request timed out', 'replacement underpriced']) {
    const t = C.reason(await sendPlain({ code: -32000, message: m }));
    assert.equal(t, `Your wallet didn’t confirm this. It said: “${m}”. ${MAYBE}`, m);
    assert.equal(/nothing was sent|try again in|Wait a moment/i.test(t), false, m);
  }
  assert.equal(C.reason(await sendPlain({ code: 4001, message: 'User rejected the request.' })), 'Cancelled in your wallet.');
  assert.equal(C.reason(await sendPlain({ code: -32602, message: 'Bad arguments' })), `Your wallet didn’t confirm this. It said: “Bad arguments”. ${MAYBE}`);
  // a hardware wallet's refusal behind an internal error, or with no code: a cancel, not "may have gone out"
  assert.equal(C.reason(await sendErr({ code: -32603, message: 'MetaMask Tx Signature: User denied transaction signature.' })), 'Cancelled in your wallet.');
  assert.equal(C.reason(await sendPlain({ message: 'User denied transaction signature' })), 'Cancelled in your wallet.');
  // the page's own guard refused it before the wallet was asked: its own words, not quoted as a wallet's
  const guard = Object.assign(new Error('That request is for another network. This connection works on VYRE only, so nothing was sent.'), { name: 'WcError', why: 'chain' });
  W.markOwn(guard); // as lib/wc.ts does for the errors it makes
  // an object that only borrows the name is a wallet's answer like any other
  assert.equal(C.reason(await sendErr(Object.assign(new Error('Fine. Nothing was sent.'), { name: 'WcError' }))), `Your wallet didn’t confirm this. It said: “Fine. Nothing was sent”. ${MAYBE}`);
  // bare strings: the wallet's refusal reads as a cancel, anything else as its words
  assert.equal(C.reason('User denied transaction signature'), 'Cancelled in your wallet.');
  assert.equal(C.reason(await sendPlain('User rejected the request.')), 'Cancelled in your wallet.');
  assert.equal(C.reason(await sendPlain(null)), `Your wallet didn’t confirm this, and gave no reason. ${MAYBE}`, 'never the library’s internal text');
  // words that only look like a refusal are not one
  for (const m of ['Request rejected by peer', 'Request denied: rate limit', 'tx sent; denied request for receipt', 'request rejected']) {
    assert.equal(C.reason(await sendPlain({ code: -32603, message: m })), `Your wallet didn’t confirm this. It said: “${m}”. ${MAYBE}`, m);
  }
  // an error from the send step never reaches the Face ID or busy-network readings, whatever it carries: with revert data it is a
  // revert with its reason; without, the cautious sentence
  const data = '0x08c379a0' + '0000000000000000000000000000000000000000000000000000000000000020' + '0000000000000000000000000000000000000000000000000000000000000002' + '6e6f000000000000000000000000000000000000000000000000000000000000';
  for (const m of ['rate limited', 'already known', 'does not have sufficient funds', 'The operation either timed out or was not allowed', 'AA25 invalid account nonce']) {
    const withData = C.reason(await sendErr({ code: -32603, message: m, data }));
    assert.match(withData, /^The contract function "approve" reverted with the following reason: no$/, m);
    for (const send of [sendErr, sendPlain]) {
      const t = C.reason(await send({ code: -32603, message: m }));
      assert.equal(t, `Your wallet didn’t confirm this. It said: “${m}”. ${MAYBE}`, m);
    }
  }
  // a transaction that was sent and is unread, even from a caller that forgot to keep it: never "busy ... nothing was sent"
  const unread = Object.assign(new Error('sent, but unconfirmed', { cause: new Error('rate limited: one request at a time') }), { name: 'SentButUnconfirmedError', hash: '0x' + 'ab'.repeat(32) });
  assert.match(C.reason(unread), /^Sent, but its result couldn’t be read yet\. It may have gone through: check it/);
  assert.equal(/nothing was sent|busy/i.test(C.reason(unread)), false);
  assert.equal(C.reason(await sendErr(guard)), 'That request is for another network. This connection works on VYRE only, so nothing was sent.');
  assert.equal(C.reason(guard), guard.message);
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
  assert.equal(C.reason(after(await sendErr({ code: 4100, message: 'Not authorized' }))),
    'The approval went through, but your wallet didn’t confirm the sale. It said: “Not authorized”. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  // a transfer from another chain that stopped after its approval reads the same way
  assert.equal(C.reason(W.afterApproval(await sendErr({ code: -32000, message: 'rate limited' }), 'transfer', 'the button')),
    'The approval went through, but your wallet didn’t confirm the transfer. It said: “rate limited”. The transfer may still have gone out: check your wallet’s activity before pressing the button again.');
  // a busy network after the approval: never "so nothing was sent" (the approval was)
  for (const m of ['rate limited', 'Request exceeds defined limit', 'busy: try again', 'one request at a time']) {
    const t = C.reason(after(new Error(m)));
    assert.match(t, /^The approval went through, but the sale did not: “/, m);
    assert.equal(/nothing was sent/i.test(t), false, m);
  }
  assert.equal(C.reason(after(await sendErr({ code: 4001, message: 'User rejected the request.' }))),
    'The approval went through. You cancelled the sale in your wallet: press Sell again when you’re ready.', 'not just "Cancelled in your wallet."');
});
