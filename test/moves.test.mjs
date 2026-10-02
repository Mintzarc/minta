// The move store (src/lib/moves.ts), run as it is by Node: what a reload brings back must be exactly the well-formed
// moves, whatever else the browser's storage holds; and a move's start block is what a later look starts from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_BACK_BLOCKS, MAX_MOVES, fromBlockOf, keepMove, loadMoves, movesKey, parseMoves, serializeMoves, withMove } from '../src/lib/moves.ts';

const ME = '0x1111111111111111111111111111111111111111';
const A = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const B = '0x2222222222222222222222222222222222222222';
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('a saved move comes back as it was, and an older bare address comes back with no start block', () => {
  const list = [{ dest: A, from: 1234n }, { dest: B, from: null }];
  assert.deepEqual(parseMoves(serializeMoves(list)), list);
  assert.deepEqual(parseMoves(JSON.stringify([A.toLowerCase(), B])), [{ dest: A, from: null }, { dest: B, from: null }]);
});

test('anything else in storage is dropped, never followed', () => {
  for (const raw of [null, '', 'not json', '{}', '"x"', 'null', '42']) assert.deepEqual(parseMoves(raw), [], String(raw));
  const raw = JSON.stringify([{ d: 'nope', b: '1' }, { d: A, b: '-5' }, { d: A, b: '99999999999999999' }, { d: B, b: 7 }, 42, null, { d: '0x' + '0'.repeat(40), b: '1' },
    { d: A.slice(0, -1) + 'F', b: '3' }]); // (a wrong capital letter fails the address's own check)
  // A with a bad block: kept with no block (the first of the two A's); B with a number, not a string: no block; a wrong checksum: dropped
  assert.deepEqual(parseMoves(raw), [{ dest: A, from: null }, { dest: B, from: null }]);
});

test('each address once, at most MAX_MOVES', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ d: '0x' + (i + 1).toString(16).padStart(40, '0'), b: String(i) }));
  assert.equal(parseMoves(JSON.stringify(many)).length, MAX_MOVES);
  assert.equal(parseMoves(JSON.stringify([{ d: B, b: '5' }, { d: B, b: '9' }])).length, 1);
});

test('a new move goes first; a repeat to the same address keeps the earlier start block', () => {
  let l = withMove([], { dest: A, from: 100n });
  l = withMove(l, { dest: B, from: 200n });
  assert.deepEqual(l.map((m) => m.dest), [B, A]);
  l = withMove(l, { dest: A, from: 300n });
  assert.deepEqual(l, [{ dest: A, from: 100n }, { dest: B, from: 200n }]);
  // an earlier one with no known start stays "no known start": the look then covers the whole window
  assert.deepEqual(withMove([{ dest: A, from: null }], { dest: A, from: 50n }), [{ dest: A, from: null }]);
  assert.equal(withMove(Array.from({ length: MAX_MOVES }, (_, i) => ({ dest: '0x' + (i + 1).toString(16).padStart(40, '0'), from: 1n })), { dest: A, from: 2n }).length, MAX_MOVES);
});

test('where a look starts: the move\'s own block, or the window back from the newest', () => {
  assert.equal(fromBlockOf({ dest: A, from: 5000n }, 9000n), 5000n);
  assert.equal(fromBlockOf({ dest: A, from: null }, 9000n), 0n);
  assert.equal(fromBlockOf({ dest: A, from: null }, 10_000_000n), 10_000_000n - LOOK_BACK_BLOCKS);
  // a start block ahead of the newest (a lagging node, or a bad value) falls back to the window, never past the head
  assert.equal(fromBlockOf({ dest: A, from: 9999n }, 9000n), 0n);
});

test('keeping a move works with storage, and without it or when it refuses', () => {
  const s = memory();
  keepMove(ME, { dest: A, from: 10n }, s);
  const l = keepMove(ME, { dest: B, from: 20n }, s);
  assert.deepEqual(l, [{ dest: B, from: 20n }, { dest: A, from: 10n }]);
  assert.deepEqual(loadMoves(ME, s), l);
  assert.ok(s.m.has(movesKey(ME.toUpperCase().replace('0X', '0x'))), 'one key per wallet, whatever the letter case');
  assert.deepEqual(loadMoves('0x3333333333333333333333333333333333333333', s), [], 'another wallet has its own');
  assert.deepEqual(keepMove(ME, { dest: A, from: 1n }, null), [{ dest: A, from: 1n }]);
  const refusing = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(keepMove(ME, { dest: B, from: 2n }, refusing), [{ dest: B, from: 2n }]);
  assert.deepEqual(loadMoves(ME, { getItem: () => { throw new Error('blocked'); }, setItem() {} }), []);
});
