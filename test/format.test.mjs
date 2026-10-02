// Reading typed numbers (src/lib/format.ts): a tax is a plain percent with at most two decimals, read exactly, never through
// Number() (which also reads hex and exponents, and would round a third decimal into something nobody typed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exact, parse, pct, percentBps } from '../src/lib/format.ts';

test('a typed percent is read as basis points, exactly', () => {
  for (const [typed, bps] of [['0', 0], ['1', 100], ['2.5', 250], ['2.55', 255], ['0.01', 1], ['10', 1000], [' 3 ', 300], ['5.', 500], ['007', 700], ['2.50', 250]]) {
    assert.equal(percentBps(typed), bps, typed);
    assert.equal(pct(percentBps(typed)), `${bps / 100}%`, typed);
  }
});

test('anything else is not a percent (NaN), so nothing is sent from it', () => {
  for (const typed of ['', ' ', '0x5', '0X5', '1e1', '1E1', '2.555', '1.005', '.5', '-1', '+1', '1,5', '1 000', 'Infinity', 'NaN', '5%', '٥']) {
    assert.ok(Number.isNaN(percentBps(typed)), JSON.stringify(typed));
  }
});

test('a supply with a fraction is shown with its fraction (what is sent)', () => {
  assert.equal(exact(parse('1000000.9')), '1,000,000.9');
  assert.equal(exact(parse('1000000000')), '1,000,000,000');
});
