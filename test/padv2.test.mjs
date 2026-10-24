// The new launchpad's calls (src/lib/padv2.ts): the addresses are the deployment record's; a launch and a trade send exactly the calls
// the pad and Uniswap's SwapRouter take, with nothing added (no partner, no app fee, no unlimited approval); the limits are the
// contract's (a tax of 1% to 10% a side); results are read from the receipt's own events. Everything runs against a stand-in
// node and wallet: nothing is sent anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createPublicClient, createWalletClient, custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress,
  isAddress, parseAbi, parseUnits, toFunctionSelector, zeroAddress, keccak256, toHex,
} from 'viem';
import { getAddresses, quoterV2Abi, vyreTokenAbi, vyreMainnet } from '@vyrechain/sdk';
import * as P from '../src/lib/padv2.ts';

const ME = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const TOKEN = getAddress('0x1111111111111111111111111111111111111111');
const POOL = getAddress('0x2222222222222222222222222222222222222222');
const E18 = 10n ** 18n;
const eq = (a, b) => a.toLowerCase() === b.toLowerCase();

test('the deployment is eight different, checksummed, non-zero addresses on chain 3045 (the addresses themselves are checked against the deployment record by hand, not written out here)', () => {
  const all = Object.entries(P.PAD_V2).filter(([k]) => k !== 'startBlock');
  assert.equal(all.length, 8);
  for (const [k, v] of all) {
    assert.ok(isAddress(v, { strict: true }), `${k} is a checksummed address`);
    assert.notEqual(v, zeroAddress, k);
  }
  assert.equal(new Set(all.map(([, v]) => v.toLowerCase())).size, 8, 'no two are the same');
  assert.equal(P.MAINNET_ID, 3045);
  assert.equal(P.MAINNET_ID, vyreMainnet.id);
  assert.equal(P.PAD_V2.startBlock, 59);
  // the first launchpad and its fee contracts (in the SDK's record) are not this one
  const old = getAddresses(3045);
  for (const k of ['pad', 'poolFactory', 'poolDeployer', 'swapRouter', 'quoter', 'tickLens']) assert.notEqual(P.PAD_V2[k].toLowerCase(), old[k].toLowerCase(), `${k} is the new deployment's, not the first one's`);
  assert.equal(P.PAD_V2.wusdc, old.wusdc, 'WUSDC is the same token');
});

test('the pad’s calls have the contract’s own signatures (selectors taken from VyrePadV2.sol)', () => {
  const sig = (name) => toFunctionSelector(P.padV2Abi.find((x) => x.type === 'function' && x.name === name));
  // keccak of the canonical signature text, written out from the Solidity source
  const expected = {
    createLaunch: 'createLaunch((string,string,uint256,uint256,uint16,uint16,string))',
    collectCreatorFees: 'collectCreatorFees(address)',
    setTaxWallets: 'setTaxWallets(address,address[],uint16[])',
    lowerTaxes: 'lowerTaxes(address,uint16,uint16)',
    setMetadata: 'setMetadata(address,string)',
    offerCreator: 'offerCreator(address,address)',
    acceptCreator: 'acceptCreator(address,uint16,uint16)',
    launches: 'launches(address)',
    tokens: 'tokens(uint256)',
    tokenOfPool: 'tokenOfPool(address)',
    metadataOf: 'metadataOf(address)',
    pendingCreator: 'pendingCreator(address)',
    taxWalletsOf: 'taxWalletsOf(address)',
    launchCount: 'launchCount()',
    launchesOpen: 'launchesOpen()',
  };
  for (const [name, text] of Object.entries(expected)) assert.equal(sig(name), keccak256(toHex(text)).slice(0, 10), name);
  const ev = P.padV2Abi.find((x) => x.type === 'event' && x.name === 'LaunchCreated');
  assert.equal(ev.inputs.length, 11);
  assert.deepEqual(P.padV2Abi.filter((x) => x.type === 'function' && x.name === 'createLaunch')[0].inputs[0].components.map((c) => c.name),
    ['name', 'symbol', 'totalSupply', 'startingMarketCap', 'buyTaxBps', 'sellTaxBps', 'metadataURI'], 'no partner fields');
});

test('the limits are the contract’s: a tax of 1% to 10% a side, no partner, $3,000 opening', () => {
  const base = { name: 'My Token', symbol: 'MYT', totalSupply: parseUnits('1000000', 18), buyTaxBps: 100, sellTaxBps: 1000 };
  P.checkLaunchParams(base);
  P.checkLaunchParams({ ...base, startingMarketCap: 3000n * E18, firstBuyUsdc: 5n * E18, metadataURI: 'https://x.test/m' });
  for (const bad of [{ buyTaxBps: 99 }, { sellTaxBps: 0 }, { buyTaxBps: 1001 }, { sellTaxBps: 1.5 }, { buyTaxBps: NaN },
    { startingMarketCap: 1n }, { partnerFeeBps: 1 }, { partner: ME }, { name: '' }, { symbol: 'X'.repeat(17) }, { name: 'é'.repeat(33) },
    { totalSupply: 999n * E18 }, { totalSupply: 10n ** 15n * E18 + 1n }, { metadataURI: 'x'.repeat(257) }, { firstBuyUsdc: -1n }]) {
    assert.throws(() => P.checkLaunchParams({ ...base, ...bad }), Error, JSON.stringify(bad, (k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
  }
  P.checkLaunchParams({ ...base, partner: zeroAddress, partnerFeeBps: 0 });
  assert.equal(P.PAD_V2_LIMITS.minTaxBps, 100);
  assert.equal(P.PAD_V2_LIMITS.maxTaxBps, 1000);
  assert.equal(P.PLATFORM_SHARE_BPS, 1000);
});

// ---------------------------------------------------------------------------------------------------------------
// A stand-in node and wallet
// ---------------------------------------------------------------------------------------------------------------
const erc20 = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)', 'event Deposit(address indexed dst, uint256 wad)', 'event Withdrawal(address indexed src, uint256 wad)']);
const word = (v) => encodeAbiParameters([{ type: 'uint256' }], [v]);
const topicsOf = (name, args) => encodeEventTopics({ abi: erc20, eventName: name, args });
const log = (address, name, args, data) => ({ address, topics: topicsOf(name, args), data, blockNumber: '0x5', transactionHash: HASH, transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), logIndex: '0x0', removed: false });
const HASH = '0x' + 'ab'.repeat(32);

/**
 * `world.calls`: eth_call requests seen (to, data). `world.sent`: transactions the wallet was asked to send, in order.
 * `world.logs`: the receipt's logs for every sent transaction (a function of the transaction). `world.signed`: typed data signed.
 */
function stand({ allowance = 0n, quote = 7n * E18, quoteRevert = null, logs = () => [], signature = 'ok', launched = null, sendFails = null } = {}) {
  const chain = vyreMainnet;
  const world = { calls: [], sent: [], signed: [], reads: [] };
  const reads = {
    name: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'name', result: 'My Token' }),
    symbol: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'symbol', result: 'MYT' }),
    totalSupply: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'totalSupply', result: 1000000n * E18 }),
    allowance: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'allowance', result: allowance }),
    nonces: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'nonces', result: 3n }),
    approve: () => encodeFunctionResult({ abi: vyreTokenAbi, functionName: 'approve', result: true }),
  };
  const node = { request: async ({ method, params }) => {
    switch (method) {
      case 'eth_chainId': return toHex(chain.id);
      case 'eth_blockNumber': return '0x10';
      case 'eth_getTransactionCount': return '0x1';
      case 'eth_estimateGas': return '0x7a120';
      case 'eth_gasPrice': return '0x1';
      case 'eth_maxPriorityFeePerGas': return '0x1';
      case 'eth_getBlockByNumber': return { number: '0x10', hash: '0x' + '0c'.repeat(32), timestamp: '0x6000', baseFeePerGas: '0x1', gasLimit: '0x1c9c380', transactions: [] };
      case 'eth_getTransactionByHash': return { hash: HASH, from: ME, nonce: '0x1', blockNumber: '0x5', input: '0x', to: P.PAD_V2.swapRouter, value: '0x0', gas: '0x1', gasPrice: '0x1', type: '0x0', blockHash: '0x' + '0b'.repeat(32), transactionIndex: '0x0', r: '0x1', s: '0x1', v: '0x1b' };
      case 'eth_getTransactionReceipt': {
        const tx = world.sent.at(-1);
        return { transactionHash: HASH, transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), blockNumber: '0x5', from: ME, to: tx.to, cumulativeGasUsed: '0x1', gasUsed: '0x1', effectiveGasPrice: '0x1', status: '0x1', type: '0x0', contractAddress: null, logsBloom: '0x' + '00'.repeat(256), logs: logs(tx) };
      }
      case 'eth_call': {
        const { to, data } = params[0];
        const input = data ?? params[0].input;
        world.calls.push({ to: getAddress(to), data: input });
        if (eq(to, P.PAD_V2.quoter)) {
          if (quoteRevert) throw Object.assign(new Error(`execution reverted: ${quoteRevert}`), { code: 3 });
          return encodeFunctionResult({ abi: quoterV2Abi, functionName: 'quoteExactInputSingle', result: [quote, 0n, 0, 0n] });
        }
        if (eq(to, P.PAD_V2.pad)) {
          const f = decodeFunctionData({ abi: P.padV2Abi, data: input });
          if (f.functionName === 'launches') {
            const t = f.args[0];
            const isLaunch = eq(t, TOKEN) || (launched && launched.some((x) => eq(x, t)));
            return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'launches', result: isLaunch ? [POOL, 100, 250, -200, 887200, ME, 1700000000n] : [zeroAddress, 0, 0, 0, 0, zeroAddress, 0n] });
          }
          if (f.functionName === 'metadataOf') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'metadataOf', result: 'https://api.vyrechain.com/m/x.json' });
          if (f.functionName === 'launchCount') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'launchCount', result: 3n });
          if (f.functionName === 'tokens') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'tokens', result: [TOKEN, getAddress('0x3333333333333333333333333333333333333333'), getAddress('0x4444444444444444444444444444444444444444')][Number(f.args[0])] });
          if (f.functionName === 'taxWalletsOf') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'taxWalletsOf', result: [[ME, POOL], [7000, 3000]] });
          if (f.functionName === 'tokenOfPool') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'tokenOfPool', result: eq(f.args[0], POOL) ? TOKEN : zeroAddress });
          if (f.functionName === 'createLaunch') return encodeFunctionResult({ abi: P.padV2Abi, functionName: 'createLaunch', result: [TOKEN, POOL, 0n] });
          return '0x';
        }
        if (eq(to, P.PAD_V2.swapRouter)) return encodeFunctionResult({ abi: P.swapRouterAbi, functionName: 'multicall', result: [] });
        // the token (name, symbol, supply, allowance, nonce, permit, approve)
        const f = decodeFunctionData({ abi: vyreTokenAbi, data: input });
        if (reads[f.functionName]) return reads[f.functionName]();
        return '0x';
      }
      default: throw new Error(`the node was asked ${method}`);
    }
  } };
  const wallet = { request: async ({ method, params }) => {
    if (method === 'eth_chainId') return toHex(chain.id);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ME];
    if (method === 'eth_signTypedData_v4') {
      world.signed.push(JSON.parse(params[1]));
      if (signature === 'rejected') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (signature === 'unsupported') throw Object.assign(new Error('method not supported'), { code: -32601 });
      return '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b';
    }
    if (method === 'eth_sendTransaction') {
      if (sendFails) throw Object.assign(new Error('stop here'), { code: 5000 });
      world.sent.push(params[0]);
      return HASH;
    }
    throw new Error(`the wallet was asked ${method}`);
  } };
  const pc = createPublicClient({ chain, transport: custom(node) });
  const wc = createWalletClient({ account: ME, chain, transport: custom(wallet) });
  return { pc, wc, world };
}

test('a launch sends one createLaunch to the new pad: the creator’s two taxes, the supply, the fixed opening, no partner, the first buy as its value', async () => {
  const { pc, wc, world } = stand({
    logs: () => [
      { address: P.PAD_V2.pad, topics: encodeEventTopics({ abi: P.padV2Abi, eventName: 'LaunchCreated', args: { token: TOKEN, creator: ME, pool: POOL } }),
        data: encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint256' }, { type: 'uint160' }, { type: 'int24' }, { type: 'int24' }], ['My Token', 'MYT', 250, 500, 3000n * E18, 1n, -200, 887200]),
        blockNumber: '0x5', transactionHash: HASH, transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), logIndex: '0x0', removed: false },
      { address: P.PAD_V2.pad, topics: encodeEventTopics({ abi: P.padV2Abi, eventName: 'FirstBuy', args: { token: TOKEN, creator: ME } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [E18, 42n * E18]),
        blockNumber: '0x5', transactionHash: HASH, transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), logIndex: '0x1', removed: false },
    ],
  });
  const r = await P.launch(wc, pc, { name: 'My Token', symbol: 'MYT', totalSupply: parseUnits('1000000', 18), buyTaxBps: 250, sellTaxBps: 500, firstBuyUsdc: E18, metadataURI: 'https://x.test/m' });
  assert.equal(world.sent.length, 1);
  const [tx] = world.sent;
  assert.equal(getAddress(tx.to), P.PAD_V2.pad);
  assert.equal(BigInt(tx.value), E18, 'the dev buy travels as the value');
  const call = decodeFunctionData({ abi: P.padV2Abi, data: tx.data });
  assert.equal(call.functionName, 'createLaunch');
  assert.deepEqual(call.args[0], { name: 'My Token', symbol: 'MYT', totalSupply: parseUnits('1000000', 18), startingMarketCap: 3000n * E18, buyTaxBps: 250, sellTaxBps: 500, metadataURI: 'https://x.test/m' });
  assert.equal(r.token, TOKEN);
  assert.equal(r.pool, POOL);
  assert.equal(r.bought, 42n * E18, 'the first buy is read from the pad’s own event');
  assert.equal(r.openingMarketCap, 3000n * E18);
});

test('a launch below 1% is refused before the wallet is asked', async () => {
  const { pc, wc, world } = stand();
  await assert.rejects(P.launch(wc, pc, { name: 'A', symbol: 'A', totalSupply: parseUnits('1000000', 18), buyTaxBps: 0, sellTaxBps: 100 }), /buyTaxBps/);
  assert.equal(world.sent.length, 0);
});

test('quotes ask the quoter for the right pair; a sale into an empty pool quotes 0, any other failure is an error', async () => {
  const a = stand({ quote: 9n * E18 });
  assert.equal(await P.quoteBuy(a.pc, { token: TOKEN, usdcIn: E18 }), 9n * E18);
  assert.equal(await P.quoteSell(a.pc, { token: TOKEN, amountIn: 3n * E18 }), 9n * E18);
  const [buyQ, sellQ] = a.world.calls.filter((c) => eq(c.to, P.PAD_V2.quoter)).map((c) => decodeFunctionData({ abi: quoterV2Abi, data: c.data }).args[0]);
  assert.deepEqual([buyQ.tokenIn, buyQ.tokenOut, buyQ.amountIn, buyQ.fee], [P.PAD_V2.wusdc, TOKEN, E18, 10000]);
  assert.deepEqual([sellQ.tokenIn, sellQ.tokenOut, sellQ.amountIn, sellQ.fee], [TOKEN, P.PAD_V2.wusdc, 3n * E18, 10000]);
  assert.equal(await P.quoteBuy(a.pc, { token: TOKEN, usdcIn: 0n }), 0n, 'nothing to buy with');
  const zf = stand({ quoteRevert: 'ZF' });
  assert.equal(await P.quoteSell(zf.pc, { token: TOKEN, amountIn: E18 }), 0n);
  const other = stand({ quoteRevert: 'SPL' });
  await assert.rejects(P.quoteSell(other.pc, { token: TOKEN, amountIn: E18 }));
});

test('a buy is one SwapRouter multicall of the swap and a refund, with the USDC as its value and the quote less the leeway as its floor', async () => {
  const { pc, wc, world } = stand({
    quote: 100n * E18,
    logs: () => [
      log(P.PAD_V2.wusdc, 'Deposit', { dst: P.PAD_V2.swapRouter }, word(2n * E18)),
      log(TOKEN, 'Transfer', { from: POOL, to: ME }, word(98n * E18)),
    ],
  });
  const r = await P.buy(wc, pc, { token: TOKEN, usdcIn: 2n * E18, slippageBps: 200 });
  assert.equal(world.sent.length, 1, 'one transaction: no approval to buy');
  const [tx] = world.sent;
  assert.equal(getAddress(tx.to), P.PAD_V2.swapRouter);
  assert.equal(BigInt(tx.value), 2n * E18);
  const outer = decodeFunctionData({ abi: P.swapRouterAbi, data: tx.data });
  assert.equal(outer.functionName, 'multicall');
  assert.equal(outer.args[0].length, 2);
  const swap = decodeFunctionData({ abi: P.swapRouterAbi, data: outer.args[0][0] });
  assert.equal(swap.functionName, 'exactInputSingle');
  const s = swap.args[0];
  assert.equal(s.tokenIn, P.PAD_V2.wusdc);
  assert.equal(s.tokenOut, TOKEN);
  assert.equal(s.fee, 10000);
  assert.equal(s.recipient, ME, 'the tokens go to the trader');
  assert.equal(s.amountIn, 2n * E18);
  assert.equal(s.amountOutMinimum, (100n * E18 * 9800n) / 10000n);
  assert.equal(s.sqrtPriceLimitX96, 0n);
  assert.ok(s.deadline > BigInt(Math.floor(Date.now() / 1000)) && s.deadline <= BigInt(Math.floor(Date.now() / 1000) + 601));
  assert.equal(decodeFunctionData({ abi: P.swapRouterAbi, data: outer.args[0][1] }).functionName, 'refundETH');
  assert.equal(r.tokensOut, 98n * E18, 'tokens received are read from the token’s transfers to the trader');
  assert.equal(r.usdcIn, 2n * E18);
  assert.equal(r.appFee, 0n);
  assert.equal(r.promoter, null);
});

test('a buy that would get nothing is refused; a minimum given is used as given; a recipient other than the trader is refused', async () => {
  const none = stand({ quote: 0n });
  await assert.rejects(P.buy(none.wc, none.pc, { token: TOKEN, usdcIn: E18 }), /no tokens/);
  assert.equal(none.world.sent.length, 0);
  const a = stand({ quote: 5n * E18 });
  await P.buy(a.wc, a.pc, { token: TOKEN, usdcIn: E18, minTokensOut: 3n * E18 });
  const swap = decodeFunctionData({ abi: P.swapRouterAbi, data: decodeFunctionData({ abi: P.swapRouterAbi, data: a.world.sent[0].data }).args[0][0] });
  assert.equal(swap.args[0].amountOutMinimum, 3n * E18);
  await assert.rejects(P.buy(a.wc, a.pc, { token: TOKEN, usdcIn: E18, recipient: POOL }), /trading wallet only/);
  await assert.rejects(P.buy(a.wc, a.pc, { token: TOKEN, usdcIn: 0n }), /more than 0/);
});

const sellLogs = (usdcOut, tokensIn) => () => [
  log(TOKEN, 'Transfer', { from: ME, to: POOL }, word(tokensIn)),
  log(P.PAD_V2.wusdc, 'Withdrawal', { src: P.PAD_V2.swapRouter }, word(usdcOut)),
];
const unpackSale = (tx) => {
  const outer = decodeFunctionData({ abi: P.swapRouterAbi, data: tx.data });
  assert.equal(outer.functionName, 'multicall');
  return outer.args[0].map((d) => decodeFunctionData({ abi: P.swapRouterAbi, data: d }));
};

test('a sale with the allowance already there is one multicall: the swap into the router, then the unwrap to the trader, with the quote less the leeway as the floor', async () => {
  const { pc, wc, world } = stand({ allowance: 10n * E18, quote: 50n * E18, logs: sellLogs(48n * E18, 3n * E18) });
  const r = await P.sell(wc, pc, { token: TOKEN, amountIn: 3n * E18 });
  assert.equal(world.sent.length, 1);
  assert.equal(world.signed.length, 0, 'no permit needed');
  const [tx] = world.sent;
  assert.equal(getAddress(tx.to), P.PAD_V2.swapRouter);
  assert.equal(BigInt(tx.value ?? 0), 0n);
  const [swap, unwrap] = unpackSale(tx);
  assert.equal(swap.functionName, 'exactInputSingle');
  assert.deepEqual([swap.args[0].tokenIn, swap.args[0].tokenOut, swap.args[0].fee, swap.args[0].amountIn], [TOKEN, P.PAD_V2.wusdc, 10000, 3n * E18]);
  assert.equal(swap.args[0].recipient, P.PAD_V2.swapRouter, 'the USDC lands on the router to be unwrapped');
  assert.equal(swap.args[0].amountOutMinimum, (50n * E18 * 9800n) / 10000n);
  assert.equal(unwrap.functionName, 'unwrapWETH9');
  assert.deepEqual(unwrap.args, [(50n * E18 * 9800n) / 10000n, ME], 'the unwrap pays the trader, at least the floor');
  assert.equal(r.usdcOut, 48n * E18);
  assert.equal(r.tokensIn, 3n * E18);
  assert.equal(r.approval, 'allowance');
  assert.equal(r.appFee, 0n);
});

test('a sale with no allowance signs a permit for exactly the amount, to the SwapRouter, and sends it in the same multicall', async () => {
  const { pc, wc, world } = stand({ allowance: 0n, quote: 50n * E18, logs: sellLogs(48n * E18, 3n * E18) });
  const r = await P.sell(wc, pc, { token: TOKEN, amountIn: 3n * E18 });
  assert.equal(r.approval, 'permit');
  assert.equal(world.sent.length, 1, 'one transaction, no separate approval');
  const typed = world.signed[0];
  assert.equal(typed.primaryType, 'Permit');
  assert.equal(getAddress(typed.message.spender), P.PAD_V2.swapRouter);
  assert.equal(BigInt(typed.message.value), 3n * E18, 'for exactly this sale');
  assert.equal(getAddress(typed.message.owner), ME);
  assert.equal(typed.message.nonce.toString(), '3');
  assert.equal(typed.domain.version, '1');
  assert.equal(typed.domain.name, 'My Token');
  assert.equal(getAddress(typed.domain.verifyingContract), TOKEN);
  const [permit, swap, unwrap] = unpackSale(world.sent[0]);
  assert.equal(permit.functionName, 'selfPermitIfNecessary');
  assert.deepEqual(permit.args.slice(0, 2), [TOKEN, 3n * E18]);
  assert.equal(swap.functionName, 'exactInputSingle');
  assert.equal(unwrap.functionName, 'unwrapWETH9');
});

test('a wallet that cannot sign a permit gets an approval for exactly the amount, never more, then the sale', async () => {
  const { pc, wc, world } = stand({ allowance: 0n, quote: 50n * E18, signature: 'unsupported', logs: sellLogs(48n * E18, 3n * E18) });
  const r = await P.sell(wc, pc, { token: TOKEN, amountIn: 3n * E18 });
  assert.equal(r.approval, 'approve');
  assert.equal(world.sent.length, 2);
  assert.equal(getAddress(world.sent[0].to), TOKEN);
  const approve = decodeFunctionData({ abi: vyreTokenAbi, data: world.sent[0].data });
  assert.equal(approve.functionName, 'approve');
  assert.deepEqual(approve.args, [P.PAD_V2.swapRouter, 3n * E18]);
  assert.equal(getAddress(world.sent[1].to), P.PAD_V2.swapRouter);
  assert.ok(r.approvalHash);
  const forced = stand({ allowance: 0n, quote: 50n * E18, logs: sellLogs(48n * E18, 3n * E18) });
  const r2 = await P.sell(forced.wc, forced.pc, { token: TOKEN, amountIn: 3n * E18, permit: false });
  assert.equal(r2.approval, 'approve');
  assert.equal(forced.world.signed.length, 0, 'permit: false never asks for a signature');
});

test('refusing to sign the permit stops the sale (it is not turned into an approval behind the person’s back)', async () => {
  const { pc, wc, world } = stand({ allowance: 0n, quote: 50n * E18, signature: 'rejected' });
  await assert.rejects(P.sell(wc, pc, { token: TOKEN, amountIn: 3n * E18 }));
  assert.equal(world.sent.length, 0);
});

test('a sale the pool would pay nothing for is refused before anything is signed or sent', async () => {
  const { pc, wc, world } = stand({ quoteRevert: 'ZF' });
  await assert.rejects(P.sell(wc, pc, { token: TOKEN, amountIn: E18 }), /pay nothing/);
  assert.equal(world.sent.length, 0);
  assert.equal(world.signed.length, 0);
  await assert.rejects(P.sell(wc, pc, { token: TOKEN, amountIn: 0n }), /more than 0/);
});

test('a sale for WUSDC (unwrap false) pays the trader directly and sends no unwrap', async () => {
  const { pc, wc, world } = stand({ allowance: 10n * E18, quote: 50n * E18, logs: () => [
    log(TOKEN, 'Transfer', { from: ME, to: POOL }, word(3n * E18)),
    log(P.PAD_V2.wusdc, 'Transfer', { from: POOL, to: ME }, word(47n * E18)),
  ] });
  const r = await P.sell(wc, pc, { token: TOKEN, amountIn: 3n * E18, unwrap: false });
  const calls = unpackSale(world.sent[0]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0].recipient, ME);
  assert.equal(r.usdcOut, 47n * E18);
});

test('launches are read from the new pad: the token, the pool, the creator, the taxes, no partner', async () => {
  const { pc } = stand();
  const l = await P.getLaunch(pc, TOKEN);
  assert.deepEqual({ ...l, totalSupply: l.totalSupply.toString() }, {
    token: TOKEN, pool: POOL, creator: ME, buyTaxBps: 100, sellTaxBps: 250, partner: null, partnerFeeBps: 0, createdAt: 1700000000,
    metadataURI: 'https://api.vyrechain.com/m/x.json', name: 'My Token', symbol: 'MYT', totalSupply: (1000000n * E18).toString(),
  });
  assert.equal(await P.getLaunch(pc, getAddress('0x5555555555555555555555555555555555555555')), null, 'not a launch');
  assert.equal(await P.getLaunchCount(pc), 3);
  const tw = await P.getTaxWallets(pc, TOKEN);
  assert.deepEqual(tw, { wallets: [ME, POOL], bps: [7000, 3000] });
});

test('getLaunches lists newest first with their index, and skips none', async () => {
  const other = [getAddress('0x3333333333333333333333333333333333333333'), getAddress('0x4444444444444444444444444444444444444444')];
  const { pc } = stand({ launched: other });
  const list = await P.getLaunches(pc, { count: 5 });
  assert.deepEqual(list.map((x) => x.index), [2, 1, 0]);
  assert.deepEqual(list.map((x) => x.token), [other[1], other[0], TOKEN]);
  assert.deepEqual((await P.getLaunches(pc, { from: 1, count: 1 })).map((x) => x.index), [1]);
});

test('the tax wallets a launch must never name: the launchpad’s contracts, and any launch’s pool or token, read from the pad', async () => {
  const c = P.padV2Contracts().map((x) => x.toLowerCase());
  for (const x of [P.PAD_V2.pad, P.PAD_V2.poolFactory, P.PAD_V2.poolDeployer, P.PAD_V2.swapRouter, P.PAD_V2.quoter, P.PAD_V2.tickLens, P.PAD_V2.wusdc]) assert.ok(c.includes(x.toLowerCase()), x);
  const { pc } = stand();
  const stranger = getAddress('0x6666666666666666666666666666666666666666');
  assert.deepEqual(await P.launchContractsAmong(pc, [stranger, POOL, TOKEN, 'not an address']), [POOL, TOKEN]);
  assert.deepEqual(await P.launchContractsAmong(pc, [stranger]), []);
});

test('the file imports nothing but viem and the SDK, and names no network service', () => {
  const src = fs.readFileSync(new URL('../src/lib/padv2.ts', import.meta.url), 'utf8');
  const from = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(from)].sort(), ['@vyrechain/sdk', 'viem', 'viem/actions']);
  assert.doesNotMatch(src, /fetch\(|https?:\/\//, 'no URL and no request of its own');
  assert.doesNotMatch(src, /type\(uint256\)\.max|maxUint256|2n \*\* 256n/, 'no unlimited approval');
});
