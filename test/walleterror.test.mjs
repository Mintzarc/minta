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

test('a wallet that cannot send what the page just simulated is reported as that, with its own words, and never as a contract revert', async () => {
  for (const [answer, words] of [
    [{ code: -32603, message: 'Internal JSON-RPC error. insufficient funds for gas * price + value' }, 'Internal JSON-RPC error. insufficient funds for gas * price + value'],
    [{ code: 3, message: 'execution reverted' }, 'execution reverted'],
    [{ code: -32000, message: 'transaction underpriced' }, 'transaction underpriced'],
    [{ code: -32603, message: 'Something went wrong.\nPlease try again later' }, 'Something went wrong. Please try again later'],
  ]) {
    const e = await sendErr(answer);
    const said = W.walletSendFailure(e);
    assert.equal(said, `Your wallet couldn’t send this: ${words}. Nothing was sent.`, JSON.stringify(answer));
    if (answer.code !== 3) assert.equal(/revert/i.test(said), false, 'it is not called a revert');
    assert.equal(/contract function/i.test(said), false);
  }
  // the library's own first line is the one that used to be shown, with the reason cut off
  const e = await sendErr({ code: -32603, message: 'Internal JSON-RPC error. no balance' });
  assert.match(e.shortMessage.split('\n')[0], /reverted with the following reason:$/);
  // a wallet that gives no words at all
  assert.match(W.walletSendFailure(await sendErr({ code: -32603, message: '' })) ?? '', /^Your wallet couldn’t send this/);
});

test('a real revert is not called a wallet failure: from the page’s simulation, or from a wallet that gives the contract’s revert data', async () => {
  const data = encodeErrorResult({ abi, errorName: 'Error', args: ['ERC20: insufficient allowance'] });
  const sim = await failure(simulateContract(nodeThat({ code: 3, message: 'execution reverted: ERC20: insufficient allowance', data }), { ...call, account: ME }));
  assert.equal(W.walletSendFailure(sim), null, 'a simulation revert');
  assert.match(W.firstWords(sim.shortMessage), /reverted with the following reason: ERC20: insufficient allowance$/, 'and its reason is no longer cut off');
  const withData = await sendErr({ code: 3, message: 'execution reverted', data });
  assert.equal(W.walletSendFailure(withData), null, 'the wallet says it reverts and gives the data');
  assert.match(W.firstWords(withData.shortMessage), /ERC20: insufficient allowance/);
  // something that is not from a send at all
  assert.equal(W.walletSendFailure(new Error('the wallet is on chain 1')), null);
  assert.equal(W.walletSendFailure(null), null);
});

test('the first words of a message: one line, and the next line too when the first only announces it', () => {
  assert.equal(W.firstWords('It failed.\nDetails: x'), 'It failed.');
  assert.equal(W.firstWords('The contract function "approve" reverted with the following reason:\nno balance\n\nContract Call:\n  address: 0x1'), 'The contract function "approve" reverted with the following reason: no balance');
  assert.equal(W.firstWords('The contract function "approve" reverted with the following reason:\n\nContract Call:\n  address: 0x1'), 'The contract function "approve" reverted with the following reason:');
  assert.ok(W.firstWords('a'.repeat(500)).length <= 220);
});

test('a refusal in the wallet is recognised from a browser wallet (4001) and from WalletConnect (5000), at any depth', async () => {
  assert.equal(W.userRejected({ code: 4001 }), true);
  assert.equal(W.userRejected({ code: 5000, message: 'User rejected.' }), true);
  assert.equal(W.userRejected({ cause: { cause: { code: 5000 } } }), true);
  assert.equal(W.userRejected(await sendErr({ code: 5000, message: 'User rejected.' })), true);
  assert.equal(W.userRejected({ code: -32603 }), false);
  assert.equal(W.userRejected(null), false);
});

test('the page’s reason() uses these: a refusal first, then the wallet’s failure, then the first words (never only the first line)', () => {
  const chain = fs.readFileSync(new URL('../src/lib/chain.ts', import.meta.url), 'utf8');
  const body = chain.slice(chain.indexOf('export function reason('), chain.indexOf('\n}\n', chain.indexOf('export function reason(')));
  assert.ok(body.indexOf('userRejected(e)') < body.indexOf('walletSendFailure(e)') && body.indexOf('walletSendFailure(e)') < body.indexOf('firstWords(m)'));
  assert.equal(/split\('\\n'\)\[0\]/.test(body), false, 'no bare first line');
  // the notes for a sale that asks for an approval instead of a permit: plain, and nothing about gain
  for (const t of [W.PERMIT_UNSIGNED_NOTE, W.PERMIT_REFUSED_NOTE]) {
    assert.match(t, /approval of exactly this amount/);
    assert.equal(/earn|profit|reward|gain|revert/i.test(t), false);
  }
});
