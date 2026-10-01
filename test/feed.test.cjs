// The ticker's feed (src/lib/feed.ts) against a mocked chain, with no network: its own TypeScript is transpiled and its imports
// stubbed. What it must get right: the day's volume stays whole across polls, dust can't fill the line, a token shows once, the
// creator's first buy (part of the launch) is left out, buys and sells have the right sign, a long absence isn't read in full, and
// the totals that need the day's start are left out when it isn't known.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const src = fs.readFileSync(path.join(__dirname, '../src/lib/feed.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const PAGE = 50000n;
let chain;
const mocks = {
  '@vyrechain/sdk': { LOG_PAGE_BLOCKS: PAGE, isQuoteToken0: (t, q) => q.toLowerCase() < t.toLowerCase() },
  './chain': { vyre: {
    getBlockNumber: async () => chain.latest,
    getLogs: async (p) => { chain.calls.push([p.event === 'LC' ? 'launches' : 'swaps', p.fromBlock, p.toBlock]); return chain.logs(p); },
    getBlock: async ({ blockNumber }) => { chain.blockCalls++; if (chain.failBlocks) throw new Error('rpc'); return { timestamp: 1_700_000_000n + blockNumber * 2n }; },
  } },
  './market': { addresses: () => ({ pad: '0xpad', wusdc: '0x0000000000000000000000000000000000000001', startBlock: Number(chain.start ?? 0n) }), swapEvent: 'SW' },
  './stats': {
    launchCreated: 'LC',
    blockBefore: async () => chain.dayStart,
    pagedLogs: async (read, from, to) => {
      const out = [];
      for (let hi = to; hi >= from; hi -= PAGE) { const lo = hi - PAGE + 1n > from ? hi - PAGE + 1n : from; out.push(...(await read(lo, hi))); }
      return out;
    },
  },
};
function load() {
  const m = new Module('feed'); m.paths = [];
  const req = (id) => mocks[id] || require(id);
  new Function('require', 'module', 'exports', js)(req, m, m.exports);
  return m.exports;
}
const E = 10n ** 18n;
const pool = (i) => `0x${'b'.repeat(36)}${i.toString(16).padStart(4, '0')}`;
const tok = (i) => `0x${'c'.repeat(36)}${i.toString(16).padStart(4, '0')}`;
// USDC is token0 in the stand-in (isQuoteToken0 compares the addresses): amount0 > 0 is a buy
function makeChain({ launches = 3, latest = 1000n, dayStart = 100n } = {}) {
  const c = { latest, dayStart, calls: [], blockCalls: 0, failBlocks: false, L: [], S: [] };
  for (let i = 1; i <= launches; i++) {
    c.L.push({ blockNumber: 150n + BigInt(i), logIndex: 0, transactionHash: `0xlaunch${i}`, args: { token: tok(i), pool: pool(i), symbol: `T${i}`, name: `Token ${i}` } });
    c.S.push({ address: pool(i), blockNumber: 150n + BigInt(i), logIndex: 1, transactionHash: `0xlaunch${i}`, args: { amount0: 500n * E, amount1: -1n } }); // the creator's first buy
  }
  c.logs = (p) => (p.event === 'LC' ? c.L : c.S).filter((x) => x.blockNumber >= p.fromBlock && x.blockNumber <= p.toBlock);
  return c;
}
const swap = (c, i, block, usdc, buy = true, k = Math.random()) => c.S.push({ address: pool(i), blockNumber: block, logIndex: 2, transactionHash: `0xs${i}_${block}_${k}`, args: { amount0: buy ? usdc : -usdc, amount1: buy ? -1n : 1n } });

test('the creator’s first buy is left out; buys and sells have the right side and size', async () => {
  chain = makeChain({ launches: 2 });
  swap(chain, 1, 300n, 12n * E, true); swap(chain, 2, 310n, 7n * E, false);
  const { loadFeed, feedItems } = load();
  const items = await feedItems(await loadFeed());
  const trades = items.filter((i) => i.kind === 'trade');
  assert.deepEqual(trades.map((t) => [t.symbol, t.side, t.usdc]), [['T2', 'sell', 7], ['T1', 'buy', 12]]);
});

test('the day’s volume stays whole across polls (the displayed list is shorter than the day)', async () => {
  chain = makeChain({ launches: 1 });
  for (let k = 0; k < 100; k++) swap(chain, 1, 300n + BigInt(k), 2n * E); // 100 trades of $2: more than the 60 once kept
  const { loadFeed, feedItems } = load();
  let s = await loadFeed();
  const vol = (items) => items.find((i) => i.id === 's-volume')?.value;
  assert.equal(vol(await feedItems(s)), '$200.00');
  chain.latest = 1010n; swap(chain, 1, 1005n, 2n * E);
  s = await loadFeed(s);
  assert.equal(vol(await feedItems(s)), '$202.00', 'a second poll adds, it does not shrink');
  s = await loadFeed(s);
  assert.equal(vol(await feedItems(s)), '$202.00', 'and a poll with nothing new changes nothing');
});

test('dust is left out and a token shows once, so cheap trades can’t fill the line', async () => {
  chain = makeChain({ launches: 3 });
  for (let k = 0; k < 24; k++) swap(chain, 3, 900n + BigInt(k), 10n ** 12n); // 24 trades of 0.000001 on token 3
  for (let k = 0; k < 30; k++) swap(chain, 1 + (k % 2), 300n + BigInt(k), 50n * E); // real ones on tokens 1 and 2
  const { loadFeed, feedItems } = load();
  const trades = (await feedItems(await loadFeed())).filter((i) => i.kind === 'trade');
  assert.deepEqual(trades.map((t) => t.symbol).sort(), ['T1', 'T2'], 'one item each for the two real tokens, none for the dust');
});

test('without the day’s start the totals that need it are left out, and the launch count has no “in the last 24h”', async () => {
  chain = makeChain({ launches: 3, dayStart: null });
  swap(chain, 1, 300n, 5n * E);
  const { loadFeed, feedItems } = load();
  const items = await feedItems(await loadFeed());
  assert.equal(items.find((i) => i.id === 's-launches').value, '3');
  assert.equal(items.find((i) => i.id === 's-volume'), undefined);
});

test('a long absence is not read in full: the catch-up is capped, and the totals say they are partial', async () => {
  chain = makeChain({ launches: 1, latest: 1000n, dayStart: 100n });
  const { loadFeed, feedItems } = load();
  let s = await loadFeed();
  chain.latest = 20_000_000n; chain.dayStart = 19_900_000n; swap(chain, 1, 19_999_000n, 3n * E);
  chain.calls.length = 0; s.dayAt = 0;
  s = await loadFeed(s);
  const pages = chain.calls.filter((c) => c[0] === 'swaps').length;
  assert.ok(pages <= 41, `read ${pages} pages of swaps`);
  assert.equal(s.complete, false);
  assert.equal((await feedItems(s)).find((i) => i.id === 's-volume'), undefined);
});

test('a failed block-time lookup is not asked again at once, and the line still has its items', async () => {
  chain = makeChain({ launches: 1 });
  swap(chain, 1, 300n, 4n * E);
  chain.failBlocks = true;
  const { loadFeed, feedItems } = load();
  const s = await loadFeed();
  const first = await feedItems(s);
  const calls = chain.blockCalls;
  assert.ok(first.some((i) => i.kind === 'trade' && i.time === undefined), 'a trade with no time still shows');
  await feedItems(s);
  assert.equal(chain.blockCalls, calls, 'no new lookups within a minute of the failure');
});

test('a pad younger than a day still has whole totals; a chain older than one read’s reach does not, and says so by leaving them out', async () => {
  chain = makeChain({ launches: 2, dayStart: 100n }); chain.start = 150n; // the pad began after the day's start
  swap(chain, 1, 300n, 5n * E);
  let { loadFeed, feedItems } = load();
  let items = await feedItems(await loadFeed());
  assert.equal(items.find((i) => i.id === 's-launches').value, '2 · 2 in the last 24h');
  assert.equal(items.find((i) => i.id === 's-volume').value, '$5.00');
  // a chain far older than the cap: the first launch is out of reach, so neither total is claimed
  chain = makeChain({ launches: 2, latest: 20_000_000n, dayStart: 19_990_000n });
  chain.L[0].blockNumber = 100n; chain.S[0].blockNumber = 100n; // the first launch, long ago
  chain.L[1].blockNumber = 19_995_000n; chain.S[1].blockNumber = 19_995_000n;
  swap(chain, 1, 19_996_000n, 500n * E); swap(chain, 2, 19_996_000n, 5n * E);
  ({ loadFeed, feedItems } = load());
  items = await feedItems(await loadFeed());
  assert.equal(items.find((i) => i.id === 's-launches'), undefined, 'no launch count when the early launches weren’t read');
  assert.equal(items.find((i) => i.id === 's-volume'), undefined, 'and no volume that leaves out their trades');
});

test('a block number that goes backwards once does not double the launches', async () => {
  chain = makeChain({ launches: 2 });
  const { loadFeed, feedItems } = load();
  let s = await loadFeed();
  chain.latest = 900n; // one odd answer from the RPC
  s = await loadFeed(s);
  chain.latest = 1000n;
  s = await loadFeed(s);
  assert.equal(s.launches.length, 2);
  assert.equal(new Set(s.launches.map((l) => l.id)).size, 2);
  assert.ok(s.last >= 1000n);
  assert.equal((await feedItems(s)).find((i) => i.id === 's-launches').value, '2 · 2 in the last 24h');
});

test('dust can’t push real trades out of the kept rows or hide the volume', async () => {
  chain = makeChain({ launches: 2 });
  swap(chain, 1, 300n, 9n * E);
  for (let k = 0; k < 4500; k++) swap(chain, 2, 400n + BigInt(k % 500), 10n ** 12n, true, k);
  const { loadFeed, feedItems } = load();
  const s = await loadFeed();
  assert.ok(s.complete, 'still whole');
  const items = await feedItems(s);
  assert.equal(items.find((i) => i.id === 's-volume').value, '$9.00', 'the volume is of trades that count');
  assert.deepEqual(items.filter((i) => i.kind === 'trade').map((t) => t.symbol), ['T1']);
});

test('the day’s start never moves backwards', async () => {
  chain = makeChain({ launches: 1, dayStart: 500n });
  const { loadFeed } = load();
  let s = await loadFeed();
  assert.equal(s.dayStart, 500n);
  chain.dayStart = 200n; s.dayAt = 0; // the explorer answers with an earlier block once
  s = await loadFeed(s);
  assert.equal(s.dayStart, 500n);
});
