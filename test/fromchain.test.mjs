// The "From another chain" form's errors after its burn was sent (src/lib/fromchain.ts), run by Node with the SDK's real
// burnToArc against stand-in chains and a stand-in fee service. A burn that may be on its way must come back as what the
// transaction button holds as Check it (src/components/ui.tsx: a SentButUnconfirmedError that isn't a Face ID operation), so a
// second press only reads the chain and never burns the same USDC again; a burn that reverted burned nothing and can be sent
// again. `npm test` here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPublicClient, createWalletClient, custom, encodeAbiParameters } from 'viem';
import { SentButUnconfirmedError, arcTestnet, burnToArc, cctpSource } from '@vyrechain/sdk';
import { burnSentError } from '../src/lib/fromchain.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SRC = cctpSource(84_532); // Base Sepolia
const FROM = { id: SRC.id, name: SRC.name };
const hash = (n) => `0x${n.toString(16).padStart(64, 'a')}`;
/** What the transaction button does with an error: hold it as Check it, or show it and re-arm (ui.tsx, TxButton) */
const held = (e) => e instanceof SentButUnconfirmedError && !e.userOperation;

// Circle's fee service, stand-in
const fees = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify([{ finalityThreshold: 1000, minimumFee: 1, forwardFee: { low: 20000, med: 20000, high: 20000 } }]));
});
await new Promise((ok) => fees.listen(0, '127.0.0.1', ok));
after(() => fees.close());
const url = `http://127.0.0.1:${fees.address().port}`;

const u256 = (v) => encodeAbiParameters([{ type: 'uint256' }], [v]);
/** A stand-in chain; `receipt` says what reading a sent transaction's receipt gives: 'busy' (the RPC refuses) or a status */
function chain(id, state) {
  return {
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_chainId': return `0x${id.toString(16)}`;
        case 'eth_getCode': return '0x';
        case 'eth_getBalance': return '0xde0b6b3a7640000';
        case 'eth_blockNumber': return '0x10';
        case 'eth_call': {
          const data = params[0].data || params[0].input || '';
          if (data.startsWith('0x70a08231')) return u256(10n ** 12n); // balanceOf
          if (data.startsWith('0xdd62ed3e')) return u256(10n ** 12n); // allowance: enough, so no approval
          return '0x';
        }
        case 'eth_estimateGas': return '0x30000';
        case 'eth_sendTransaction': state.sends++; return hash(state.sends);
        case 'eth_getTransactionReceipt':
        case 'eth_getTransactionByHash': {
          if (state.receipt === 'busy' || method === 'eth_getTransactionByHash') { const e = new Error('rate limited'); e.code = -32005; throw e; }
          return {
            blockHash: '0x' + '11'.repeat(32), blockNumber: '0x10', contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x989680',
            from: ME, gasUsed: '0x5208', logs: [], logsBloom: '0x' + '00'.repeat(256), status: state.receipt, to: ME, transactionHash: params[0],
            transactionIndex: '0x0', type: '0x2',
          };
        }
        default: throw new Error(`unexpected ${method}`);
      }
    },
  };
}

/** The form's send, as Wallet.tsx runs it: the burn's hash kept once sent, and what goes wrong after that turned by burnSentError */
async function send(state) {
  const t = (p) => custom(p, { retryCount: 0 });
  const src = createPublicClient({ chain: SRC.chain, transport: t(chain(SRC.id, state)), pollingInterval: 20 });
  const arc = createPublicClient({ chain: arcTestnet, transport: t(chain(arcTestnet.id, state)) });
  const wallet = createWalletClient({ account: ME, chain: SRC.chain, transport: t(chain(SRC.id, state)) });
  const sent = { hash: null };
  try {
    await burnToArc(wallet, src, {
      amount: 1_000_000n, maxFee: 200_000n, recipient: ME, arcClient: arc, url,
      onProgress: (step, h) => { if (step === 'sent' && h) sent.hash = h.toLowerCase(); },
    });
    return { ok: true };
  } catch (e) {
    if (!sent.hash) throw e;
    return { err: burnSentError(e, sent.hash, FROM), sent: sent.hash };
  }
}

test('a burn sent whose receipt can’t be read is held as Check it: a second press can’t burn again', async () => {
  const state = { sends: 0, receipt: 'busy' };
  const { err, sent } = await send(state);
  assert.equal(state.sends, 1);
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, sent, 'the burn that was sent');
  assert.equal(err.chainId, SRC.id, 'read again on the chain it left');
});

test('a burn that reverted burned nothing: shown, linked, and the button can send again', async () => {
  const state = { sends: 0, receipt: '0x0' };
  const { err, sent } = await send(state);
  assert.ok(!held(err));
  assert.match(err.message, /failed on Base Sepolia: nothing was burned/);
  assert.equal(err.hash, sent);
  assert.equal(err.chainId, SRC.id);
});

test('the hash held is the one the form follows (a burn sped up in the wallet), and anything else after sending is held too', () => {
  const now = hash(2);
  const e = burnSentError(new SentButUnconfirmedError(hash(1), SRC.id, new Error('busy')), now, FROM);
  assert.ok(held(e));
  assert.equal(e.hash, now);
  assert.equal(e.chainId, SRC.id);
  for (const odd of [new Error('socket hang up'), null, 'x', { message: 42 }]) {
    const x = burnSentError(odd, now, FROM);
    assert.ok(held(x), String(odd));
    assert.equal(x.hash, now);
    assert.equal(x.chainId, SRC.id);
  }
});
