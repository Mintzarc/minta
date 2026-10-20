// Which VYRE network a build works on (src/lib/network.ts): chosen when the app is built, mainnet by default for a production build.
// What it must get right: the settings of each network come from the SDK's own records, nothing testnet-only is on mainnet's list
// of things, and MINTA's own fee on mainnet launches is one pair, never above the contract's maximum, and always sent as a pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPublicClient, createWalletClient, custom, decodeFunctionData, getAddress, parseUnits } from 'viem';
import ts from 'typescript';
import { LAUNCH_LIMITS, getAddresses, launch, vyreMainnet, vyrePadAbi, vyreTestnet, TXCHECK_URL } from '@vyrechain/sdk';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** src/lib/network.ts as the app builds it, with `env` as the build's settings (import.meta.env) */
function network(env = {}) {
  const src = read('src/lib/network.ts').replace(/import\.meta\.env\.(\w+)/g, (_, k) => JSON.stringify(env[k]) ?? 'undefined');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const req = (id) => (id === '@vyrechain/sdk' ? sdkExports : id === 'viem' ? viemExports : (() => { throw new Error(`unexpected import ${id}`); })());
  new Function('require', 'module', 'exports', js)(req, module, module.exports);
  return module.exports;
}
import * as sdkExports from '@vyrechain/sdk';
import * as viemExports from 'viem';

test('the network is the build setting; unset, a production build is mainnet and the dev server the testnet; anything else stops the build', () => {
  const { resolveNetwork } = network({ PROD: true });
  assert.equal(resolveNetwork(undefined, true), 'mainnet');
  assert.equal(resolveNetwork('', true), 'mainnet');
  assert.equal(resolveNetwork(undefined, false), 'testnet');
  assert.equal(resolveNetwork('testnet', true), 'testnet');
  assert.equal(resolveNetwork('mainnet', false), 'mainnet');
  for (const odd of ['Mainnet', 'main', 'prod', ' testnet', 1, true]) assert.throws(() => resolveNetwork(odd, true), /VITE_NETWORK/, String(odd));
  assert.equal(network({ PROD: true }).NETWORK.name, 'mainnet', 'a production build with no setting');
  assert.equal(network({ PROD: false }).NETWORK.name, 'testnet', 'the dev server with no setting');
  assert.equal(network({ PROD: true, VITE_NETWORK: 'testnet' }).NETWORK.name, 'testnet');
  assert.throws(() => network({ PROD: true, VITE_NETWORK: 'oops' }), /VITE_NETWORK/);
});

test('each network’s chains and hosts come from the SDK’s records, and only the testnet has the testnet-only things', () => {
  const { settingsFor } = network({ PROD: true });
  const m = settingsFor('mainnet'), t = settingsFor('testnet');
  assert.equal(m.vyre.id, 3045);
  assert.equal(m.vyre.id, vyreMainnet.id);
  assert.equal(m.vyre.rpcUrls.default.http[0], 'https://rpc.vyrechain.com');
  assert.equal(m.vyre.blockExplorers.default.url, 'https://explorer.vyrechain.com');
  assert.equal(m.arc.id, 5042, 'Arc mainnet is mainnet’s parent');
  assert.equal(m.api, 'https://api.vyrechain.com');
  assert.equal(m.testnet, false);
  assert.equal(m.promoters, null, 'mainnet has no promoter program');
  assert.equal(t.vyre.id, 7357);
  assert.equal(t.vyre.id, vyreTestnet.id);
  assert.equal(t.arc.id, 5042002);
  assert.equal(t.testnet, true);
  assert.equal(t.api, new URL('.', TXCHECK_URL).href.replace(/\/$/, ''), 'the testnet’s API is the one the SDK checks transactions with');
  assert.match(t.promoters, /^https:\/\/testnet-rpc\.vyrechain\.com\/promoters$/);
  assert.notEqual(m.api, t.api);
  assert.ok(getAddresses(3045).pad && getAddresses(7357).pad, 'the SDK has contracts for both');
  assert.notEqual(getAddresses(3045).pad, getAddresses(7357).pad);
  assert.match(m.label, /Mainnet/);
  assert.doesNotMatch(m.withdrawal, /instant/i);
  assert.match(m.withdrawal, /about a day/);
});

test('browser-stored state is kept apart per network: the testnet keeps its names, mainnet’s differ', () => {
  const { scoped } = network({ PROD: true });
  assert.equal(scoped('vyre.launch', 'testnet'), 'vyre.launch');
  assert.equal(scoped('vyre.launch', 'mainnet'), 'vyre.launch.mainnet');
  assert.equal(scoped('vyre.launch'), 'vyre.launch.mainnet', 'this build’s own');
});

test('MINTA’s fee: one pair in one place, exactly 100 basis points to the named address, mainnet only', () => {
  const n = network({ PROD: true });
  assert.equal(n.MINTA_PARTNER.feeBps, 100);
  assert.equal(n.MINTA_PARTNER.address, '0x72938Daaf3c2Fa4bEf722E1263a5766755788392', 'checksummed exactly like this');
  assert.equal(getAddress(n.MINTA_PARTNER.address), n.MINTA_PARTNER.address);
  assert.ok(n.MINTA_PARTNER.feeBps <= n.MAX_PARTNER_FEE_BPS);
  assert.equal(n.MAX_PARTNER_FEE_BPS, LAUNCH_LIMITS.maxPartnerFeeBps, 'the maximum is the contract’s, as the SDK records it');
  assert.equal(LAUNCH_LIMITS.maxPartnerFeeBps, 100);
  assert.deepEqual(n.partnerFor('mainnet'), { partner: '0x72938Daaf3c2Fa4bEf722E1263a5766755788392', partnerFeeBps: 100 });
  assert.equal(n.partnerFor('testnet'), null, 'the testnet’s launches name no partner');
  assert.deepEqual(network({ PROD: true }).PARTNER, n.partnerFor('mainnet'), 'a production build names MINTA');
  assert.equal(network({ PROD: true, VITE_NETWORK: 'testnet' }).PARTNER, null);
  // the address is written out in this one file only
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => /\.tsx?$/.test(f) && f !== 'lib/network.ts')) {
    assert.doesNotMatch(read(`src/${f}`), /0x72938Daaf3c2Fa4bEf722E1263a5766755788392/i, f);
  }
});

test('a partner and its fee are one pair: a zero address, a zero or missing fee, or a fee above 100 is refused', () => {
  const { checkPartnerPair, MINTA_PARTNER } = network({ PROD: true });
  const A = MINTA_PARTNER.address;
  const zero = '0x0000000000000000000000000000000000000000';
  assert.deepEqual(checkPartnerPair(A.toLowerCase(), 100), { partner: A, partnerFeeBps: 100 }, 'checksummed on the way out');
  assert.deepEqual(checkPartnerPair(A, 1), { partner: A, partnerFeeBps: 1 });
  assert.throws(() => checkPartnerPair(zero, 100), /zero address/);
  assert.throws(() => checkPartnerPair(A, 0), /no fee/);
  assert.throws(() => checkPartnerPair(A, undefined), /no fee/);
  assert.throws(() => checkPartnerPair(undefined, 100), /must be an address/);
  assert.throws(() => checkPartnerPair('0x1234', 100), /must be an address/);
  assert.throws(() => checkPartnerPair(A, 101), /at most 100/);
  assert.throws(() => checkPartnerPair(A, 1_000_000), /at most 100/);
  assert.throws(() => checkPartnerPair(A, -1), /no fee/);
  assert.throws(() => checkPartnerPair(A, 50.5), /no fee/);
  assert.throws(() => checkPartnerPair(A, '100'), /no fee/);
});

test('the fee text is worked out from the constants', () => {
  const n = network({ PROD: true });
  assert.equal(n.FEES.text, '1% platform fee + 1% MINTA fee = 2% per trade');
  assert.equal(n.FEES.totalBps, 200);
  assert.equal(network({ PROD: true, VITE_NETWORK: 'testnet' }).FEES.text, '1% platform fee per trade');
  assert.equal(n.tradeFees({ partner: n.MINTA_PARTNER.address, partnerFeeBps: 25 }).text, '1% platform fee + 0.25% MINTA fee = 1.25% per trade');
  assert.equal(n.tradeFees({ partner: n.MINTA_PARTNER.address, partnerFeeBps: 100 }, 'partner').text, '1% platform fee + 1% partner fee = 2% per trade');
  assert.equal(n.tradeFees(null).totalBps, 100);
});

/** A node that answers just what `launch` asks, and a wallet that keeps what it is sent and stops there */
function launchOn(chain, extra) {
  const sent = [];
  const node = { request: async ({ method }) => {
    if (method === 'eth_chainId') return `0x${chain.id.toString(16)}`;
    if (method === 'eth_call') return `0x${'00'.repeat(32 * 8)}`;
    if (method === 'eth_estimateGas') return '0x7a120';
    throw new Error(`the node was asked ${method}`);
  } };
  const wallet = { request: async ({ method, params }) => {
    if (method === 'eth_chainId') return `0x${chain.id.toString(16)}`;
    if (method === 'eth_sendTransaction') { sent.push(params[0]); throw Object.assign(new Error('stop here'), { code: 5000 }); }
    throw new Error(`the wallet was asked ${method}`);
  } };
  const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const pc = createPublicClient({ chain, transport: custom(node) });
  const wc = createWalletClient({ account: me, chain, transport: custom(wallet) });
  const base = { name: 'My Token', symbol: 'MYT', totalSupply: parseUnits('1000000', 18), buyTaxBps: 100, sellTaxBps: 100 };
  return launch(wc, pc, { ...base, ...extra }).catch(() => {}).then(() => sent);
}

test('on mainnet the launch call carries MINTA as the partner with exactly 100 basis points; on the testnet it names nobody', async () => {
  const n = network({ PROD: true });
  const [tx] = await launchOn(vyreMainnet, n.partnerFor('mainnet'));
  assert.ok(tx, 'a launch was sent to the wallet');
  assert.equal(getAddress(tx.to), getAddresses(3045).pad, 'to mainnet’s launchpad');
  const call = decodeFunctionData({ abi: vyrePadAbi, data: tx.data });
  assert.equal(call.functionName, 'createLaunch');
  assert.equal(call.args[0].partner, '0x72938Daaf3c2Fa4bEf722E1263a5766755788392');
  assert.equal(call.args[0].partnerFeeBps, 100);
  const [tt] = await launchOn(vyreTestnet, n.partnerFor('testnet') ?? {});
  const t = decodeFunctionData({ abi: vyrePadAbi, data: tt.data });
  assert.equal(t.args[0].partner, '0x0000000000000000000000000000000000000000');
  assert.equal(t.args[0].partnerFeeBps, 0);
});

test('the Create page sends the pair with every launch and says the fee in words from the constants', () => {
  const launchPage = read('src/pages/Launch.tsx');
  assert.match(launchPage, /\.\.\.\(PARTNER \?\? \{\}\)/, 'the launch parameters carry the pair');
  assert.match(launchPage, /launch\(w, vyre, \{ \.\.\.params, metadataURI \}\)/, 'and the launch call sends them');
  assert.equal((launchPage.match(/FEES\.text/g) || []).length >= 3, true, 'the fee is shown in the wizard and in the review');
  assert.doesNotMatch(launchPage, /1% platform fee/, 'no written-out sum');
  assert.match(read('src/pages/Token.tsx'), /tradeFees\(/, 'the token page works its fees out from the token’s own record');
});
