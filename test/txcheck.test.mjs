// The advisory pre-sign check (src/lib/txcheck.ts), run as it is by Node against a stand-in check service on a local port.
// What it must get right:
//  - it is advisory and fails open: a slow, busy, broken, hostile or absent service costs at most the 800 ms budget and never
//    shows anyone anything; only an answer with flags (or "would fail") opens the dialog, and Cancel sends nothing;
//  - it checks VYRE only;
//  - the dialog's words are MINTA's own: nothing the service sends is shown but an address that passed an address check;
//  - the app's own calls (a launch, a buy, a sell with a permit, an exact approval) raise no flag by the service's rules, which
//    the stand-in applies to the real calls the SDK builds when the app's own trade functions run against a stand-in chain.
// `npm test` here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createPublicClient, createWalletClient, custom, decodeFunctionData, encodeFunctionData, getAddress, maxUint256, parseUnits, encodeAbiParameters } from 'viem';
import { buy, getAddresses, launch, sell, vyreAppRouterAbi, vyrePadAbi, vyreTestnet, vyreTokenAbi } from '@vyrechain/sdk';
import {
  CHECK_BUDGET_MS, CheckCancelled, askToContinue, concernsOf, currentRequest, describe, guardProvider, pinTo, reviewBeforeSend, wasCancelledByCheck,
} from '../src/lib/txcheck.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTHER = '0x1111111111111111111111111111111111111111';
const FLAGGED = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const A = getAddresses(vyreTestnet.id);
const E18 = 10n ** 18n;
const TX = { from: ME, to: OTHER, data: '0xdeadbeef', value: '0x2710' };
const ok = { advisory: true, chainId: 7357, simulated: true, reverts: false, revertReason: null, nativeChange: '0', transfers: [], approvals: [], addressChecks: { source: 'goplus', available: true, checked: [] }, flags: [] };
const flag = (code, extra = {}) => ({ code, message: `the service’s own sentence for ${code}`, ...extra });

/** A stand-in check service: `answer(req, res, body)` decides each reply; `hits` holds what it was sent */
async function standIn(answer) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* not JSON */ }
      hits.push({ method: req.method, url: req.url, body, type: req.headers['content-type'] });
      answer(req, res, body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/txcheck`, hits,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}
const json = (code, body, extra = {}) => (_q, res) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const after = (ms, f) => (q, r, b) => { setTimeout(() => f(q, r, b), ms).unref(); };

/** A wallet that records everything it is asked, answers its network (`w.chain`: VYRE's unless changed) and a send with a hash; `calls` counts the sends it was given */
function wallet({ send = (n) => `0x${n.toString(16).padStart(64, '0')}`, chain = 7357 } = {}) {
  const asked = [];
  const w = {
    asked, calls: 0, chain,
    request: async (args) => {
      asked.push(args);
      if (args.method === 'eth_chainId') return `0x${w.chain.toString(16)}`;
      if (args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction') { w.calls++; return send(w.calls); }
      return null;
    },
    on() { return this === w ? 'bound' : 'unbound'; },
    removeListener() {},
    label: 'a wallet',
  };
  return w;
}
const sendTx = (tx = TX) => ({ method: 'eth_sendTransaction', params: [tx] });
const timed = async (f) => { const t = Date.now(); const r = await f(); return [r, Date.now() - t]; };

// ---------------------------------------------------------------------------------------------------------------
// Reading an answer
// ---------------------------------------------------------------------------------------------------------------

test('an answer with nothing in it says nothing, and every kind of "no answer" says nothing', () => {
  assert.deepEqual(concernsOf({ available: true, ...ok }), []);
  for (const x of [null, undefined, 0, 'x', [], {}, { available: false, reason: 'timeout' }, { available: true }, { available: true, advisory: false, simulated: true, flags: [flag('reverts')] },
    // the node's simulation didn't happen and nothing else was found: silent (a flagged address is the one thing it still says: next test)
    { available: true, ...ok, simulated: false, reason: 'trace_unavailable', flags: [] },
    { available: true, ...ok, simulated: false, reason: 'trace_unavailable', reverts: true, flags: [flag('reverts'), flag('unlimited_approval', { spender: FLAGGED })] },
    { available: true, ...ok, simulated: 'true', flags: [flag('reverts')] },
    { available: true, ...ok, flags: 'reverts' }]) assert.deepEqual(concernsOf(x), [], JSON.stringify(x));
});

test('without a simulation a flagged address is still said, and nothing else is', () => {
  const c = concernsOf({ available: true, ...ok, simulated: false, reason: 'timeout', reverts: true, flags: [flag('reverts'), flag('unlimited_approval', { spender: FLAGGED }), flag('flagged_address', { address: FLAGGED, roles: ['to'] })] });
  assert.deepEqual(c, [{ code: 'flagged_address', address: FLAGGED, role: 'to' }]);
});

test('each kind of flag becomes one concern, with only well-formed addresses', () => {
  const c = concernsOf({
    available: true, ...ok,
    flags: [
      flag('reverts'),
      flag('unlimited_approval', { token: TOKEN, spender: OTHER }),
      flag('approval_to_unknown_spender', { token: TOKEN, spender: FLAGGED.toLowerCase() }),
      flag('flagged_address', { address: FLAGGED, roles: ['to'], categories: ['phishing_activities'] }),
    ],
  });
  assert.deepEqual(c.map((x) => x.code), ['reverts', 'unlimited_approval', 'approval_to_unknown_spender', 'flagged_address']);
  assert.equal(c[1].address, OTHER);
  assert.equal(c[2].address, FLAGGED.toLowerCase());
  assert.equal(c[3].address, FLAGGED);
  // the service's categories are never carried into what is shown
  assert.ok(!JSON.stringify(c).includes('phishing'));
});

test('"would fail" alone is a concern, once', () => {
  assert.deepEqual(concernsOf({ available: true, ...ok, reverts: true }).map((x) => x.code), ['reverts']);
  assert.deepEqual(concernsOf({ available: true, ...ok, reverts: true, flags: [flag('reverts')] }).map((x) => x.code), ['reverts']);
  assert.deepEqual(concernsOf({ available: true, ...ok, reverts: 'yes' }), []);
});

test('a hostile answer is read safely: unknown codes dropped, bad addresses dropped, the list kept short', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const c = concernsOf({
    available: true, ...ok,
    flags: [
      null, 5, 'reverts', [], { code: '__proto__' }, { code: 'constructor' }, { code: 'toString' }, { code: 'sanctioned' }, { code: 'REVERTS' },
      flag('unlimited_approval', { spender: evil }),
      flag('flagged_address', { address: { toString: () => OTHER }, roles: ['to'] }),
      flag('flagged_address', { address: `${OTHER}00`, roles: ['<b>', 7, null] }),
      flag('flagged_address', { address: FLAGGED, roles: ['constructor', {}, 'toString'] }),
      flag('flagged_address', { address: OTHER, roles: 'to' }),
      flag('flagged_address', { address: TOKEN, roles: ['counterparty', 'spender', 'to'] }),
    ],
  });
  assert.deepEqual(c.map((x) => [x.code, x.address, x.role]), [
    ['unlimited_approval', undefined, undefined],
    ['flagged_address', undefined, 'to'],
    ['flagged_address', undefined, undefined],
    ['flagged_address', FLAGGED, undefined],
    ['flagged_address', OTHER, undefined],
    ['flagged_address', TOKEN, 'to'],
  ]);
  // a flood of flags: read at most 50, show at most 6 different ones
  const flood = Array.from({ length: 100000 }, (_, i) => flag('flagged_address', { address: `0x${i.toString(16).padStart(40, '0')}` }));
  assert.ok(concernsOf({ available: true, ...ok, flags: flood }).length <= 6);
  // a getter that throws, a proxy that throws: nothing, not an error
  assert.deepEqual(concernsOf(new Proxy({}, { get() { throw new Error('no'); } })), []);
});

test('the words are MINTA’s own: the service’s sentences never reach them, and they never call anything safe', () => {
  const evil = '<img src=x onerror="window.pwned=1"><script>alert(1)</script>';
  const all = ['reverts', 'unlimited_approval', 'approval_to_unknown_spender', 'flagged_address'].flatMap((code) => ['to', 'spender', 'counterparty', undefined].map((role) => describe({ code, address: FLAGGED, role })));
  for (const d of all) {
    const text = JSON.stringify(d);
    assert.ok(!/[<>]/.test(text), text);
    assert.ok(!/\bsafe|\bsecure|\bverified|\btrusted|\bno risk|\bscam|\bfraud|\bmalicious|\bphishing/i.test(text), `no verdict in: ${text}`);
  }
  // a flagged address is information, not a verdict
  assert.match(describe({ code: 'flagged_address', address: FLAGGED }).text, /A security service has flagged an address[^.]*\. That is information, not a verdict/);
  // whatever the service puts in its own fields, the concerns (all that is ever shown) hold none of it
  const c = concernsOf({ available: true, ...ok, flags: [{ code: 'flagged_address', message: evil, address: evil, role: evil, categories: [evil], roles: [evil, evil] }, { code: 'unlimited_approval', message: evil, spender: evil, token: evil }] });
  assert.ok(!JSON.stringify([c, c.map(describe)]).includes('pwned'));
  assert.ok(!JSON.stringify([c, c.map(describe)]).includes('<'));
});

// ---------------------------------------------------------------------------------------------------------------
// The wrapper, against a stand-in service
// ---------------------------------------------------------------------------------------------------------------

test('a flag opens the question before the wallet: Continue anyway goes on, Cancel sends nothing', async () => {
  const api = await standIn(json(200, { ...ok, flags: [flag('flagged_address', { address: FLAGGED, roles: ['to'] })] }));
  try {
    const asks = [];
    // Continue anyway
    let w = wallet();
    let g = guardProvider(w, { chainId: 7357, url: api.url, ask: async (c) => { asks.push(c); assert.equal(w.calls, 0, 'the wallet isn’t asked before the question is answered'); return true; } });
    assert.equal(await g.request(sendTx()), `0x${'1'.padStart(64, '0')}`);
    // (the wallet's network is asked again once the question is answered, right before the send: see below)
    assert.deepEqual(w.asked, [{ method: 'eth_chainId' }, sendTx()]);
    assert.equal(asks.length, 1);
    assert.deepEqual(asks[0].map((x) => [x.code, x.address]), [['flagged_address', FLAGGED]]);
    // Cancel
    w = wallet();
    g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => false });
    await assert.rejects(g.request(sendTx()), (e) => e instanceof CheckCancelled && e.code === 4001 && e.name === 'CheckCancelled' && /Nothing was sent/.test(e.message) && wasCancelledByCheck(e));
    assert.equal(w.calls, 0);
    // a question that fails is a Cancel too: nothing is sent on a failure of the dialog
    g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => { throw new Error('the dialog broke'); } });
    await assert.rejects(g.request(sendTx()), (e) => e instanceof CheckCancelled);
    assert.equal(w.calls, 0);
  } finally { await api.close(); }
});

test('what the service is sent: the transaction’s own from, to, data, value and the chain, nothing else', async () => {
  const api = await standIn(json(200, ok));
  try {
    const g = guardProvider(wallet(), { chainId: 7357, url: api.url, ask: async () => assert.fail('no flags, no question') });
    await g.request(sendTx({ ...TX, gas: '0x30d40', chainId: '0x1cbd', maxFeePerGas: '0x1' }));
    assert.equal(api.hits.length, 1);
    assert.equal(api.hits[0].method, 'POST');
    assert.match(api.hits[0].type, /^application\/json/);
    assert.deepEqual(api.hits[0].body, { from: ME, to: OTHER, data: '0xdeadbeef', value: '10000', chainId: 7357 });
  } finally { await api.close(); }
});

test('an unflagged answer is silent: the wallet goes on, nothing is asked', async () => {
  const api = await standIn(json(200, ok));
  try {
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('asked') });
    await g.request(sendTx());
    assert.equal(w.calls, 1);
    assert.equal(currentRequest(), null);
  } finally { await api.close(); }
});

test('no answer, in any form, is silent: errors, busy, broken, hostile and absent services', async () => {
  const flagged = { ...ok, flags: [flag('reverts')], reverts: true };
  const cases = {
    'HTTP 429 busy': json(429, { error: 'busy: try again in a moment', busy: true, retryAfter: 1 }, { 'retry-after': '1' }),
    'HTTP 429 over the hour': json(429, { error: 'too many checks this hour: try later' }),
    'HTTP 403 for this page': json(403, { error: 'This check is for VYRE’s own sites in a browser; call it from your server.' }),
    'HTTP 400': json(400, { error: 'to must be an address' }),
    'HTTP 500': json(500, { error: 'boom' }),
    'HTTP 500 with a flagged-looking body': json(500, flagged),
    'HTTP 503 html': (_q, r) => { r.writeHead(503, { 'content-type': 'text/html' }); r.end('<h1>down</h1>'); },
    'HTTP 200 but not JSON': json(200, 'this is not json'),
    'HTTP 200 html': (_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<script>alert(1)</script>'); },
    'HTTP 200 empty': json(200, ''),
    'HTTP 200 null': json(200, 'null'),
    'HTTP 200 an array': json(200, '[]'),
    'HTTP 200 a number': json(200, '42'),
    'HTTP 200 without advisory': json(200, { ...flagged, advisory: undefined }),
    'HTTP 200 advisory false': json(200, { ...flagged, advisory: false }),
    'HTTP 200 simulated false': json(200, { ...flagged, simulated: false, reason: 'trace_unavailable' }),
    'HTTP 200 without flags': json(200, { advisory: true, simulated: true, addressChecks: {} }),
    'HTTP 200 truncated JSON': json(200, '{"advisory":true,"simulated":true,"flags":[{"code":"rev'),
    'a redirect': (_q, r) => { r.writeHead(302, { location: 'http://127.0.0.1:1/' }); r.end(); },
    'a hang-up': (q) => q.socket.destroy(),
    'a hang-up mid-answer': (_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.write('{"advisory":'); setTimeout(() => r.socket.destroy(), 20); },
  };
  for (const [name, answer] of Object.entries(cases)) {
    const api = await standIn(answer);
    try {
      const w = wallet();
      const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail(`asked after: ${name}`) });
      const [, ms] = await timed(() => g.request(sendTx()));
      assert.equal(w.calls, 1, name);
      assert.ok(ms < CHECK_BUDGET_MS + 500, `${name}: ${ms} ms`);
    } finally { await api.close(); }
  }
  // no service at all (nothing listens)
  const dead = await standIn(json(200, ok));
  await dead.close();
  const w = wallet();
  await guardProvider(w, { chainId: 7357, url: dead.url, ask: async () => assert.fail('asked') }).request(sendTx());
  assert.equal(w.calls, 1);
});

test('a slow service costs at most the budget, and a late answer is never shown', async () => {
  assert.equal(CHECK_BUDGET_MS, 800);
  const api = await standIn(after(5000, json(200, { ...ok, flags: [flag('reverts')] })));
  try {
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('asked on a late answer') });
    const [, ms] = await timed(() => g.request(sendTx()));
    assert.equal(w.calls, 1);
    assert.ok(ms >= CHECK_BUDGET_MS - 50 && ms < CHECK_BUDGET_MS + 400, `waited ${ms} ms`);
  } finally { await api.close(); }
  // an answer that arrives just after the budget (the wallet's prompt is already up) is dropped
  const late = await standIn(after(300, json(200, { ...ok, flags: [flag('reverts')] })));
  try {
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: late.url, budgetMs: 100, ask: async () => assert.fail('asked on a late answer') });
    await g.request(sendTx());
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(w.calls, 1);
    assert.equal(currentRequest(), null);
  } finally { await late.close(); }
});

test('a service that never finishes its answer is cut off at the budget', async () => {
  // headers at once, then a body that trickles for ever
  const api = await standIn((_q, r) => {
    r.writeHead(200, { 'content-type': 'application/json' });
    const t = setInterval(() => { try { r.write(' '); } catch { clearInterval(t); } }, 50);
    r.on('close', () => clearInterval(t));
  });
  try {
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('asked') });
    const [, ms] = await timed(() => g.request(sendTx()));
    assert.equal(w.calls, 1);
    assert.ok(ms < CHECK_BUDGET_MS + 400, `${ms} ms`);
  } finally { await api.close(); }
});

test('a hostile huge answer is read safely and costs no more than the budget', async () => {
  const flags = Array.from({ length: 200000 }, (_, i) => flag('flagged_address', { address: `0x${i.toString(16).padStart(40, '0')}`, message: '<img src=x onerror=alert(1)>'.repeat(5) }));
  const api = await standIn(json(200, { ...ok, flags }));
  try {
    const asks = [];
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async (c) => { asks.push(c); return true; } });
    const [, ms] = await timed(() => g.request(sendTx()));
    assert.ok(ms < CHECK_BUDGET_MS + 600, `${ms} ms`);
    // whatever it did, it was never more than six lines, and the wallet was only asked once
    assert.ok(asks.length <= 1 && (asks[0]?.length ?? 0) <= 6);
    assert.equal(w.calls, 1);
  } finally { await api.close(); }
});

test('only VYRE is checked: another chain’s wallet client is the wallet’s own provider, and a transaction naming another chain isn’t sent to the service', async () => {
  const api = await standIn(json(200, { ...ok, flags: [flag('reverts')] }));
  try {
    const w = wallet();
    // Arc's testnet, a chain USDC comes from, anything that isn't VYRE
    for (const id of [5042002, 84532, 11155111, 421614, 1]) {
      const g = guardProvider(w, { chainId: id, url: api.url, ask: async () => assert.fail(`asked for chain ${id}`) });
      assert.equal(g, w, 'the provider comes back untouched');
      await g.request(sendTx());
    }
    assert.equal(api.hits.length, 0);
    // asked directly for another chain: nothing is checked either
    await reviewBeforeSend([TX], { chainId: 5042002, url: api.url, ask: async () => assert.fail('asked') });
    // on VYRE's client, a transaction that names another chain
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('asked') });
    for (const chainId of ['0x1', 1, '84532', 5042002, 7358]) await g.request(sendTx({ ...TX, chainId }));
    assert.equal(api.hits.length, 0);
    // the same transaction naming VYRE is checked
    const asks = [];
    await guardProvider(w, { chainId: 7357, url: api.url, ask: async (c) => { asks.push(c); return true; } }).request(sendTx({ ...TX, chainId: '0x1cbd' }));
    assert.equal(api.hits.length, 1);
    assert.equal(asks.length, 1);
  } finally { await api.close(); }
});

const ARC_TESTNET = 5042002;
const FEES = { gas: 100000n, maxFeePerGas: 10n ** 7n, maxPriorityFeePerGas: 0n };
const movedOff = (e) => /moved to another network/.test(e.shortMessage ?? '') && /nothing was sent/i.test(e.shortMessage ?? '') && !wasCancelledByCheck(e);

test('the wallet’s network is asked again after the check: one that moved while the question was open sends nothing', async () => {
  // viem asks the wallet's network, then sends a request with no chain in it, so the wallet signs for whatever network it is
  // on at that moment: the check (and its question) sits between the two, so the guard asks again right before the send
  const api = await standIn(json(200, { ...ok, flags: [flag('flagged_address', { address: FLAGGED, roles: ['to'] })] }));
  try {
    const w = wallet();
    const client = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(w, { chainId: 7357, url: api.url, ask: async () => { w.chain = ARC_TESTNET; return true; } })) });
    await assert.rejects(client.sendTransaction({ to: FLAGGED, value: 100n * E18, ...FEES }), movedOff);
    assert.equal(w.calls, 0, 'nothing was sent');
    assert.deepEqual(w.asked.map((x) => x.method), ['eth_chainId', 'eth_chainId'], 'viem asked before the check, the guard asked again after it');
    // moved away and back before Continue anyway: it goes on, on VYRE
    const w2 = wallet();
    const c2 = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(w2, { chainId: 7357, url: api.url, ask: async () => { w2.chain = ARC_TESTNET; await new Promise((r) => setTimeout(r, 5)); w2.chain = 7357; return true; } })) });
    assert.match(await c2.sendTransaction({ to: FLAGGED, value: 1n, ...FEES }), /^0x[0-9a-f]{64}$/);
    assert.equal(w2.calls, 1);
  } finally { await api.close(); }
});

test('a network that changes while the check is waiting for its answer (no question shown) sends nothing too', async () => {
  const api = await standIn(after(300, json(200, ok)));
  try {
    const w = wallet();
    const client = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('no flag, nothing asked') })) });
    setTimeout(() => { w.chain = ARC_TESTNET; }, 50).unref();
    await assert.rejects(client.sendTransaction({ to: OTHER, value: 1n, ...FEES }), movedOff);
    assert.equal(w.calls, 0);
    // a wallet whose network can't be read after the check isn't taken to be on VYRE
    for (const answer of [null, '', 'vyre', {}, () => { throw new Error('no answer'); }]) {
      const odd = wallet();
      let n = 0;
      const request = odd.request;
      odd.request = async (args) => (args.method === 'eth_chainId' && n++ > 0 ? (typeof answer === 'function' ? answer() : answer) : request(args));
      const c = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(odd, { chainId: 7357, url: api.url })) });
      await assert.rejects(c.sendTransaction({ to: OTHER, value: 1n, ...FEES }));
      assert.equal(odd.calls, 0, String(answer));
    }
  } finally { await api.close(); }
});

test('wallet_sendTransaction is checked as eth_sendTransaction is: viem’s fallback to it, and every later send on that client', async () => {
  const api = await standIn(json(200, { ...ok, flags: [flag('flagged_address', { address: FLAGGED, roles: ['to'] })] }));
  try {
    // asked directly
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => false });
    await assert.rejects(g.request({ method: 'wallet_sendTransaction', params: [{ ...TX, to: FLAGGED }] }), (e) => e instanceof CheckCancelled);
    assert.equal(w.calls, 0);
    assert.equal(api.hits.length, 1);
    // a wallet that answers eth_sendTransaction with "method not found": viem resends the same request as wallet_sendTransaction,
    // and from then on sends that way on this client. Each send is asked about once (the resent one isn't asked twice)
    const methods = [];
    const refuses = wallet();
    const request = refuses.request;
    refuses.request = async (args) => {
      methods.push(args.method);
      if (args.method === 'eth_sendTransaction') throw Object.assign(new Error('the method eth_sendTransaction does not exist'), { code: -32601 });
      return request(args);
    };
    let asks = 0;
    const client = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(refuses, { chainId: 7357, url: api.url, ask: async () => { asks++; return true; } })) });
    for (let i = 0; i < 3; i++) await client.sendTransaction({ to: FLAGGED, value: 1n, ...FEES });
    assert.deepEqual(methods.filter((m) => m !== 'eth_chainId'), ['eth_sendTransaction', 'wallet_sendTransaction', 'wallet_sendTransaction', 'wallet_sendTransaction']);
    assert.equal(asks, 3, 'three sends to a flagged address: three questions');
    assert.equal(api.hits.length, 1 + 3);
    // only the very request just refused goes on without a second question: a different one after it is checked
    const answers = [true, false, true, false];
    const g2 = guardProvider(refuses, { chainId: 7357, url: api.url, ask: async () => answers.shift() });
    await assert.rejects(g2.request(sendTx({ ...TX, to: FLAGGED })), (e) => e.code === -32601);
    await assert.rejects(g2.request({ method: 'wallet_sendTransaction', params: [{ ...TX, to: FLAGGED, value: '0x1' }] }), (e) => e instanceof CheckCancelled);
    // and a wallet_sendTransaction on its own, a while after, is checked even with the same request
    await assert.rejects(g2.request(sendTx({ ...TX, to: FLAGGED })), (e) => e.code === -32601);
    await g2.request({ method: 'eth_accounts' });
    await assert.rejects(g2.request({ method: 'wallet_sendTransaction', params: [{ ...TX, to: FLAGGED }] }), (e) => e instanceof CheckCancelled);
    assert.deepEqual(answers, [], 'each of the four was asked about');
  } finally { await api.close(); }
});

test('only a send is checked; everything else, and anything that isn’t a well-formed send, goes straight to the wallet', async () => {
  const api = await standIn(json(200, { ...ok, flags: [flag('reverts')] }));
  try {
    const w = wallet();
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async () => assert.fail('asked') });
    for (const args of [
      { method: 'eth_chainId' }, { method: 'personal_sign', params: ['0x00', ME] }, { method: 'eth_signTypedData_v4', params: [ME, '{}'] }, { method: 'eth_accounts', params: [] },
      // sends the check can't make sense of go on unchecked
      { method: 'eth_sendTransaction' }, { method: 'eth_sendTransaction', params: [] }, { method: 'eth_sendTransaction', params: [null] }, { method: 'eth_sendTransaction', params: 'x' },
      sendTx({ from: ME, data: '0x' }), // no `to`: a contract creation
      sendTx({ ...TX, to: '0x12' }), sendTx({ ...TX, from: 'me' }), sendTx({ ...TX, data: '0xzz' }), sendTx({ ...TX, data: 5 }), sendTx({ ...TX, value: '-1' }), sendTx({ ...TX, value: 7 }),
      sendTx({ ...TX, data: `0x${'ab'.repeat(24 * 1024 + 1)}` }),
    ]) {
      await g.request(args);
    }
    assert.equal(api.hits.length, 0);
    assert.equal(w.asked.length, 16);
    assert.deepEqual(w.asked.map((x) => x.method).filter((m) => m === 'eth_chainId'), ['eth_chainId'], 'nothing was checked, so the network isn’t asked again either');
  } finally { await api.close(); }
});

test('the wrapper is the wallet itself for everything else: its other members, bound to it, and its errors unchanged', async () => {
  const w = wallet({ send: () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); } });
  const api = await standIn(json(200, ok));
  try {
    const g = guardProvider(w, { chainId: 7357, url: api.url });
    assert.equal(g.on('x', () => {}), 'bound');
    assert.equal(g.label, 'a wallet');
    await assert.rejects(g.request(sendTx()), (e) => e.code === 4001 && e.message === 'User rejected the request.' && !wasCancelledByCheck(e));
  } finally { await api.close(); }
});

const tick = () => new Promise((r) => setTimeout(r, 5));
test('the dialog’s question is one at a time: a second one waits for the first to be answered, nobody’s Cancel is made for them', async () => {
  const first = askToContinue([{ code: 'reverts' }]);
  const open = currentRequest();
  assert.deepEqual(open.concerns, [{ code: 'reverts' }]);
  const second = askToContinue([{ code: 'unlimited_approval', address: OTHER }]);
  await tick();
  assert.equal(currentRequest(), open, 'still the first one on screen');
  open.proceed();
  assert.equal(await first, true);
  await tick();
  assert.notEqual(currentRequest(), open);
  assert.deepEqual(currentRequest().concerns, [{ code: 'unlimited_approval', address: OTHER }]);
  currentRequest().cancel();
  assert.equal(await second, false);
  assert.equal(currentRequest(), null);
  const third = askToContinue([{ code: 'reverts' }]);
  currentRequest().cancel();
  assert.equal(await third, false);
  assert.equal(currentRequest(), null);
});

test('three questions in a row are answered in turn, in order, each by the person', async () => {
  const answers = [];
  const qs = [1, 2, 3].map((n) => askToContinue([{ code: 'flagged_address', address: `0x${String(n).repeat(40)}` }]).then((go) => answers.push([n, go])));
  for (const go of [true, false, true]) { await tick(); currentRequest().concerns; (go ? currentRequest().proceed : currentRequest().cancel)(); }
  await Promise.all(qs);
  assert.deepEqual(answers, [[1, true], [2, false], [3, true]]);
  assert.equal(currentRequest(), null);
});

test('a wallet with a frozen provider still sends (a Proxy over the provider itself would throw when viem reads `request`)', async () => {
  const sent = [];
  const frozen = Object.freeze({ request: async (a) => { sent.push(a.method); return a.method === 'eth_sendTransaction' ? `0x${'1'.repeat(64)}` : a.method === 'eth_chainId' ? '0x1cbd' : null; }, on() {}, removeListener() {} });
  const fees = { gas: 100000n, maxFeePerGas: 10n ** 10n, maxPriorityFeePerGas: 0n, nonce: 0 };
  const api = await standIn(json(200, ok));
  try {
    const g = guardProvider(frozen, { chainId: 7357, url: api.url, ask: async () => assert.fail('no flag, nothing asked') });
    const client = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(g) });
    const hash = await client.sendTransaction({ to: OTHER, data: '0xdeadbeef', value: 10000n, ...fees });
    assert.equal(hash, `0x${'1'.repeat(64)}`);
    assert.ok(sent.includes('eth_sendTransaction'));
    assert.equal(api.hits.length, 1, 'it was checked');
  } finally { await api.close(); }
  // and a provider whose `request` is read-only and non-configurable, the same
  const odd = {}; Object.defineProperty(odd, 'request', { value: async (a) => (a.method === 'eth_chainId' ? '0x1cbd' : `0x${'2'.repeat(64)}`), writable: false, configurable: false });
  const g2 = guardProvider(odd, { chainId: 7357, url: 'http://127.0.0.1:1/txcheck' });
  const client2 = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(g2) });
  assert.equal(await client2.sendTransaction({ to: OTHER, value: 1n, ...fees }), `0x${'2'.repeat(64)}`);
});

test('the check follows the app’s own VYRE chain id: a mainnet-shaped app is checked, and the testnet id is then not', async () => {
  const api = await standIn(json(200, { ...ok, reverts: true, flags: [flag('reverts')] }));
  try {
    const asked = [];
    const ask = async (c) => { asked.push(c); return true; };
    const w = wallet({ chain: 9999 });
    // an app whose VYRE is chain 9999 (the id here is made up): its sends are checked; its url is its own
    await guardProvider(w, { chainId: 9999, vyreChainId: 9999, url: api.url, ask }).request(sendTx());
    assert.equal(asked.length, 1, 'checked');
    assert.equal(api.hits[0].body.chainId, 9999);
    // a wallet client for another chain than the app's VYRE is passed straight through
    const raw = wallet();
    assert.equal(guardProvider(raw, { chainId: 7357, vyreChainId: 9999, url: api.url, ask }), raw);
    await reviewBeforeSend([TX], { chainId: 7357, vyreChainId: 9999, url: api.url, ask });
    assert.equal(asked.length, 1, 'not checked');
  } finally { await api.close(); }
});

test('a flagged address said to be the contract the transaction calls is only that if it is: the service can’t name another under that sentence', () => {
  const mk = (address, role) => [{ code: 'flagged_address', address, role }];
  assert.deepEqual(pinTo(mk(OTHER, 'to'), OTHER), mk(OTHER, 'to'));
  assert.deepEqual(pinTo(mk(OTHER.toUpperCase().replace('0X', '0x'), 'to'), OTHER), mk(OTHER.toUpperCase().replace('0X', '0x'), 'to'));
  assert.deepEqual(pinTo(mk(FLAGGED, 'to'), OTHER), mk(FLAGGED, undefined));
  assert.deepEqual(pinTo(mk(FLAGGED, 'spender'), OTHER), mk(FLAGGED, 'spender'));
  assert.deepEqual(pinTo([{ code: 'reverts' }], OTHER), [{ code: 'reverts' }]);
});

test('wasCancelledByCheck finds it under viem’s wrapping, and nothing else', () => {
  assert.equal(wasCancelledByCheck(new CheckCancelled()), true);
  assert.equal(wasCancelledByCheck({ name: 'UserRejectedRequestError', cause: { name: 'x', cause: new CheckCancelled() } }), true);
  for (const x of [null, undefined, 'CheckCancelled', {}, new Error('Cancelled. Nothing was sent.'), { name: 'UserRejectedRequestError', code: 4001 }]) assert.equal(wasCancelledByCheck(x), false);
  const loop = { name: 'x' }; loop.cause = loop;
  assert.equal(wasCancelledByCheck(loop), false);
});

// ---------------------------------------------------------------------------------------------------------------
// The app's own calls, built by the SDK's own trade functions running against a stand-in chain, raise no flag
// ---------------------------------------------------------------------------------------------------------------

const KNOWN = new Set([A.pad, A.appRouter, A.feeSplitter].map((a) => a.toLowerCase()));
const UNLIMITED = 1n << 255n;
const ABIS = [vyreAppRouterAbi, vyrePadAbi, vyreTokenAbi];
const decode = (data) => { for (const abi of ABIS) { try { return decodeFunctionData({ abi, data }); } catch { /* the next */ } } return null; };

/**
 * The service's flag rules, as its API reference documents them, applied to what a call does to the sender's allowances: an allowance of at least 2^255 is unlimited; an allowance given to anyone but this deployment's own pad, router and fee
 * splitter is to an unknown spender; and any address that isn't one of those (the destination first) goes to the address check,
 * which here flags only `FLAGGED`. Only the calls that give an allowance are given one here: an approve, and a sale with a permit.
 */
function rules(tx) {
  const flags = [];
  const call = decode(tx.data);
  const allowances = [];
  if (call?.functionName === 'approve') allowances.push({ spender: call.args[0], amount: call.args[1] });
  if (call?.functionName === 'sellWithPermit') allowances.push({ spender: A.appRouter, amount: call.args[1] }); // the permit's value is the sale's amount
  for (const x of allowances) {
    if (x.amount >= UNLIMITED) flags.push(flag('unlimited_approval', { spender: x.spender }));
    if (!KNOWN.has(x.spender.toLowerCase()) && x.amount > 0n) flags.push(flag('approval_to_unknown_spender', { spender: x.spender }));
  }
  const looked = [tx.to, ...allowances.map((x) => x.spender)].filter((a) => !KNOWN.has(a.toLowerCase()));
  for (const a of looked) if (a.toLowerCase() === FLAGGED) flags.push(flag('flagged_address', { address: a, roles: ['to'] }));
  return flags;
}
const rulesApi = () => standIn((q, r, body) => json(200, { ...ok, flags: rules(body) })(q, r));

const abiWord = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values);
/** The chain as the SDK's trade functions see it: the node answers just what they ask, and `world.sent` is what the wallet was sent */
function world({ allowance = 0n, typedData = true, api, ask }) {
  const sent = [];
  const state = { chain: 7357 }; // the network the wallet is on
  const nodeCall = ({ to, data }) => {
    const sel = data.slice(0, 10);
    if (sel === '0xdd62ed3e') return abiWord(['uint256'], [allowance]); // allowance
    if (sel === '0x06fdde03') return abiWord(['string'], ['Stand-in Token']); // name
    if (sel === '0x7ecebe00') return abiWord(['uint256'], [0n]); // nonces
    if (sel === '0x095ea7b3') return abiWord(['bool'], [true]); // approve
    return `0x${'00'.repeat(32 * 8)}`; // the router's and the pad's own outputs (numbers and addresses): zeros
  };
  const node = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return '0x1cbd';
      if (method === 'eth_call') return nodeCall(params[0]);
      if (method === 'eth_estimateGas') return '0x7a120';
      throw new Error(`the node was asked ${method}`);
    },
  };
  const wallet = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return `0x${state.chain.toString(16)}`;
      if (method === 'eth_signTypedData_v4') {
        if (!typedData) throw Object.assign(new Error('The method eth_signTypedData_v4 does not exist/is not available'), { code: -32601 });
        return `0x${'11'.repeat(32)}${'22'.repeat(32)}1b`;
      }
      if (method === 'eth_sendTransaction') { sent.push(params[0]); throw Object.assign(new Error('stop here'), { code: 5000 }); } // where each flow stops: what comes after its first send is not this test's business
      throw new Error(`the wallet was asked ${method}`);
    },
  };
  const publicClient = createPublicClient({ chain: vyreTestnet, transport: custom(node) });
  const walletClient = createWalletClient({ account: ME, chain: vyreTestnet, transport: custom(guardProvider(wallet, { chainId: 7357, url: api.url, ask })) });
  return { publicClient, walletClient, sent, state };
}
const never = async (c) => assert.fail(`the check raised a concern on the app's own call: ${JSON.stringify(c)}`);
/** Runs `flow` until the wallet's first send; returns what the wallet was sent */
async function firstSend(flow, opts) {
  const w = world(opts);
  await assert.rejects(flow(w));
  return w.sent;
}

test('the app’s buy, with its exact USDC value, raises no flag', async () => {
  const api = await rulesApi();
  try {
    const [tx] = await firstSend((w) => buy(w.walletClient, w.publicClient, { token: TOKEN, usdcIn: 5n * E18, minTokensOut: 1n }), { api, ask: never });
    assert.equal(tx.to.toLowerCase(), A.appRouter.toLowerCase());
    assert.equal(decode(tx.data).functionName, 'buy');
    assert.equal(BigInt(tx.value), 5n * E18);
    assert.equal(api.hits.length, 1);
    assert.deepEqual(rules(api.hits[0].body), []);
  } finally { await api.close(); }
});

test('the app’s launch, with its first buy in the same transaction, raises no flag', async () => {
  const api = await rulesApi();
  try {
    const [tx] = await firstSend((w) => launch(w.walletClient, w.publicClient, { name: 'My Token', symbol: 'MYT', totalSupply: 1_000_000n * E18, buyTaxBps: 200, sellTaxBps: 100, firstBuyUsdc: parseUnits('2', 18) }), { api, ask: never });
    assert.equal(tx.to.toLowerCase(), A.pad.toLowerCase());
    assert.equal(decode(tx.data).functionName, 'createLaunch');
    assert.equal(api.hits.length, 1);
  } finally { await api.close(); }
});

test('the app’s sell is one transaction with a permit for exactly the amount, and raises no flag', async () => {
  const api = await rulesApi();
  try {
    const amountIn = 1234n * E18;
    // the wallet signs the permit (no transaction), and the sale carries it
    const sent = await firstSend((w) => sell(w.walletClient, w.publicClient, { token: TOKEN, amountIn, minUsdcOut: 1n }), { api, ask: never });
    assert.equal(sent.length, 1);
    const call = decode(sent[0].data);
    assert.equal(call.functionName, 'sellWithPermit');
    assert.equal(sent[0].to.toLowerCase(), A.appRouter.toLowerCase());
    assert.equal(call.args[1], amountIn);
    assert.ok(call.args[1] < UNLIMITED);
    assert.deepEqual(rules(api.hits[0].body), []);
  } finally { await api.close(); }
});

test('the app’s sell with an allowance already in place is one plain sale, and raises no flag', async () => {
  const api = await rulesApi();
  try {
    const sent = await firstSend((w) => sell(w.walletClient, w.publicClient, { token: TOKEN, amountIn: 5n * E18, minUsdcOut: 1n }), { api, ask: never, allowance: 5n * E18 });
    assert.equal(decode(sent[0].data).functionName, 'sell');
    assert.deepEqual(rules(api.hits[0].body), []);
  } finally { await api.close(); }
});

test('a wallet that can’t sign a permit gets an approval for exactly the amount, to the router, and it raises no flag', async () => {
  const api = await rulesApi();
  try {
    const amountIn = 777n * E18;
    const sent = await firstSend((w) => sell(w.walletClient, w.publicClient, { token: TOKEN, amountIn, minUsdcOut: 1n }), { api, ask: never, typedData: false });
    const call = decode(sent[0].data);
    assert.equal(call.functionName, 'approve');
    assert.equal(sent[0].to.toLowerCase(), TOKEN);
    assert.equal(call.args[0].toLowerCase(), A.appRouter.toLowerCase(), 'the spender is the router');
    assert.equal(call.args[1], amountIn, 'for exactly the amount');
    assert.deepEqual(rules(api.hits[0].body), []);
  } finally { await api.close(); }
});

test('the app’s buy, asked about and then continued after the wallet moved to Arc, is never sent, and says why in plain words', async () => {
  // a buy of 100 USDC: the router's address has no contract on Arc's testnet and USDC is that network's own currency, so a send there would strand it
  const api = await standIn(json(200, { ...ok, flags: [flag('flagged_address', { address: A.appRouter, roles: ['to'] })] }));
  try {
    let w;
    w = world({ api, ask: async () => { w.state.chain = ARC_TESTNET; return true; } });
    const e = await buy(w.walletClient, w.publicClient, { token: TOKEN, usdcIn: 100n * E18, minTokensOut: 1n }).then(() => assert.fail('sent'), (x) => x);
    assert.ok(movedOff(e), e.shortMessage);
    assert.match(e.shortMessage.split('\n')[0], /^Your wallet moved to another network before this was sent, so nothing was sent/);
    assert.deepEqual(w.sent, [], 'the wallet was never asked to send');
  } finally { await api.close(); }
});

test('the service’s rules are not vacuous: an unlimited approval, or an allowance to anyone else, is flagged and asked about', async () => {
  const api = await rulesApi();
  try {
    const approve = (spender, amount) => ({ from: ME, to: TOKEN, data: encodeFunctionData({ abi: vyreTokenAbi, functionName: 'approve', args: [spender, amount] }), value: '0x0' });
    const w = wallet();
    const seen = [];
    const g = guardProvider(w, { chainId: 7357, url: api.url, ask: async (c) => { seen.push(c.map((x) => x.code)); return false; } });
    for (const tx of [approve(A.appRouter, maxUint256), approve(OTHER, 5n), approve(A.appRouter, 5n * E18), { from: ME, to: FLAGGED, data: '0x', value: '0x1' }]) {
      await g.request(sendTx(tx)).catch((e) => assert.ok(e instanceof CheckCancelled));
    }
    assert.deepEqual(seen, [['unlimited_approval'], ['approval_to_unknown_spender'], ['flagged_address']]);
    assert.equal(w.calls, 1, 'only the exact approval to the router went through');
  } finally { await api.close(); }
});

test('a wallet client for another chain, made the way the app makes one, sends nothing to the service', async () => {
  const api = await rulesApi();
  try {
    const w = wallet();
    const arc = createWalletClient({ account: ME, chain: { ...vyreTestnet, id: 5042002 }, transport: custom(guardProvider(w, { chainId: 5042002, url: api.url, ask: never })) });
    await arc.request({ method: 'eth_sendTransaction', params: [TX] });
    assert.equal(w.calls, 1);
    assert.equal(api.hits.length, 0);
  } finally { await api.close(); }
});

test('the page’s security policy already lets it reach the check service, and still allows no inline script', () => {
  const headers = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers.flatMap((h) => h.headers);
  const csp = headers.find((h) => h.key === 'Content-Security-Policy').value;
  const directive = (name) => csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? [];
  const connect = directive('connect-src');
  assert.ok(connect.includes('https:') || connect.includes('https://api.vyrechain.com'), `connect-src: ${connect.join(' ')}`);
  assert.deepEqual(directive('script-src'), ["'self'"]);
});
