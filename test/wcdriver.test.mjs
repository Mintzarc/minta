// The real WalletConnect driver (src/lib/wc.ts realDriver) against a stand-in for the library that behaves as universal-provider 2.26 does:
// one shared provider, `connect()` sets `session` when a wallet approves and returns `session` after a short wait, `disconnect()` ends
// whatever `session` is by then and clears it, and abortPairingAttempt does nothing. A pairing the person cancelled can still be approved later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const pairingN = (n) => String(n).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, 'a');

function load(fake) {
  const cjs = (f) => ts.transpileModule(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const wmod = { exports: {} };
  new Function('require', 'module', 'exports', cjs('../src/lib/wcstate.ts'))(() => { throw new Error('no imports'); }, wmod, wmod.exports);
  const js = cjs('../src/lib/wc.ts').replace(/import\.meta\.env\.VITE_WALLETCONNECT_PROJECT_ID/g, 'undefined').replace(/window\.location\.origin/g, "'https://minta.vyrechain.com'");
  const stubs = {
    viem: {}, './chain': { VYRE_CHAIN: { id: 3045, name: 'VYRE', rpcUrls: { default: { http: ['https://rpc.example'] } } } },
    './twa': { SITE_URL: 'https://minta.vyrechain.com' }, './wcstate': wmod.exports,
    '@walletconnect/universal-provider': { __esModule: true, default: { init: async () => fake } },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => { if (!(id in stubs)) throw new Error(`unexpected import ${id}`); return stubs[id]; }, module, module.exports);
  return module.exports;
}

/** A shared provider like the library's, with every connect() under the test's control */
function makeLibrary() {
  const ended = [];
  const sessions = new Map(); // topic -> session
  const listeners = new Set();
  const attempts = [];
  const lib = {
    session: undefined,
    on(e, f) { if (e === 'display_uri') listeners.add(f); },
    removeListener(e, f) { listeners.delete(f); },
    abortPairingAttempt() {},
    async request() { return null; },
    client: {
      session: { getAll: () => [...sessions.values()] },
      async disconnect({ topic }) { ended.push(topic); sessions.delete(topic); },
    },
    async disconnect() { const t = lib.session.topic; await lib.client.disconnect({ topic: t }); lib.session = undefined; },
    connect() {
      const n = attempts.length + 1;
      const pairing = pairingN(n);
      const uri = `wc:${pairing}@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
      let approve;
      const done = new Promise((r) => { approve = r; });
      const a = {
        n, pairing,
        // the wallet approves: the library records the session as its own `session`, then waits a moment before it answers with `session`
        async approve({ topic, accounts, beforeAnswer }) {
          const s = { topic, pairingTopic: pairing, expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { eip155: { accounts } } };
          sessions.set(topic, s);
          lib.session = s;
          if (beforeAnswer) await beforeAnswer();
          await Promise.resolve();
          approve(lib.session);
        },
        done,
      };
      attempts.push(a);
      setTimeout(() => listeners.forEach((f) => f(uri)), 0);
      return done;
    },
  };
  return { lib, ended, attempts };
}
const ACC = [`eip155:3045:${ME}`];
const tick = () => new Promise((r) => setTimeout(r, 5));

test('a pairing approved after the person cancelled ends that connection once, and the start refuses', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const { wcDriver } = load(lib);
  const ac = new AbortController();
  const started = wcDriver().start({ onUri() {}, signal: ac.signal });
  const outcome = started.then(() => 'connected', (e) => e.why ?? String(e));
  await tick();
  ac.abort();
  await attempts[0].approve({ topic: 'topic-A', accounts: ACC });
  assert.equal(await outcome, 'other');
  assert.deepEqual(ended, ['topic-A'], 'exactly the one late connection is ended, once');
});

test('cancel, then connect again, then both are approved: only the abandoned attempt’s connection is ended, never the live one', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const { wcDriver } = load(lib);
  const ac1 = new AbortController();
  const first = wcDriver().start({ onUri() {}, signal: ac1.signal }).then(() => 'connected', (e) => e.why ?? String(e));
  await tick();
  ac1.abort();
  const ac2 = new AbortController();
  const second = wcDriver().start({ onUri() {}, signal: ac2.signal }).then((p) => p, (e) => e);
  await tick();
  assert.equal(attempts.length, 2);
  // the library answers the first attempt with whatever `session` is at that moment: the second wallet approves in between
  await attempts[0].approve({ topic: 'topic-A', accounts: ACC, beforeAnswer: () => attempts[1].approve({ topic: 'topic-B', accounts: ACC }) });
  assert.equal(await first, 'other');
  const live = await second;
  assert.equal(live.session?.topic, 'topic-B', 'the second connection is the live one');
  assert.deepEqual(ended, ['topic-A'], 'the live connection is untouched');
});

test('a wallet that approves without an account on VYRE has its own connection ended and is refused', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const { wcDriver } = load(lib);
  const ac = new AbortController();
  const out = wcDriver().start({ onUri() {}, signal: ac.signal }).then(() => 'connected', (e) => e.why ?? String(e));
  await tick();
  await attempts[0].approve({ topic: 'topic-C', accounts: [`eip155:1:${ME}`] });
  assert.equal(await out, 'chain');
  assert.deepEqual(ended, ['topic-C']);
});
