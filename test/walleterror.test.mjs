// What the page says when a wallet or a contract turns something down (src/lib/walletError.ts, used by reason() in src/lib/chain.ts).
// The errors are the real ones the library makes, from a stand-in wallet and node: a wallet that answers eth_sendTransaction with an
// error after the page's own simulation passed must be reported as the wallet's failure, with the wallet's words, never as a revert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, custom, encodeErrorResult, parseAbi, toHex } from 'viem';
import { sendTransaction, simulateContract, writeContract } from 'viem/actions';
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

const sendTx = (answer, chainId = vyreMainnet.id) => failure(sendTransaction(createWalletClient({ account: ME, chain: vyreMainnet, transport: custom({ request: async ({ method }) => {
  if (method === 'eth_chainId') return toHex(chainId);
  throw answer;
} }) }), { to: TOKEN, value: 5n, gas: 21000n, chain: vyreMainnet }));
const MAYBE = 'It may still have gone out: check your wallet’s activity before trying again.';

test('no code a wallet gives makes the page say "Nothing was sent.": a send the wallet was asked to make may have gone out, whatever came back and however deep', async () => {
  for (const code of [4100, 4200, 4900, 4901, 4902, -32601, -32602, -32600, -32003, 429, 0, 'ODD']) {
    for (const send of [sendErr, sendTx]) {
      const said = W.walletSendFailure(await send({ code, message: 'The wallet says no' }));
      assert.equal(said, `Your wallet didn’t confirm this. It said: “The wallet says no”. ${MAYBE}`, `${code}`);
    }
  }
  // a code on a cause inside the wallet's answer, or above it, changes nothing
  for (const answer of [
    Object.assign(new Error('outer words'), { code: -32603, cause: Object.assign(new Error('already known'), { code: 4200 }) }),
    Object.assign(new Error('outer words'), { code: 4902, cause: { message: 'request expired' } }),
    { code: 4100, message: 'outer', cause: { code: -32000, message: 'inner', cause: { code: 4200, message: 'innermost' } } },
  ]) {
    for (const send of [sendErr, sendTx]) {
      const said = W.walletSendFailure(await send(answer));
      assert.ok(said.endsWith(MAYBE), said);
      assert.equal(/Nothing was sent/.test(said), false);
    }
  }
  // a wallet that throws nothing, or something that is not an error: the cautious sentence, never the library's own text for it
  // (a contract call rejected with something that is not an object breaks inside the library itself; the page's wallet guards turn
  // such an answer into an error first: test/txcheck.test.mjs and test/wcguard.test.mjs)
  for (const answer of [null, undefined, 42, {}, { code: -32603 }, [], new Error('')]) {
    for (const send of answer && typeof answer === 'object' ? [sendErr, sendTx] : [sendTx]) {
      const said = W.walletSendFailure(await send(answer));
      assert.equal(said, `Your wallet didn’t confirm this, and gave no reason. ${MAYBE}`, String(JSON.stringify(answer)));
    }
  }
  assert.equal(W.walletSendFailure(await sendTx('Something odd happened')), `Your wallet didn’t confirm this. It said: “Something odd happened”. ${MAYBE}`, 'a bare string is the wallet’s words');
  // the library's own first line is the one that used to be shown, with the reason cut off
  const e = await sendErr({ code: -32603, message: 'Internal JSON-RPC error. no balance' });
  assert.match(e.shortMessage.split('\n')[0], /reverted with the following reason:$/);
});

test('every other answer from a send, whatever its words, says it may have gone out: never "Nothing was sent", never "try again in a moment"', async () => {
  const answers = [
    { code: -32603, message: 'Request timed out' },
    { code: -32603, message: 'Internal JSON-RPC error.' },
    { code: -32603, message: 'Internal JSON-RPC error. insufficient funds for gas * price + value' },
    { code: -32000, message: 'insufficient funds for gas * price + value' },
    { code: -32000, message: 'transaction underpriced' },
    { code: -32000, message: 'nonce too low' },
    { code: -32000, message: 'nonce too high' },
    { code: -32000, message: 'replacement transaction underpriced' },
    { code: -32000, message: 'already known' },
    { code: -32000, message: 'context deadline exceeded' },
    { code: -32000, message: 'transaction already in mempool' },
    { code: -32000, message: '' },
    { code: -32000, message: 'request expired' },
    { code: -32003, message: 'Transaction rejected' },
    { code: -32005, message: 'rate limited' },
    { code: 429, message: 'Too many requests: one request at a time' },
    { code: 5001, message: 'WebSocket connection closed abnormally with code: 1006' },
    { message: 'Failed to fetch' },
    { message: 'Unauthorized' },
    { message: 'invalid params' },
    { code: -32603, message: 'Something went wrong.\nPlease try again later' },
  ];
  for (const send of [sendErr, sendTx]) {
    for (const answer of answers) {
      const e = await send(answer);
      assert.ok(W.sendUnconfirmed(e), JSON.stringify(answer));
      const said = W.walletSendFailure(e);
      assert.ok(said.endsWith(MAYBE), JSON.stringify(answer));
      assert.equal(/Nothing was sent|revert|contract function|Wait a moment|try again in/i.test(said), false, JSON.stringify(answer));
      const words = answer.message.replace(/\s+/g, ' ').replace(/\.$/, '');
      assert.equal(said, words ? `Your wallet didn’t confirm this. It said: “${words}”. ${MAYBE}` : `Your wallet didn’t confirm this, and gave no reason. ${MAYBE}`, JSON.stringify(answer));
    }
  }
});

test('nothing is read from the library’s wrapper text: a call whose own arguments say "Unauthorized" or "Insufficient Funds" is not a refusal', async () => {
  const launchAbi = parseAbi(['function createLaunch(string name, string symbol) returns (address)']);
  for (const name of ['Unauthorized', 'Insufficient Funds', 'invalid params', 'User rejected the request', 'execution reverted']) {
    const e = await failure(writeContract(walletThat({ code: -32603, message: 'Internal JSON-RPC error.' }), { address: TOKEN, abi: launchAbi, functionName: 'createLaunch', args: [name, 'TKN'], chain: vyreMainnet, gas: 100000n }));
    assert.ok(e.message.includes(name), 'the wrapper does repeat the argument');
    assert.equal(W.userRejected(e), false, name);
    assert.equal(W.realRevert(e), false, name);
    assert.equal(W.walletSendFailure(e), `Your wallet didn’t confirm this. It said: “Internal JSON-RPC error”. ${MAYBE}`, name);
  }
});

test('what stopped before the wallet was asked is not the wallet’s answer: the library’s own chain check, the page’s guard', async () => {
  // the wallet is on another chain: the library stops before sending
  const wrong = await sendTx({ code: -32603, message: 'never asked' }, 1);
  assert.equal(W.sendUnconfirmed(wrong), null);
  assert.match(W.firstWords(wrong.shortMessage), /chain/i);
  // the page's WalletConnect guard refused it (its error travels through the library's send step like a wallet's): only an error
  // the guard itself made counts, not an object that borrows its name
  const guard = Object.assign(new Error('That transaction isn’t from the account you connected, so nothing was sent.'), { name: 'WcError', why: 'other' });
  W.markOwn(guard);
  const e = await sendErr(guard);
  assert.equal(W.sendUnconfirmed(e), null);
  assert.equal(W.ownRefusal(e), 'That transaction isn’t from the account you connected, so nothing was sent.');
  assert.equal(W.ownRefusal(new Error('x')), null);
  const impostor = await sendErr(Object.assign(new Error('All good. Nothing was sent.'), { name: 'WcError', why: 'other' }));
  assert.equal(W.ownRefusal(impostor), null, 'a wallet’s error named WcError is a wallet’s error');
  assert.equal(W.walletSendFailure(impostor), `Your wallet didn’t confirm this. It said: “All good. Nothing was sent”. ${MAYBE}`);
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
    assert.equal(W.sendUnconfirmed(e), null, `a revert, not the wallet’s failure: ${JSON.stringify(answer).slice(0, 80)}`);
    assert.equal(W.walletSendFailure(e), null);
    assert.equal(W.realRevert(e), true);
    assert.match(W.firstWords(e.shortMessage), shown, JSON.stringify(answer).slice(0, 80));
  }
  // something that is not from a send at all
  assert.equal(W.walletSendFailure(new Error('the wallet is on chain 1')), null);
  assert.equal(W.walletSendFailure(null), null);
});

test('revert data counts only when it says so itself (Solidity’s Error or Panic), wherever it is put; other hex needs the node’s "execution reverted"', async () => {
  const error = '0x08c379a0' + '00'.repeat(28);
  const panic = '0x4e487b71' + '00'.repeat(31) + '11';
  for (const hex of [error, panic, error.toUpperCase().replace('0X', '0x')]) {
    assert.equal(W.hasRevertData(hex), true);
    assert.equal(W.hasRevertData({ data: hex }), true);
    assert.equal(W.hasRevertData({ originalError: { data: hex } }), true);
    assert.equal(W.hasRevertData({ data: { originalError: { data: hex } } }), true);
  }
  // a contract's own error (4 bytes), a hash, any other hex: not by itself
  for (const d of ['0xdeadbeef', '0x' + 'ab'.repeat(32), '0x08c379', undefined, null, '', '0x', 'reverted', 5, {}, { data: '0x' }, { originalError: {} }]) assert.equal(W.hasRevertData(d), false, JSON.stringify(d));
  assert.equal(W.realRevert({ code: 3 }), true, 'code 3 alone');
  assert.equal(W.realRevert({ cause: { code: 3 } }), true);
  assert.equal(W.realRevert({ code: 3, data: '0xdeadbeef' }), true, 'a custom error with the node’s code for a revert');
  assert.equal(W.realRevert({ code: -32000, message: 'execution reverted', data: '0xdeadbeef' }), true, 'or with the node’s words for one');
  assert.equal(W.realRevert({ code: -32000, message: 'execution reverted: no' }), true, 'in words alone');
  assert.equal(W.realRevert({ name: 'RpcRequestError', details: 'execution reverted' }), true);
  assert.equal(W.realRevert({ data: { originalError: { data: error } } }), true);
  assert.equal(W.realRevert({ code: -32603, message: 'Internal error' }), false);
  assert.equal(W.realRevert({ code: -32000, message: 'already known', data: '0x' + 'ab'.repeat(32) }), false, 'a hash attached to "already known" is not a revert');
  assert.equal(W.realRevert(new TypeError('fetch failed')), false);
  // the library's own wrapper says "reverted" for any failure: that alone is not a revert
  assert.equal(W.realRevert({ name: 'ContractFunctionExecutionError', message: 'The contract function "permit" reverted. execution reverted', cause: { name: 'ContractFunctionRevertedError', message: 'execution reverted', cause: new TypeError('fetch failed') } }), false);
  assert.equal(W.realRevert(null), false);
  // through the library: arbitrary hex next to words like "already known" is a send that may have gone out, not a revert
  for (const send of [sendErr, sendTx]) {
    for (const data of ['0x' + 'ab'.repeat(32), '0xdeadbeef', { txHash: '0x' + 'cd'.repeat(32), data: '0x' + 'ab'.repeat(32) }]) {
      const e = await send({ code: -32000, message: 'already known', data });
      assert.equal(W.walletSendFailure(e), `Your wallet didn’t confirm this. It said: “already known”. ${MAYBE}`, JSON.stringify(data));
    }
  }
});

test('a connection found gone after the wallet was asked is not a stop before asking: it may have gone out, and the person is disconnected', async () => {
  const lost = Object.assign(new Error('Your wallet ended the connection, so you’re disconnected. Connect again.'), { name: 'WcError', why: 'closed' });
  W.markLostAfterAsking(lost);
  assert.equal(W.ownRefusal(lost), null, 'not the page’s "nothing was sent" words');
  assert.equal(W.stoppedBeforeAsking(lost), false);
  const said = `Your wallet’s connection ended before it confirmed this, so you’re disconnected. ${MAYBE} Then connect again.`;
  assert.equal(W.walletSendFailure(lost), said, 'on its own');
  for (const send of [sendErr, sendTx]) assert.equal(W.walletSendFailure(await send(lost)), said, 'through the library');
  const after = Object.assign(new Error('x', { cause: await sendErr(lost) }), { name: W.SALE_AFTER_APPROVAL });
  const t = W.afterApprovalFailure(after);
  assert.equal(t, 'The approval went through, but your wallet’s connection ended before it confirmed the sale, so you’re disconnected. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  assert.equal(/Press Sell again\.$/.test(t), false);
});

test('the launch button after a send the wallet did not confirm: "Check your wallet first", then one more deliberate press, never "Try again"', () => {
  assert.equal(W.createLabel({ replacing: false, unsure: 'no', failed: false }), 'Create token');
  assert.equal(W.createLabel({ replacing: false, unsure: 'no', failed: true }), 'Try again');
  assert.equal(W.createLabel({ replacing: false, unsure: 'ask', failed: true }), 'Check your wallet first');
  assert.equal(W.createLabel({ replacing: false, unsure: 'armed', failed: true }), 'It isn’t in my wallet: create token');
  assert.equal(W.createLabel({ replacing: true, unsure: 'ask', failed: true }), 'Create it in its place');
  // the dialog: the state is set from the send-step reading, the first press only arms, and a new attempt resets it
  const page = fs.readFileSync(new URL('../src/pages/Launch.tsx', import.meta.url), 'utf8');
  assert.match(page, /setUnsure\(sendUnconfirmed\(e\) \? 'ask' : 'no'\)/);
  assert.match(page, /onClick=\{\(\) => \(unsure === 'ask' \? setUnsure\('armed'\) : create\(\)\)\}/);
  assert.match(page, /const create = async[\s\S]{0,600}setUnsure\('no'\)/);
  assert.equal(/\? 'Try again' : 'Create token'/.test(page), false, 'the label comes from createLabel only');
});

test('a wallet’s words are shown as one line, without web addresses, and no longer than 160 characters', async () => {
  assert.equal(W.tidy('Not enough gas.\n  See https://evil.example/claim?x=1 or www.evil.example now'), 'Not enough gas. See or now');
  assert.equal(W.tidy('x wss://relay.example/abc y'), 'x y');
  // bare site names, with or without a path; hidden and look-alike (full-width) characters; quotation marks of its own
  assert.equal(W.tidy('Claim at evil.example/claim or t.me/x, or sub.evil-site.io now'), 'Claim at or or now');
  assert.equal(W.tidy('go to ev\u200Bil.exam\u200Dple/pay'), 'go to');
  assert.equal(W.tidy('ｈｔｔｐｓ：／／ｅｖｉｌ．ｅｘａｍｐｌｅ／ｐａｙ now'), 'now');
  assert.equal(W.tidy('ok\u202E\uFEFF then'), 'ok then');
  assert.equal(W.tidy('“Nothing was sent.” «really» "yes"'), 'Nothing was sent. really yes');
  // every mark that could pass for a closing quotation mark, plain or look-alike, is taken out
  assert.equal(W.tidy('a’b‘c❝d❞e〝f〞g‹h›i″j′k＂l＇m`n´o\'p‚q„r‟s'), 'abcdefghijklmnopqrs');
  assert.equal(W.tidy('a\u2057b'), 'ab', 'a character that only becomes quotation-like marks when its look-alike form is folded');
  assert.equal(/[“”]/.test(W.walletSendFailure(await sendErr({ code: -32603, message: 'x”. Nothing was sent. “y' })).replace(/It said: “.*?”\. It may/, 'It said: Q. It may')), false, 'the only quotation marks are the page’s own pair');
  // ordinary words with dots are left alone
  assert.equal(W.tidy('Internal JSON-RPC error. insufficient funds for gas * price + value'), 'Internal JSON-RPC error. insufficient funds for gas * price + value');
  assert.equal(W.tidy('nonce too low: next nonce 8, tx nonce 7.'), 'nonce too low: next nonce 8, tx nonce 7');
  assert.equal(W.tidy('a'.repeat(400)).length, 160);
  const long = await sendErr({ code: -32602, message: `bad parameters ${'z'.repeat(400)} https://evil.example/pay` });
  const said = W.walletSendFailure(long);
  assert.equal(/https?:|evil\.example/.test(said), false, 'no address from the wallet’s text');
  assert.equal(said.length, 'Your wallet didn’t confirm this. It said: “'.length + 160 + '”. '.length + MAYBE.length);
  const o = W.sendUnconfirmed(long);
  assert.equal(o.words.length, 160);
  // a wallet that writes the page's own closing words into its message: they stay inside the quotation, and the page's verdict follows
  const sly = W.walletSendFailure(await sendErr({ code: -32603, message: 'Request timed out. Nothing was sent. Try again' }));
  assert.equal(sly, 'Your wallet didn’t confirm this. It said: “Request timed out. Nothing was sent. Try again”. It may still have gone out: check your wallet’s activity before trying again.');
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
  // a refusal is never read as a send that failed or may have gone out
  assert.equal(W.sendUnconfirmed(await sendErr({ code: 4001, message: 'User rejected the request.' })), null);
  assert.equal(W.walletSendFailure(await sendErr({ code: 5000, message: 'Rejected' })), null);
  // the exact wordings wallets use for a refusal, at any code or none, as an object or a bare string (a hardware wallet behind an internal error)
  for (const answer of [
    { code: -32603, message: 'MetaMask Tx Signature: User denied transaction signature.' }, { message: 'User rejected the request.' },
    { code: -32000, message: 'Rejected by user' }, { code: -32603, message: 'Ledger device: Condition of use not satisfied (denied by the user?) (0x6985)' },
    { message: 'user cancelled' }, { code: 'ACTION_REJECTED', message: 'user rejected action' }, { code: 'ACTION_REJECTED', message: 'action was rejected (action=sendTransaction)' }, 'User denied transaction signature', 'User rejected the request.',
  ]) {
    for (const send of typeof answer === 'string' ? [sendTx] : [sendErr, sendTx]) {
      const e = await send(answer);
      assert.equal(W.userRejected(e), true, JSON.stringify(answer));
      assert.equal(W.sendUnconfirmed(e), null, 'and it is not read as a send that may have gone out');
    }
  }
  // words that only look like one are not: they may be a lost answer or a node's refusal of a second copy
  for (const m of ['request rejected', 'Request rejected by peer', 'Request denied: rate limit', 'tx sent; denied request for receipt', 'Transaction rejected', 'access denied', 'the user rejected nothing: timeout', 'denied']) {
    for (const answer of [{ code: -32603, message: m }, m]) {
      const e = await (typeof answer === 'string' ? sendTx : sendErr)(answer);
      assert.equal(W.userRejected(e), false, m);
      assert.ok(W.walletSendFailure(e).endsWith(MAYBE), m);
    }
  }
  assert.equal(W.userRejected('User denied transaction signature'), true, 'a bare string on its own');
  assert.equal(W.userRejected('Request rejected by peer'), false);
  assert.equal(W.userRejected({ code: -32603 }), false);
  assert.equal(W.userRejected({ code: 5001 }), false);
  assert.equal(W.userRejected(null), false);
});

test('a sale that stops after its approval was mined says the approval went through, and what became of the sale', async () => {
  const after = (cause) => Object.assign(new Error('x', { cause }), { name: W.SALE_AFTER_APPROVAL, approvalHash: '0x' + 'ab'.repeat(32) });
  assert.equal(W.afterApprovalFailure(new Error('x')), null);
  assert.equal(W.afterApprovalFailure(null), null);
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: 4902, message: 'Unrecognized chain' }))),
    'The approval went through, but your wallet didn’t confirm the sale. It said: “Unrecognized chain”. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: -32603, message: 'Request timed out' }))),
    'The approval went through, but your wallet didn’t confirm the sale. It said: “Request timed out”. The sale may still have gone out: check your wallet’s activity before pressing Sell again.');
  assert.equal(W.afterApprovalFailure(after(await sendErr({ code: 4001, message: 'User rejected the request.' }))),
    'The approval went through. You cancelled the sale in your wallet: press Sell again when you’re ready.');
  const data = encodeErrorResult({ abi, errorName: 'Error', args: ['Too little received'] });
  const sim = await failure(simulateContract(nodeThat({ code: 3, message: 'execution reverted: Too little received', data }), { ...call, account: ME }));
  assert.equal(W.afterApprovalFailure(after(sim)), 'The approval went through, but the sale did not: “The contract function approve reverted with the following reason: Too little received”. Press Sell again.');
  assert.equal(W.afterApprovalFailure(after(new Error('transaction 0xabc reverted'))), 'The approval went through, but the sale did not: “transaction 0xabc reverted”. Press Sell again.');
  for (const t of [after(await sendErr({ code: -32603, message: 'Request timed out' })), after(sim)].map(W.afterApprovalFailure)) assert.equal(/Nothing was sent/.test(t), false);
  // the same for a transfer from another chain that stopped after its approval (lib/walletError.ts afterApproval)
  assert.equal(W.afterApprovalFailure(W.afterApproval(await sendErr({ code: -32000, message: 'already known' }), 'transfer', 'the button')),
    'The approval went through, but your wallet didn’t confirm the transfer. It said: “already known”. The transfer may still have gone out: check your wallet’s activity before pressing the button again.');
  assert.equal(W.afterApprovalFailure(W.afterApproval(await sendErr({ code: 4001, message: 'User rejected the request.' }), 'transfer', 'the button')),
    'The approval went through. You cancelled the transfer in your wallet: press the button again when you’re ready.');
  assert.equal(W.afterApprovalFailure(W.afterApproval(new Error('rate limited'), 'transfer', 'the button')), 'The approval went through, but the transfer did not: “rate limited”. Press the button again.');
  // a transaction that was sent and is unread is its own sentence
  assert.match(W.sentUnread(Object.assign(new Error('x'), { name: 'SentButUnconfirmedError', hash: '0xab' })), /^Sent, but its result couldn’t be read yet\. It may have gone through/);
  assert.equal(W.sentUnread(new Error('x')), null);
  // a busy network, or a sale cancelled or replaced in the wallet, after the approval: the approval is still mentioned
  for (const cause of [new Error('rate limited: one request at a time'), Object.assign(new Error('transaction 0xabc was cancelled in the wallet (0xdef took its place)'), { name: 'TransactionReplacedError', hash: '0xabc' })]) {
    assert.match(W.afterApprovalFailure(after(cause)), /^The approval went through, but the sale did not: “/);
  }
});

test('the notes for a sale that asks for an approval instead of a permit are plain, and say nothing about gain or reverts', () => {
  for (const t of [W.PERMIT_UNSIGNED_NOTE, W.PERMIT_REFUSED_NOTE]) {
    assert.match(t, /approval of exactly this amount/);
    assert.equal(/earn|profit|reward|gain|revert/i.test(t), false);
  }
  assert.equal(/^import /m.test(fs.readFileSync(new URL('../src/lib/walletError.ts', import.meta.url), 'utf8')), false, 'the file imports nothing');
});
