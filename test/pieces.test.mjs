// Reading a long list in pieces (src/lib/pieces.ts): every item once, in order, never more than a piece at a time, one piece after another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inPieces, LOG_LIST_MAX } from '../src/lib/pieces.ts';

test('every item is read once, in order, in pieces of at most n', async () => {
  const seen = [];
  const out = await inPieces(Array.from({ length: 123 }, (_, i) => i), 50, async (p) => { seen.push(p.length); return p.reduce((a, b) => a + b, 0); });
  assert.deepEqual(seen, [50, 50, 23]);
  assert.equal(out.reduce((a, b) => a + b, 0), (122 * 123) / 2);
});

test('an empty list reads nothing, a list of exactly n is one piece, one more is two', async () => {
  let calls = 0;
  assert.deepEqual(await inPieces([], 50, async () => { calls++; return 1; }), []);
  assert.equal(calls, 0);
  await inPieces(Array(50).fill(0), 50, async () => { calls++; });
  assert.equal(calls, 1);
  await inPieces(Array(51).fill(0), 50, async () => { calls++; });
  assert.equal(calls, 3);
});

test('the pieces are read one after another, not together (the public RPC serves one call at a time)', async () => {
  let live = 0, most = 0;
  await inPieces(Array(200).fill(0), LOG_LIST_MAX, async () => { live++; most = Math.max(most, live); await new Promise((r) => setTimeout(r, 5)); live--; });
  assert.equal(most, 1);
});

test('a read that fails stops the rest, and a bad piece size is refused', async () => {
  let calls = 0;
  await assert.rejects(inPieces(Array(200).fill(0), 50, async () => { calls++; if (calls === 2) throw new Error('boom'); }), /boom/);
  assert.equal(calls, 2);
  await assert.rejects(inPieces([1], 0, async () => 1), RangeError);
  await assert.rejects(inPieces([1], 1.5, async () => 1), RangeError);
});
