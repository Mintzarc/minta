// The pending-transfer store (src/lib/pending.ts), run as it is by Node: what a reload brings back must be exactly the
// well-formed transfers from the source chains, whatever else the browser's storage holds. `npm test` here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PENDING, PENDING_KEY, addPending, loadPending, parsePending, removePending, serializePending } from '../src/lib/pending.ts';

const A = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const good = { hash: hash(1), chainId: 84_532, account: A, amount: '10000000', maxFee: '21204', at: 1_790_000_000_000 };
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m };
};

test('a well-formed transfer comes back as it was saved', () => {
  const [t] = parsePending(JSON.stringify([good]));
  assert.deepEqual(t, { ...good, amount: 10_000_000n, maxFee: 21_204n });
  assert.deepEqual(parsePending(serializePending([t])), [t]);
  // every source chain, and the hash kept in lower case (so one transfer is always one entry)
  for (const chainId of [11_155_111, 84_532, 421_614]) assert.equal(parsePending(JSON.stringify([{ ...good, chainId }])).length, 1);
  assert.equal(parsePending(JSON.stringify([{ ...good, hash: good.hash.toUpperCase().replace('0X', '0x') }]))[0].hash, good.hash);
});

test('anything else in storage is dropped, never followed', () => {
  for (const raw of [null, '', 'not json', '{}', '"x"', 'null', '42']) assert.deepEqual(parsePending(raw), [], String(raw));
  const bad = [
    null,
    'x',
    [],
    { ...good, hash: '0x1234' }, // not a transaction hash
    { ...good, hash: `${good.hash}00` },
    { ...good, hash: undefined },
    { ...good, chainId: 5042002 }, // Arc, VYRE or any chain that isn't a source
    { ...good, chainId: 7357 },
    { ...good, chainId: '84532' },
    { ...good, account: '0x12' },
    { ...good, account: `0x${'0'.repeat(40)}` },
    { ...good, amount: '0' },
    { ...good, amount: '-5' },
    { ...good, amount: '1e6' },
    { ...good, amount: 10_000_000 }, // a number, not the string it's saved as
    { ...good, maxFee: '10000000' }, // fees that would take it all
    { ...good, maxFee: 'x' },
    { ...good, at: 0 },
    { ...good, at: 'yesterday' },
  ];
  for (const x of bad) assert.deepEqual(parsePending(JSON.stringify([x])), [], JSON.stringify(x));
  // the good ones among bad ones are kept
  assert.equal(parsePending(JSON.stringify([...bad, good])).length, 1);
});

test('one entry per transfer, the newest kept', () => {
  assert.equal(parsePending(JSON.stringify([good, { ...good }, { ...good, amount: '5000000' }])).length, 1);
  const many = Array.from({ length: MAX_PENDING + 5 }, (_, i) => ({ ...good, hash: hash(i + 1) }));
  const kept = parsePending(JSON.stringify(many));
  assert.equal(kept.length, MAX_PENDING);
  assert.equal(kept[0].hash, hash(6));
  assert.equal(kept.at(-1).hash, hash(MAX_PENDING + 5));
});

test('add and remove, and a browser that keeps nothing', () => {
  const store = memory();
  const t = parsePending(JSON.stringify([good]))[0];
  assert.equal(addPending(t, store), true);
  assert.equal(addPending({ ...t, hash: hash(2) }, store), true);
  assert.equal(addPending(t, store), true); // again: still once
  assert.deepEqual(loadPending(store).map((x) => x.hash), [hash(2), hash(1)]);
  assert.equal(removePending(hash(2).toUpperCase().replace('0X', '0x'), store), true);
  assert.deepEqual(loadPending(store).map((x) => x.hash), [hash(1)]);
  assert.ok(store.m.get(PENDING_KEY).includes('"amount":"10000000"'));
  // storage that's missing or refuses: nothing kept, and it says so
  assert.equal(addPending(t, null), false);
  assert.deepEqual(loadPending(null), []);
  const refusing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(addPending(t, refusing), false);
  assert.deepEqual(loadPending(refusing), []);
});
