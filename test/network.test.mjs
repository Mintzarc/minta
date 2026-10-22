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

test('the smallest tax on a side is 1% on mainnet and 0 on the testnet; the largest is the contract’s 10%', () => {
  const n = network({ PROD: true });
  assert.equal(n.settingsFor('mainnet').minTaxBps, 100);
  assert.equal(n.settingsFor('testnet').minTaxBps, 0);
  assert.equal(n.MAX_TAX_BPS, LAUNCH_LIMITS.maxTaxBps, 'the maximum is the contract’s, as the SDK records it');
  assert.equal(LAUNCH_LIMITS.maxTaxBps, 1000);
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

test('a launch on either network names no partner and no partner fee', async () => {
  for (const [chain, id] of [[vyreMainnet, 3045], [vyreTestnet, 7357]]) {
    const [tx] = await launchOn(chain, {});
    assert.ok(tx, 'a launch was sent to the wallet');
    assert.equal(getAddress(tx.to), getAddresses(id).pad);
    const call = decodeFunctionData({ abi: vyrePadAbi, data: tx.data });
    assert.equal(call.functionName, 'createLaunch');
    assert.equal(call.args[0].partner, '0x0000000000000000000000000000000000000000');
    assert.equal(call.args[0].partnerFeeBps, 0);
  }
});

test('the app sends no partner or fee of its own, and states no platform fee, on the Create and token pages', () => {
  const launchPage = read('src/pages/Launch.tsx'), tokenPage = read('src/pages/Token.tsx');
  assert.match(launchPage, /launch\(w, vyre, \{ \.\.\.params, metadataURI \}\)/, 'the launch call sends the form’s parameters');
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => /\.tsx?$/.test(f))) {
    const t = read(`src/${f}`);
    assert.doesNotMatch(t, /MINTA_PARTNER|PARTNER\b|partnerFeeBps:/, `${f} names no partner of its own`);
    assert.doesNotMatch(t, new RegExp('0x7293' + '8Daaf3c2Fa4bEf722E1263a5766755788392', 'i'), `${f} writes out no payout address`);
    assert.doesNotMatch(t, /per trade|MINTA fee/, `${f} has no fee sum`);
  }
  assert.doesNotMatch(tokenPage, /Platform fee|platform fee|VYRE’s 1%/, 'the token page has no platform-fee sentence');
  assert.match(tokenPage, /[Aa] tenth of the creator['’]s tax goes to the platform/, 'the token page states the platform’s tenth');
  assert.match(launchPage, /[Aa] tenth of the creator['’]s tax goes to the platform/, 'and so does the wizard');
  assert.match(tokenPage, /Buy tax/);
  assert.match(launchPage, /NETWORK\.minTaxBps/, 'the wizard’s tax limits come from the network');
});
