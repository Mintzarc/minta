// Hostile checks on WalletConnect’s signing guard (src/lib/wc.ts guardWc): a request that asks the wallet to sign must be for
// the connected account, not only eth_sendTransaction. personal_sign / eth_sign / eth_signTypedData_* carry the address in
// their params; a raw transaction cannot be bound to the connected account and must be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTHER = '0x4444444444444444444444444444444444444444';

function loadGuard() {
  const ws = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wcstate.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const wmod = { exports: {} };
  new Function('require', 'module', 'exports', ws)(() => { throw new Error('no imports'); }, wmod, wmod.exports);
  const js = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wc.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import\.meta\.env\.VITE_WALLETCONNECT_PROJECT_ID/g, 'undefined');
  const stubs = {
    viem: {},
    './chain': { VYRE_CHAIN: { id: 3045, name: 'VYRE', rpcUrls: { default: { http: ['https://rpc.example'] } } } },
    './twa': { SITE_URL: 'https://minta.vyrechain.com' },
    './wcstate': wmod.exports,
  };
  globalThis.localStorage = {
    store: Object.create(null),
    getItem(k) { return this.store[k] ?? null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => {
    if (!(id in stubs)) throw new Error(`unexpected import ${id}`);
    return stubs[id];
  }, module, module.exports);
  return module.exports;
}

function fakeRaw(sent) {
  return {
    async request(args) {
      if (args.method === 'eth_chainId') return '0xbe5';
      if (args.method === 'eth_accounts') return [ME];
      sent.push(args);
      return '0xok';
    },
    on() {},
    removeListener() {},
    session: { expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { eip155: { accounts: [`eip155:3045:${ME}`] } } },
  };
}

test('typed data and a transaction for another account are refused and never reach the wallet', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  for (const [method, params] of [
    ['eth_signTypedData_v4', [OTHER, '{}']],
    ['eth_signTypedData_v4', [ME.toLowerCase().replace('0x7', '0x8'), '{}']],
    ['eth_signTypedData_v4', []],
    ['eth_signTypedData_v4', { 0: ME }],
    ['eth_sendTransaction', [{ from: OTHER, to: OTHER }]],
    ['eth_sendTransaction', [{ to: OTHER }]],
  ]) {
    sent.length = 0;
    await assert.rejects(() => g.request({ method, params }), /account you connected|isn’t from the account/i, method);
    assert.equal(sent.length, 0, `${method} must not reach the wallet`);
  }
  // the connected account (any letter case) may sign and send
  for (const who of [ME, ME.toLowerCase()]) {
    sent.length = 0;
    assert.equal(await g.request({ method: 'eth_signTypedData_v4', params: [who, '{}'] }), '0xok');
    assert.equal(await g.request({ method: 'eth_sendTransaction', params: [{ from: who, to: OTHER }] }), '0xok');
    assert.equal(sent.length, 2);
  }
});

test('only an allow-list reaches the wallet: every other method, wallet_* included, is refused before it', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  for (const method of [
    'eth_sendRawTransaction', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v3',
    'wallet_sendCalls', 'wallet_sendTransaction', 'wallet_requestPermissions', 'wallet_grantPermissions', 'wallet_getCapabilities',
    'wallet_watchAsset', 'wallet_anything', 'eth_getBalance', 'eth_call', 'eth_sendTransaction ', 'ETH_SENDTRANSACTION', '',
  ]) {
    sent.length = 0;
    await assert.rejects(() => g.request({ method, params: [ME, '{}'] }), /isn’t used here, so nothing was sent/, method);
    assert.equal(sent.length, 0, `${JSON.stringify(method)} must not reach the wallet`);
  }
  await assert.rejects(() => g.request(undefined), /nothing was sent/);
  await assert.rejects(() => g.request({ method: 7 }), /nothing was sent/);
  // the plain reads the app makes still go through
  sent.length = 0;
  assert.equal(await g.request({ method: 'eth_chainId' }), '0xbe5');
  assert.deepEqual(await g.request({ method: 'eth_accounts' }), [ME]);
});

test('a session that lists a different VYRE account than eth_accounts is refused before anything is signed', async () => {
  // a hostile or buggy provider can answer eth_accounts with one address while the WalletConnect session is another:
  // signing must follow the session, so the app must not treat them as the same connection
  const { guardWc } = loadGuard();
  const sent = [];
  const raw = fakeRaw(sent);
  raw.session = {
    expiry: Math.floor(Date.now() / 1000) + 3600,
    namespaces: { eip155: { accounts: [`eip155:3045:${OTHER}`] } },
  };
  const g = guardWc(raw, ME, () => {});
  await assert.rejects(() => g.request({ method: 'eth_signTypedData_v4', params: [ME, '{}'] }), /account/i);
  assert.equal(sent.length, 0);
});

test('adopting a WalletConnect provider requires the eth_accounts address to be the one the session lists on VYRE', () => {
  const src = fs.readFileSync(new URL('../src/lib/wallet.tsx', import.meta.url), 'utf8');
  const adopt = src.slice(src.indexOf('const adoptWc'), src.indexOf('const connectWalletConnect'));
  assert.match(adopt, /sessionHasAccount/);
  assert.match(adopt, /namespaces\?\.eip155\?\.accounts/);
});
