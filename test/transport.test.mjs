// The app's transport for VYRE (src/lib/transport.ts, with src/lib/fetchSplit.ts), against a stand-in public RPC on a local port.
// What it must get right: a log read's answer the RPC refuses as too large ("answer too large: narrow the filter", JSON-RPC -32005,
// sent with HTTP 200) is final for that read, so it asks for less at once instead of asking the same range again for about 16 seconds;
// the other calls of a batch refused that way, and the RPC's other refusals (busy, rate limited), are still asked again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPublicClient, LimitExceededRpcError } from 'viem';
import { isAnswerTooLarge, LOG_PAGE_BLOCKS, readLogsSplitting, vyreTestnet } from '@vyrechain/sdk';
import { vyreTransport } from '../src/lib/transport.ts';
import { fetchSplit } from '../src/lib/fetchSplit.ts';
import { pagedLogs } from '../src/lib/pieces.ts';

/**
 * A stand-in RPC: refuses a log range wider than `cap` blocks as too large, as the public RPC does (HTTP 200, -32005); while
 * `busy` > 0 it answers HTTP 429, and while `limited` > 0 it gives a -32005 that is not a size refusal. Answers single calls and batches.
 */
async function rpc(t, cap) {
  const s = { asked: [], posts: 0, busy: 0, limited: 0 };
  const one = (m) => {
    if (m.method !== 'eth_getLogs') return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no ${m.method}` } };
    const { fromBlock, toBlock } = m.params[0];
    s.asked.push(`${BigInt(fromBlock)}-${BigInt(toBlock)}`);
    if (s.limited > 0) { s.limited--; return { jsonrpc: '2.0', id: m.id, error: { code: -32005, message: 'limit exceeded' } }; }
    if (BigInt(toBlock) - BigInt(fromBlock) + 1n > cap) return { jsonrpc: '2.0', id: m.id, error: { code: -32005, message: 'answer too large: narrow the filter' } };
    return { jsonrpc: '2.0', id: m.id, result: [] };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      s.posts++;
      if (s.busy > 0) { s.busy--; res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"jsonrpc":"2.0","id":null,"error":{"code":-32005,"message":"busy"}}'); }
      const j = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.closeAllConnections(); server.close(); });
  s.url = `http://127.0.0.1:${server.address().port}`;
  return s;
}

const clientFor = (url) => createPublicClient({ chain: vyreTestnet, transport: vyreTransport(fetchSplit, url) });

test('a log range refused as too large is asked once and halved at once', { timeout: 120_000 }, async (t) => {
  const s = await rpc(t, 1000n);
  const client = clientFor(s.url);
  const t0 = Date.now();
  assert.deepEqual(await readLogsSplitting((lo, hi) => client.getLogs({ fromBlock: lo, toBlock: hi }), 0n, 1999n), []);
  assert.deepEqual(s.asked, ['0-1999', '0-999', '1000-1999'], 'each range asked once: the refusal is final for its call');
  assert.ok(Date.now() - t0 < 5000, `no waiting between tries (${Date.now() - t0} ms)`);
});

test('a busy pool’s trades read page by page: every refused page asked once and halved, no waiting', { timeout: 300_000 }, async (t) => {
  // a whole page is too large, half a page is not
  const P = LOG_PAGE_BLOCKS;
  const s = await rpc(t, P - 1n);
  const client = clientFor(s.url);
  const r = (lo, hi) => `${lo}-${hi}`;
  const halves = (lo, hi) => [r(lo, lo + (hi - lo) / 2n), r(lo + (hi - lo) / 2n + 1n, hi)];
  const t0 = Date.now();
  await pagedLogs((lo, hi) => client.getLogs({ fromBlock: lo, toBlock: hi }), 0n, 2n * P - 1n);
  // newest page first
  assert.deepEqual(s.asked, [r(P, 2n * P - 1n), ...halves(P, 2n * P - 1n), r(0n, P - 1n), ...halves(0n, P - 1n)]);
  assert.ok(Date.now() - t0 < 5000, `no waiting between tries (${Date.now() - t0} ms)`);
});

test('the refusal still reaches the caller as viem’s -32005 error, known as too large', { timeout: 120_000 }, async (t) => {
  const s = await rpc(t, 1000n);
  const e = await clientFor(s.url).request({ method: 'eth_getLogs', params: [{ fromBlock: '0x0', toBlock: '0x7cf' }] }).catch((x) => x);
  assert.ok(e instanceof LimitExceededRpcError, e?.name);
  assert.equal(e.code, -32005);
  assert.equal(isAnswerTooLarge(e), true);
  assert.equal(s.asked.length, 1);
});

test('the RPC’s other refusals are still retried: busy (HTTP 429) and a -32005 that is not about size', async (t) => {
  const s = await rpc(t, 1000n);
  const client = clientFor(s.url);
  s.busy = 2;
  assert.deepEqual(await client.getLogs({ fromBlock: 0n, toBlock: 10n }), []);
  assert.equal(s.posts, 3);
  assert.deepEqual(s.asked, ['0-10']);
  s.asked.length = 0;
  s.limited = 2;
  assert.deepEqual(await client.getLogs({ fromBlock: 0n, toBlock: 10n }), []);
  assert.deepEqual(s.asked, ['0-10', '0-10', '0-10']);
});

test('the transport is still viem’s http one, set up as the SDK sets it up', async (t) => {
  const s = await rpc(t, 1000n);
  const made = vyreTransport(fetchSplit, s.url)({ chain: vyreTestnet });
  assert.equal(made.config.type, 'http');
  assert.equal(made.config.retryCount, 6);
  assert.equal(made.config.retryDelay, 250);
  assert.equal(made.value.url, s.url);
});

/**
 * A stand-in RPC that sizes answers as the public RPC does for a batch: when the answers of one request add up to more than `cap`,
 * every call of that request gets the refusal as too large (a log read's answer counts one per block of its range, any other one).
 */
async function batchRpc(t, cap) {
  const s = { calls: [], posts: [] };
  const answer = (m) => {
    s.calls.push(m.method);
    if (m.method === 'eth_blockNumber') return { size: 1, out: { jsonrpc: '2.0', id: m.id, result: '0x10' } };
    if (m.method === 'eth_call') return { size: 1, out: { jsonrpc: '2.0', id: m.id, result: '0x' } };
    const { fromBlock, toBlock } = m.params[0];
    return { size: Number(BigInt(toBlock) - BigInt(fromBlock) + 1n), out: { jsonrpc: '2.0', id: m.id, result: [] } };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      const list = Array.isArray(j) ? j : [j];
      s.posts.push(list.map((m) => m.method));
      const got = list.map(answer);
      const out = got.reduce((n, g) => n + g.size, 0) > cap
        ? list.map((m) => ({ jsonrpc: '2.0', id: m.id, error: { code: -32005, message: 'answer too large: narrow the filter' } }))
        : got.map((g) => g.out);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(j) ? out : out[0]));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.closeAllConnections(); server.close(); });
  s.url = `http://127.0.0.1:${server.address().port}`;
  return s;
}

test('calls that share a batch with a log read refused as too large are asked again and answered; the log read is halved', { timeout: 120_000 }, async (t) => {
  const s = await batchRpc(t, 1500);
  const client = clientFor(s.url);
  const t0 = Date.now();
  const [logs, block, call] = await Promise.allSettled([
    readLogsSplitting((lo, hi) => client.getLogs({ fromBlock: lo, toBlock: hi }), 0n, 1999n),
    client.request({ method: 'eth_blockNumber' }),
    client.request({ method: 'eth_call', params: [{ to: '0x1111111111111111111111111111111111111111', data: '0x' }, 'latest'] }),
  ]);
  assert.deepEqual(s.posts[0].sort(), ['eth_blockNumber', 'eth_call', 'eth_getLogs'], 'the three went out as one batch, refused together');
  assert.equal(block.status, 'fulfilled', block.reason?.shortMessage);
  assert.equal(block.value, '0x10');
  assert.equal(call.status, 'fulfilled', call.reason?.shortMessage);
  assert.equal(call.value, '0x');
  assert.equal(logs.status, 'fulfilled', logs.reason?.shortMessage);
  assert.deepEqual(logs.value, []);
  assert.equal(s.calls.filter((m) => m === 'eth_getLogs').length, 3, 'the log read asked once, then its two halves');
  assert.equal(s.calls.filter((m) => m === 'eth_blockNumber').length, 2, 'the block number asked once more, not for 16 s');
  assert.ok(Date.now() - t0 < 10_000, `answered on the first try again (${Date.now() - t0} ms)`);
});

test('two log reads refused together are each halved and each read whole', { timeout: 120_000 }, async (t) => {
  const s = await batchRpc(t, 1500);
  const client = clientFor(s.url);
  const read = (lo, hi) => readLogsSplitting((a, b) => client.getLogs({ fromBlock: a, toBlock: b }), lo, hi);
  assert.deepEqual(await Promise.all([read(0n, 1199n), read(5000n, 5099n)]), [[], []]);
  assert.ok(s.calls.length <= 12, `${s.calls.length} reads`);
});
