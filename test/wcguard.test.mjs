// Hostile checks on WalletConnect’s signing guard (src/lib/wc.ts guardWc): a request that asks the wallet to sign must be for
// the connected account, not only eth_sendTransaction. personal_sign / eth_sign / eth_signTypedData_* carry the address in
// their params; a raw transaction cannot be bound to the connected account and must be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTHER = '0x4444444444444444444444444444444444444444';
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }];
const VYRE_TYPED = JSON.stringify({ domain: { name: 'T', version: '1', chainId: 3045, verifyingContract: OTHER }, types: { EIP712Domain: DOMAIN_TYPES }, primaryType: 'Permit', message: {} });

function loadGuard() {
  const ws = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wcstate.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const wmod = { exports: {} };
  new Function('require', 'module', 'exports', ws)(() => { throw new Error('no imports'); }, wmod, wmod.exports);
  // the real lib/walletError.ts (it imports nothing): the guard registers its own refusals there
  const we = ts.transpileModule(fs.readFileSync(new URL('../src/lib/walletError.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const wemod = { exports: {} };
  new Function('require', 'module', 'exports', we)(() => { throw new Error('no imports'); }, wemod, wemod.exports);
  const walletError = wemod.exports;
  const js = ts.transpileModule(fs.readFileSync(new URL('../src/lib/wc.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/import\.meta\.env\.VITE_WALLETCONNECT_PROJECT_ID/g, 'undefined');
  const stubs = {
    viem: {},
    './chain': { VYRE_CHAIN: { id: 3045, name: 'VYRE', rpcUrls: { default: { http: ['https://rpc.example'] } } } },
    './twa': { SITE_URL: 'https://minta.vyrechain.com' },
    './wcstate': wmod.exports, './walletError': walletError,
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
  return { ...module.exports, walletError };
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
    assert.equal(await g.request({ method: 'eth_signTypedData_v4', params: [who, VYRE_TYPED] }), '0xok');
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

test('a transaction or typed data for another chain (Arc, Ethereum, a bad number) is refused; VYRE’s, in any spelling, is sent', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  const typed = (chainId) => JSON.stringify({ domain: { name: 'T', version: '1', ...(chainId === undefined ? {} : { chainId }), verifyingContract: OTHER }, types: { EIP712Domain: DOMAIN_TYPES }, primaryType: 'Permit', message: {} });
  for (const [method, params] of [
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: '0x13a7d6' }]], // Arc
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: 5042 }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: '1' }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: 'nope' }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: null }]],
    ['eth_signTypedData_v4', [ME, typed(5042)]],
    ['eth_signTypedData_v4', [ME, typed('0x1')]],
    ['eth_signTypedData_v4', [ME, typed(undefined)]],
    ['eth_signTypedData_v4', [ME, JSON.stringify({ domain: { chainId: 3045 }, types: {}, primaryType: 'P', message: {} })]], // chainId not declared in EIP712Domain
    ['eth_signTypedData_v4', [ME, JSON.stringify({ domain: { chainId: 3045 }, types: { EIP712Domain: [{ name: 'name', type: 'string' }] }, primaryType: 'P', message: {} })]],
    ['eth_signTypedData_v4', [ME, JSON.stringify({ domain: { chainId: 3045 }, types: { EIP712Domain: 'chainId' }, primaryType: 'P', message: {} })]],
    ['eth_signTypedData_v4', [ME, 'not json']],
    ['eth_signTypedData_v4', [ME, '{}']],
  ]) {
    sent.length = 0;
    await assert.rejects(() => g.request({ method, params }), /another network|nothing was sent/i, `${method} ${JSON.stringify(params).slice(0, 80)}`);
    assert.equal(sent.length, 0, 'must not reach the wallet');
  }
  for (const [method, params] of [
    ['eth_sendTransaction', [{ from: ME, to: OTHER }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: 3045 }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: '0xbe5' }]],
    ['eth_sendTransaction', [{ from: ME, to: OTHER, chainId: '3045' }]],
    ['eth_signTypedData_v4', [ME, typed(3045)]],
    ['eth_signTypedData_v4', [ME, typed('0xbe5')]],
    ['eth_signTypedData_v4', [ME, JSON.parse(typed(3045))]],
  ]) {
    sent.length = 0;
    assert.equal(await g.request({ method, params }), '0xok', JSON.stringify(params).slice(0, 80));
    assert.equal(sent.length, 1);
  }
});

test('the request is read once: a getter that answers differently the second time cannot pass the check and send something else', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const g = guardWc(fakeRaw(sent), ME, () => {});
  let reads = 0;
  const args = {
    get method() { return 'eth_sendTransaction'; },
    get params() { reads++; return reads === 1 ? [{ from: ME, to: OTHER }] : [{ from: OTHER, to: OTHER }]; },
  };
  await g.request(args);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params[0].from, ME, 'what was sent is what was checked');
  assert.equal(reads, 1, 'params read once');
  let m = 0;
  const flip = { get method() { m++; return m === 1 ? 'eth_sendTransaction' : 'eth_sendRawTransaction'; }, params: [{ from: ME }] };
  sent.length = 0;
  await g.request(flip);
  assert.equal(sent[0].method, 'eth_sendTransaction');
  assert.equal(m, 1);
  // params that cannot be copied as plain data (a bigint) are refused rather than sent
  await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: [{ from: ME, value: 1n }] }), /nothing was sent/);
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

test('a guard belongs to the session it was built for: a replaced session is not signed for, and its end is not reported for the new one', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const lost = [];
  const raw = fakeRaw(sent);
  raw.session = { ...raw.session, topic: 'topic-A' };
  const real = raw.request.bind(raw);
  let fail = null;
  raw.request = async (a, c) => { if (fail && a.method === 'eth_sendTransaction') throw new Error(fail); return real(a, c); };
  const g = guardWc(raw, ME, (why) => lost.push(why));
  // its own session's end is reported
  fail = 'No matching key. session topic doesn\'t exist: abc';
  await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: [{ from: ME }] }));
  assert.deepEqual(lost, ['closed']);
  // a new session (another topic) took the provider over: the old guard signs nothing and reports nothing
  lost.length = 0; fail = null; sent.length = 0;
  raw.session = { ...raw.session, topic: 'topic-B' };
  await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: [{ from: ME }] }), /replaced by another one/);
  assert.equal(sent.length, 0);
  fail = 'No matching key. session topic doesn\'t exist: abc';
  await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: [{ from: ME }] }));
  assert.deepEqual(lost, [], 'a stale guard must not end the new session');
});

test('when the wallet turns a send down and the library asks again as wallet_sendTransaction, the answer is the wallet’s own first answer, and the wallet is not asked twice', async () => {
  const { guardWc } = loadGuard();
  const sent = [];
  const raw = fakeRaw(sent);
  const real = raw.request.bind(raw);
  const said = Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 });
  let asks = 0;
  raw.request = async (a, c) => { if (a.method === 'eth_sendTransaction') { asks++; throw said; } return real(a, c); };
  const g = guardWc(raw, ME, () => {});
  const tx = { method: 'eth_sendTransaction', params: [{ from: ME, to: OTHER }] };
  await assert.rejects(() => g.request(tx), (e) => e === said);
  await assert.rejects(() => g.request({ method: 'wallet_sendTransaction', params: tx.params }), (e) => e === said, 'the wallet’s words, not the guard’s');
  assert.equal(asks, 1, 'the wallet was asked once');
  // only that one follow-up: a wallet_sendTransaction with no refused send before it is refused in the guard's own words
  await assert.rejects(() => g.request({ method: 'wallet_sendTransaction', params: tx.params }), /isn’t used here, so nothing was sent/);
  assert.equal(asks, 1);
});

test('the remembered refusal is for that one transaction, a few seconds, sends only, and is dropped by a send that goes through', async () => {
  const { guardWc } = loadGuard();
  const said = Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 });
  const make = () => {
    const raw = fakeRaw([]);
    const real = raw.request.bind(raw);
    const state = { fail: true };
    raw.request = async (a, c) => { if (state.fail && (a.method === 'eth_sendTransaction' || a.method === 'eth_signTypedData_v4')) throw said; return real(a, c); };
    return { g: guardWc(raw, ME, () => {}), state };
  };
  const tx = (to) => [{ from: ME, to }];
  const own = /isn’t used here, so nothing was sent/;
  // another transaction's follow-up gets the guard's own refusal
  let { g } = make();
  await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: tx(OTHER) }), (e) => e === said);
  await assert.rejects(() => g.request({ method: 'wallet_sendTransaction', params: tx(ME) }), own);
  // after 5 seconds it is forgotten (and just before, it is not)
  const now = Date.now;
  try {
    for (const [later, kept] of [[4900, true], [5100, false]]) {
      ({ g } = make());
      const t0 = now();
      Date.now = () => t0;
      await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: tx(OTHER) }), (e) => e === said);
      Date.now = () => t0 + later;
      await assert.rejects(() => g.request({ method: 'wallet_sendTransaction', params: tx(OTHER) }), kept ? (e) => e === said : own, `${later} ms later`);
    }
  } finally { Date.now = now; }
  // a refused signature is not remembered
  ({ g } = make());
  await assert.rejects(() => g.request({ method: 'eth_signTypedData_v4', params: [ME, VYRE_TYPED] }), (e) => e === said);
  await assert.rejects(() => g.request({ method: 'wallet_sendTransaction', params: [ME, VYRE_TYPED] }), own);
  // a later send that goes through clears it
  const m = make();
  await assert.rejects(() => m.g.request({ method: 'eth_sendTransaction', params: tx(OTHER) }), (e) => e === said);
  m.state.fail = false;
  assert.equal(await m.g.request({ method: 'eth_sendTransaction', params: tx(OTHER) }), '0xok');
  await assert.rejects(() => m.g.request({ method: 'wallet_sendTransaction', params: tx(OTHER) }), own);
});

test('a wallet that rejects with a bare string or with nothing is passed on as an error with those words, or none', async () => {
  const { guardWc } = loadGuard();
  for (const [thrown, message] of [['User denied transaction signature', 'User denied transaction signature'], [null, ''], [undefined, ''], [7, '']]) {
    const raw = fakeRaw([]);
    const real = raw.request.bind(raw);
    raw.request = async (a, c) => { if (a.method === 'eth_sendTransaction') throw thrown; return real(a, c); };
    const g = guardWc(raw, ME, () => {});
    await assert.rejects(() => g.request({ method: 'eth_sendTransaction', params: [{ from: ME, to: OTHER }] }), (e) => e instanceof Error && e.message === message, JSON.stringify(thrown));
  }
});

test('the guard’s own refusals are registered as the page’s own words (and only those are: an error merely named like them is not)', async () => {
  const { guardWc, WcError, walletError } = loadGuard();
  const g = guardWc(fakeRaw([]), ME, () => {});
  const e = await g.request({ method: 'eth_sendTransaction', params: [{ from: OTHER, to: OTHER }] }).then(() => null, (x) => x);
  assert.ok(e instanceof WcError);
  assert.equal(walletError.ownRefusal(e), e.message);
  assert.equal(walletError.ownRefusal({ cause: { cause: e } }), e.message, 'wherever it sits in an error');
  assert.equal(walletError.ownRefusal(Object.assign(new Error('Nothing was sent.'), { name: 'WcError' })), null);
});

test('a connection found gone when the wallet had already been asked is the page’s error, but not one of its "nothing was sent" refusals', async () => {
  const { guardWc, WcError, walletError } = loadGuard();
  const raw = fakeRaw([]);
  const real = raw.request.bind(raw);
  raw.request = async (a, c) => { if (a.method === 'eth_sendTransaction') throw new Error('No matching key. session topic doesn\'t exist: abc'); return real(a, c); };
  const lost = [];
  const g = guardWc(raw, ME, (why) => lost.push(why));
  const e = await g.request({ method: 'eth_sendTransaction', params: [{ from: ME, to: OTHER }] }).then(() => null, (x) => x);
  assert.ok(e instanceof WcError && e.why === 'closed');
  assert.deepEqual(lost, ['closed']);
  assert.equal(walletError.ownRefusal(e), null);
  assert.equal(walletError.stoppedBeforeAsking(e), false);
  assert.match(walletError.walletSendFailure(e), /connection ended before it confirmed this[\s\S]*It may still have gone out/);
  // a refusal made before the wallet is asked stays the page's own words
  const before = await g.request({ method: 'eth_sendTransaction', params: [{ from: OTHER, to: OTHER }] }).then(() => null, (x) => x);
  assert.equal(walletError.ownRefusal(before), before.message);
});
