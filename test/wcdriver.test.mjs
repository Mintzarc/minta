// The real WalletConnect driver (src/lib/wc.ts realDriver) against a stand-in for the library that behaves as universal-provider 2.26 does
// (read from its source): one shared provider; connect() makes a pairing, shows its address through the shared `display_uri` event whenever
// the relay answers (the test decides when), and when a wallet approves sets the shared `session` and then answers with `session` as it is
// a moment later; disconnect() ends whatever `session` is by then, clears it and deletes EVERY pairing (cleanup()); abortPairingAttempt does
// nothing, so a pairing the person cancelled can still be approved later.
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
    './twa': { SITE_URL: 'https://minta.vyrechain.com' }, './wcstate': wmod.exports, './walletError': { markOwn() {} },
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
  const pairings = new Set();
  const listeners = new Set();
  const attempts = [];
  const counts = { cleanups: 0, disconnects: 0 };
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
    async disconnect() {
      counts.disconnects++;
      await lib.client.disconnect({ topic: lib.session.topic });
      counts.cleanups++; pairings.clear(); lib.session = undefined; // cleanup(): the pointer and every pairing
    },
    connect() {
      const n = attempts.length + 1;
      const pairing = pairingN(n);
      pairings.add(pairing);
      const uri = `wc:${pairing}@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
      let ok, bad;
      const done = new Promise((r, j) => { ok = r; bad = j; });
      const a = {
        n, pairing, uri,
        emitUri(u = uri) { listeners.forEach((f) => f(u)); },
        fail(e) { bad(e); },
        // the wallet approves: the library records the session as its own `session`, waits a moment, then answers with `session`
        async approve({ topic, accounts = ACC, overwriteWith }) {
          const s = { topic, pairingTopic: pairing, expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { eip155: { accounts } } };
          sessions.set(topic, s);
          lib.session = s;
          if (overwriteWith) { sessions.set(overwriteWith.topic, overwriteWith); lib.session = overwriteWith; }
          await Promise.resolve();
          ok(lib.session);
        },
      };
      attempts.push(a);
      return done;
    },
  };
  return { lib, ended, attempts, counts, sessions };
}
const ACC = [`eip155:3045:${ME}`];
const tick = () => new Promise((r) => setTimeout(r, 5));
const why = (p) => p.then(() => 'connected', (e) => e.why ?? String(e));
const begin = (d, o = {}) => { const ac = new AbortController(); const uris = []; const out = d.start({ onUri: (u) => uris.push(u), signal: ac.signal }); return { ac, uris, out, outcome: why(out.catch((e) => { throw e; })) }; };

test('a pairing approved after the person cancelled ends that connection once, by its topic, and not through the library’s disconnect()', async () => {
  const { lib, ended, attempts, counts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick();
  attempts[0].emitUri();
  s.ac.abort();
  assert.equal(await s.outcome, 'other');
  await attempts[0].approve({ topic: 'topic-A' });
  await tick();
  assert.deepEqual(ended, ['topic-A'], 'exactly the one late connection is ended, once');
  assert.equal(counts.disconnects + counts.cleanups, 0, 'the library’s disconnect() (which deletes every pairing) is never used');
  assert.equal(lib.session, undefined, 'and the library no longer points at the ended session');
});

test('cancel and tap again while the pairing waits: the same pairing and code are used, a stale or second address is ignored, and the approval connects the second tap', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const first = begin(d); await tick();
  first.ac.abort();
  assert.equal(await first.outcome, 'other');
  const second = begin(d); await tick();
  assert.equal(attempts.length, 1, 'no second pairing is started while one waits');
  // the relay answers the first connect() only now, after the second tap; then some other address shows up
  attempts[0].emitUri();
  attempts[0].emitUri(`wc:${'b'.repeat(64)}@2?relay-protocol=irn&symKey=${'ee'.repeat(32)}`);
  assert.deepEqual(second.uris, [attempts[0].uri], 'the second tap is shown the pairing’s own address, once, and nothing else');
  assert.deepEqual(first.uris, [], 'a cancelled start is shown nothing');
  await attempts[0].approve({ topic: 'topic-A' });
  const p = await second.out;
  assert.equal(p.session.topic, 'topic-A');
  assert.deepEqual(ended, [], 'nothing is ended');
});

test('tapping again after the address was shown: the same address is shown at once and the approval connects the second tap', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const first = begin(d); await tick();
  attempts[0].emitUri();
  first.ac.abort();
  await first.outcome;
  const second = begin(d); await tick();
  assert.deepEqual(second.uris, [attempts[0].uri]);
  await attempts[0].approve({ topic: 'topic-A' });
  assert.equal((await second.out).session.topic, 'topic-A');
  assert.deepEqual(ended, []);
});

test('a start that is cancelled before the address arrives is never shown it', async () => {
  const { lib, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick();
  s.ac.abort();
  attempts[0].emitUri();
  assert.deepEqual(s.uris, []);
});

test('an abandoned pairing approved late, then a new connection: the late one is ended and the new one connects, with no cleanup in between', async () => {
  const { lib, ended, attempts, counts } = makeLibrary();
  const d = load(lib).wcDriver();
  const first = begin(d); await tick(); attempts[0].emitUri(); first.ac.abort(); await first.outcome;
  await attempts[0].approve({ topic: 'topic-A' }); await tick();
  const second = begin(d); await tick();
  assert.equal(attempts.length, 2, 'a settled pairing is not reused');
  attempts[1].emitUri();
  await attempts[1].approve({ topic: 'topic-B' });
  assert.equal((await second.out).session.topic, 'topic-B');
  assert.deepEqual(ended, ['topic-A']);
  assert.equal(counts.cleanups, 0);
});

test('a late approval that overwrites the library’s pointer while another connection is live ends only the late one and puts the live one back', async () => {
  const { lib, ended, attempts, counts, sessions } = makeLibrary();
  const d = load(lib).wcDriver();
  const live = begin(d); await tick(); attempts[0].emitUri();
  await attempts[0].approve({ topic: 'topic-B' });
  assert.equal((await live.out).session.topic, 'topic-B');
  // another pairing is started, cancelled, and approved late
  const late = begin(d); await tick(); attempts[1].emitUri(); late.ac.abort(); await late.outcome;
  await attempts[1].approve({ topic: 'topic-A' }); await tick();
  assert.deepEqual(ended, ['topic-A'], 'only the late connection is ended (the live one is older in the library’s list, so "any session" would pick it)');
  assert.ok(sessions.has('topic-B') && !sessions.has('topic-A'));
  assert.equal(lib.session.topic, 'topic-B', 'the library points at the live connection again');
  assert.equal(counts.cleanups, 0);
});

test('a session that does not belong to this pairing is refused, and both it and this pairing’s own session are ended', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick(); attempts[0].emitUri();
  const foreign = { topic: 'topic-F', pairingTopic: pairingN(9), expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { eip155: { accounts: ACC } } };
  await attempts[0].approve({ topic: 'topic-A', overwriteWith: foreign });
  assert.equal(await s.outcome, 'other');
  assert.deepEqual([...ended].sort(), ['topic-A', 'topic-F']);
});

test('a wallet that approves without an account on VYRE has its own connection ended and is refused', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick(); attempts[0].emitUri();
  await attempts[0].approve({ topic: 'topic-C', accounts: [`eip155:1:${ME}`] });
  assert.equal(await s.outcome, 'chain');
  assert.deepEqual(ended, ['topic-C']);
});

test('a pairing that fails frees the way: the next tap starts a new one', async () => {
  const { lib, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick(); attempts[0].fail(new Error('Proposal expired'));
  assert.equal(await s.outcome, 'expired');
  const t = begin(d); await tick();
  assert.equal(attempts.length, 2);
  void t;
});

test('a normal connection: approved, refused nothing, nothing ended', async () => {
  const { lib, ended, attempts } = makeLibrary();
  const d = load(lib).wcDriver();
  const s = begin(d); await tick(); attempts[0].emitUri();
  await attempts[0].approve({ topic: 'topic-A' });
  assert.equal((await s.out).session.topic, 'topic-A');
  assert.deepEqual(ended, []);
});
