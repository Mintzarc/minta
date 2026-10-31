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

test('a signature or typed-data request for another account is refused and never reaches the wallet', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  for (const [method, params] of [
    ['personal_sign', ['0x6869', OTHER]],
    ['eth_sign', [OTHER, '0x6869']],
    ['eth_signTypedData', [OTHER, {}]],
    ['eth_signTypedData_v3', [OTHER, {}]],
    ['eth_signTypedData_v4', [OTHER, '{}']],
  ]) {
    sent.length = 0;
    await assert.rejects(() => g.request({ method, params }), /account you connected|isn’t from the account/i, method);
    assert.equal(sent.length, 0, `${method} must not reach the wallet`);
  }
  // the connected account may still sign
  sent.length = 0;
  assert.equal(await g.request({ method: 'personal_sign', params: ['0x6869', ME] }), '0xok');
  assert.equal(sent.length, 1);
});

test('a raw transaction cannot be bound to the connected account, so it is refused', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  await assert.rejects(() => g.request({ method: 'eth_sendRawTransaction', params: ['0xdead'] }), /nothing was sent|cannot|refused|raw/i);
  assert.equal(sent.length, 0);
});
