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

test('the trade button shows a shortened amount (a balance’s format), never 18 decimals, and never "0" for an amount that is not', async () => {
  const { tradeLabel, shortAmount } = await import('../src/lib/format.ts');
  const big = parse('11714096.582707705307803293');
  assert.equal(exact(big), '11,714,096.582707705307803293');
  assert.equal(tradeLabel('sell', big, 'MINTA'), 'Sell 11,714,096.58 MINTA');
  assert.equal(tradeLabel('buy', parse('1000.123456789'), 'MINTA'), 'Buy with 1,000.1234 USDC');
  assert.equal(tradeLabel('buy', parse('50'), 'TOK'), 'Buy with 50 USDC');
  assert.equal(tradeLabel('sell', parse('5'), 'TOK'), 'Sell 5 TOK');
  assert.equal(tradeLabel('sell', null, 'TOK'), 'Sell TOK');
  assert.equal(tradeLabel('buy', null, 'TOK'), 'Buy TOK');
  assert.equal(tradeLabel('sell', big, 'TOK', true), 'Not enough balance');
  // too small for the short form: shown in full rather than as 0
  assert.equal(tradeLabel('sell', 1n, 'TOK'), 'Sell 0.000000000000000001 TOK');
  assert.equal(shortAmount(parse('0.004'), 2), '0.004');
  assert.equal(shortAmount(0n, 2), '0');
  for (const v of [big, parse('1000.123456789'), 1n]) assert.ok(tradeLabel('sell', v, 'MINTA').length <= 40);
});
