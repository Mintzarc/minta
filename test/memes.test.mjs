// Which meme mascot a token without a picture gets (src/lib/memes.ts): always the same one for the same address, always in range, and
// spread across the set, including for addresses that differ only in their last characters (launches made one after another).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEME_COUNT, memeFile, memeNumber } from '../src/lib/memes.ts';

const addr = (i) => `0x${'ab'.repeat(18)}${i.toString(16).padStart(4, '0')}`;

test('the same address always gets the same mascot, whatever its letter case', () => {
  const a = '0x33D945764d3De5AB0211455c13fC48490f7082DE';
  assert.equal(memeNumber(a), memeNumber(a));
  assert.equal(memeNumber(a), memeNumber(a.toLowerCase()));
  assert.equal(memeFile(a), memeFile(a.toLowerCase()));
});

test('every number is within the set, and the file name has two digits', () => {
  for (let i = 0; i < 5000; i++) {
    const n = memeNumber(addr(i));
    assert.ok(Number.isInteger(n) && n >= 1 && n <= MEME_COUNT, `${n}`);
    assert.match(memeFile(addr(i)), /^memes\/m\d\d\.webp$/);
  }
  for (const odd of ['', ' ', '0x', 'ünï©ode', 'x'.repeat(10000)]) assert.ok(memeNumber(odd) >= 1 && memeNumber(odd) <= MEME_COUNT);
});

test('addresses that differ only at the end spread across the set (no long runs of one mascot)', () => {
  const seen = new Set();
  let same = 0;
  for (let i = 0; i < 100; i++) { const n = memeNumber(addr(i)); seen.add(n); if (i && n === memeNumber(addr(i - 1))) same++; }
  assert.ok(seen.size >= 35, `only ${seen.size} different mascots in 100 launches`);
  assert.ok(same <= 6, `${same} launches in a row got the same mascot as the one before`);
});
