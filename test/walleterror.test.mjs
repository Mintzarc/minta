// What the page says when a wallet or a contract turns something down (src/lib/walletError.ts, used by reason() in src/lib/chain.ts).
// The errors are the real ones the library makes, from a stand-in wallet and node: a wallet that answers eth_sendTransaction with an
// error after the page's own simulation passed must be reported as the wallet's failure, with the wallet's words, never as a revert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, custom, encodeErrorResult, parseAbi, toHex } from 'viem';
import { simulateContract, writeContract } from 'viem/actions';
import { vyreMainnet } from '@vyrechain/sdk';
import * as W from '../src/lib/walletError.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TOKEN = '0x1111111111111111111111111111111111111111';
const abi = parseAbi(['function approve(address spender, uint256 value) returns (bool)', 'error Error(string)']);
const call = { address: TOKEN, abi, functionName: 'approve', args: [ME, 5n] };

const walletThat = (answer) => createWalletClient({ account: ME, chain: vyreMainnet, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(vyreMainnet.id);
  if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') throw answer;
  throw new Error(`the wallet was asked ${method}`);
} }) });
const nodeThat = (answer) => createPublicClient({ chain: vyreMainnet, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(vyreMainnet.id);
  if (method === 'eth_call') throw answer;
  throw new Error(`the node was asked ${method}`);
} }) });
const failure = (p) => p.then(() => { throw new Error('it did not fail'); }, (e) => e);
const sendErr = (answer) => failure(writeContract(walletThat(answer), { ...call, chain: vyreMainnet, gas: 100000n }));

test('a refusal that proves nothing was broadcast is reported with the wallet’s words and "Nothing was sent."', async () => {
  for (const [answer, words] of [
    [{ code: -32603, message: 'Internal JSON-RPC error. insufficient funds for gas * price + value' }, 'Internal JSON-RPC error. insufficient funds for gas * price + value'],
    [{ code: -32000, message: 'transaction underpriced' }, 'transaction underpriced'],
    [{ code: -32000, message: 'nonce too low' }, 'nonce too low'],
    [{ code: -32000, message: 'max fee per gas less than block base fee' }, 'max fee per gas less than block base fee'],
    [{ code: -32602, message: 'Bad arguments' }, 'Bad arguments'],
    [{ code: -32601, message: 'eth_sendTransaction is not available' }, 'eth_sendTransaction is not available'],
    [{ code: 4902, message: 'Unrecognized chain ID "0xbe5"' }, 'Unrecognized chain ID "0xbe5"'],
    [{ code: 4100, message: 'The requested account has not been authorized' }, 'The requested account has not been authorized'],
  ]) {
    const said = W.walletSendFailure(await sendErr(answer));
    assert.equal(said, `Your wallet couldn’t send this: ${words}. Nothing was sent.`, JSON.stringify(answer));
    assert.equal(/revert|contract function/i.test(said), false, 'it is not called a revert');
  }
  // the library's own first line is the one that used to be shown, with the reason cut off
  const e = await sendErr({ code: -32603, message: 'Internal JSON-RPC error. no balance' });
  assert.match(e.shortMessage.split('\n')[0], /reverted with the following reason:$/);
});

test('an answer that may only have been lost on its way back never says "Nothing was sent": it may have gone out', async () => {
  for (const answer of [
    { code: -32603, message: 'Request timed out' },
    { code: -32603, message: 'Internal JSON-RPC error.' },
    { code: -32000, message: 'request expired' },
    { code: 5001, message: 'WebSocket connection closed abnormally with code: 1006' },
    { message: 'Failed to fetch' },
    { code: -32603, message: 'Something went wrong.\nPlease try again later' },
    { code: -32000, message: 'already known' },
    { code: -32603, message: '' },
    // words of a refusal next to words of a lost answer: the lost answer wins
    { code: -32603, message: 'insufficient funds? request timed out before the wallet answered' },
  ]) {
    const said = W.walletSendFailure(await sendErr(answer));
    assert.match(said, /^Your wallet didn’t confirm this/, JSON.stringify(answer));
    assert.match(said, /It may still have gone out: check your wallet’s activity before trying again\.$/);
    assert.equal(/Nothing was sent|revert|contract function/i.test(said), false, JSON.stringify(answer));
    if (answer.message) assert.ok(said.includes(answer.message.replace(/\s+/g, ' ').replace(/\.$/, '').slice(0, 20)), 'with the wallet’s words');
  }
  assert.equal(W.walletSendFailure(await sendErr({ code: -32603, message: '' })), 'Your wallet didn’t confirm this, and gave no reason. It may still have gone out: check your wallet’s activity before trying again.');
});

test('a real revert is not blamed on the wallet: from the page’s simulation, or from the wallet’s node at send time, with data or only in words', async () => {
  const data = encodeErrorResult({ abi, errorName: 'Error', args: ['ERC20: insufficient allowance'] });
  const sim = await failure(simulateContract(nodeThat({ code: 3, message: 'execution reverted: ERC20: insufficient allowance', data }), { ...call, account: ME }));
  assert.equal(W.walletSendFailure(sim), null, 'a simulation revert');
  assert.match(W.firstWords(sim.shortMessage), /reverted with the following reason: ERC20: insufficient allowance$/, 'and its reason is no longer cut off');
  for (const [answer, shown] of [
    [{ code: 3, message: 'execution reverted', data }, /ERC20: insufficient allowance/],
    [{ code: -32603, message: 'Internal JSON-RPC error.', data: { data } }, /ERC20: insufficient allowance/], // data.data
    [{ code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { code: 3, data } } }, /reverted/], // data.originalError.data (the library does not decode it there: it still reads as a revert)
    [{ code: 3, message: 'execution reverted: Too little received' }, /reverted with the following reason: execution reverted: Too little received$/], // code 3, no data
    [{ code: -32000, message: 'execution reverted: Too little received' }, /Too little received/], // said in words only
    [{ code: 3, message: 'execution reverted' }, /reverted/],
  ]) {
    const e = await sendErr(answer);
    assert.equal(W.sendOutcome(e), null, `a revert, not the wallet’s failure: ${JSON.stringify(answer).slice(0, 80)}`);
    assert.equal(W.walletSendFailure(e), null);
    assert.equal(W.realRevert(e), true);
    assert.match(W.firstWords(e.shortMessage), shown, JSON.stringify(answer).slice(0, 80));
  }
  // something that is not from a send at all
  assert.equal(W.walletSendFailure(new Error('the wallet is on chain 1')), null);
  assert.equal(W.walletSendFailure(null), null);
});

test('revert data is found where nodes and wallets put it, and only real data counts; a node that fails did not say "reverted"', () => {
  const hex = '0x08c379a0' + '00'.repeat(28);
  assert.equal(W.hasRevertData(hex), true);
  assert.equal(W.hasRevertData({ data: hex }), true);
  assert.equal(W.hasRevertData({ originalError: { data: hex } }), true);
  assert.equal(W.hasRevertData({ data: { originalError: { data: hex } } }), true);
  for (const d of [undefined, null, '', '0x', 'reverted', 5, {}, { data: '0x' }, { originalError: {} }]) assert.equal(W.hasRevertData(d), false, JSON.stringify(d));
  assert.equal(W.realRevert({ code: 3 }), true, 'code 3 alone');
  assert.equal(W.realRevert({ cause: { code: 3 } }), true);
  assert.equal(W.realRevert({ code: -32000, message: 'execution reverted: no' }), true, 'in words alone');
  assert.equal(W.realRevert({ name: 'RpcRequestError', details: 'execution reverted' }), true);
  assert.equal(W.realRevert({ data: { originalError: { data: hex } } }), true);
  assert.equal(W.realRevert({ code: -32603, message: 'Internal error' }), false);
  assert.equal(W.realRevert(new TypeError('fetch failed')), false);
  // the library's own wrapper says "reverted" for any failure: that alone is not a revert
  assert.equal(W.realRevert({ name: 'ContractFunctionExecutionError', message: 'The contract function "permit" reverted. execution reverted', cause: { name: 'ContractFunctionRevertedError', message: 'execution reverted', cause: new TypeError('fetch failed') } }), false);
  assert.equal(W.realRevert(null), false);
});

test('a wallet’s words are shown as one line, without web addresses, and no longer than 160 characters', async () => {
  assert.equal(W.tidy('Not enough gas.\n  See https://evil.example/claim?x=1 or www.evil.example now'), 'Not enough gas. See or now');
  assert.equal(W.tidy('x wss://relay.example/abc y'), 'x y');
  assert.equal(W.tidy('a'.repeat(400)).length, 160);
  const long = await sendErr({ code: -32000, message: `insufficient funds ${'z'.repeat(400)} https://evil.example/pay` });
  const said = W.walletSendFailure(long);
  assert.equal(/https?:|evil\.example/.test(said), false, 'no address from the wallet’s text');
  assert.equal(said.length, 'Your wallet couldn’t send this: '.length + 160 + '. Nothing was sent.'.length);
  const o = W.sendOutcome(long);
  assert.equal(o.words.length, 160);
});

test('the first words of a message: one line, and the next line too when the first only announces it', () => {
  assert.equal(W.firstWords('It failed.\nDetails: x'), 'It failed.');
  assert.equal(W.firstWords('The contract function "approve" reverted with the following reason:\nno balance\n\nContract Call:\n  address: 0x1'), 'The contract function "approve" reverted with the following reason: no balance');
  assert.equal(W.firstWords('The contract function "approve" reverted with the following reason:\n\nContract Call:\n  address: 0x1'), 'The contract function "approve" reverted with the following reason:');
  assert.equal(W.firstWords('a'.repeat(500)).length, 220);
  assert.equal(W.firstWords(`x:\n${'b'.repeat(500)}`).length, 220);
});

test('a refusal in the wallet is recognised from a browser wallet (4001) and from WalletConnect (5000), raw or through the library, at any depth', async () => {
  assert.equal(W.userRejected({ code: 4001 }), true);
  assert.equal(W.userRejected({ code: 5000, message: 'Rejected' }), true, 'a raw 5000 that never passed through the library');
  assert.equal(W.userRejected({ cause: { cause: { code: 5000 } } }), true);
  assert.equal(W.userRejected({ name: 'UserRejectedRequestError' }), true);
  assert.equal(W.userRejected(await sendErr({ code: 5000, message: 'User rejected.' })), true);
  assert.equal(W.userRejected({ code: -32603 }), false);
  assert.equal(W.userRejected({ code: 5001 }), false);
  assert.equal(W.userRejected(null), false);
});

test('a sale that stops after its approval was mined says the approval went through, and what became of the sale', async () => {
  const after = (cause) => Object.assign(new Error('x', { cause }), { name: W.SALE_AFTER_APPROVAL, approvalHash: '0x' + 'ab'.repeat(32) });
  assert.equal(W.afterApprovalFailure(new Error('x')), null);
  assert.equal(W.afterApprovalFailure(null), null);
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: -32000, message: 'insufficient funds for gas' }))),
    'The approval went through, but your wallet couldn’t send the sale: insufficient funds for gas. The sale was not sent: press Sell again.');
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: -32603, message: 'Request timed out' }))),
    'The approval went through, but your wallet didn’t confirm the sale: Request timed out. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: 4001, message: 'User rejected the request.' }))),
    'The approval went through. You cancelled the sale in your wallet: press Sell again when you’re ready.');
  const data = encodeErrorResult({ abi, errorName: 'Error', args: ['Too little received'] });
  const sim = await failure(simulateContract(nodeThat({ code: 3, message: 'execution reverted: Too little received', data }), { ...call, account: ME }));
  assert.equal(W.afterApprovalFailure(after(sim)), 'The approval went through, but the sale did not: The contract function "approve" reverted with the following reason: Too little received. Press Sell again.');
  assert.equal(W.afterApprovalFailure(after(new Error('transaction 0xabc reverted'))), 'The approval went through, but the sale did not: transaction 0xabc reverted. Press Sell again.');
  for (const t of [after(await sendErr({ code: -32603, message: 'Request timed out' })), after(sim)].map(W.afterApprovalFailure)) assert.equal(/Nothing was sent/.test(t), false);
});

test('the notes for a sale that asks for an approval instead of a permit are plain, and say nothing about gain or reverts', () => {
  for (const t of [W.PERMIT_UNSIGNED_NOTE, W.PERMIT_REFUSED_NOTE]) {
    assert.match(t, /approval of exactly this amount/);
    assert.equal(/earn|profit|reward|gain|revert/i.test(t), false);
  }
  assert.equal(/^import /m.test(fs.readFileSync(new URL('../src/lib/walletError.ts', import.meta.url), 'utf8')), false, 'the file imports nothing');
});
