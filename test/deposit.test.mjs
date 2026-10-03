// The wait after "Move to VYRE" (src/lib/deposit.ts), run by Node against a stand-in VYRE network. A deposit of `amount` from Arc
// is credited one for one on VYRE, so it has arrived once the account's VYRE balance is at least what it was before plus the
// amount: any smaller rise (a faucet drip, a stranger's transfer) is not it. Once the deposit was mined on Arc it is on its way:
// if it hasn't shown up on VYRE in time, the error must be what the transaction button holds as Check it (src/components/ui.tsx:
// a SentButUnconfirmedError that isn't a Face ID operation), kept under the button's name, and it must carry what a check needs
// to look for what's missing: the account, its VYRE balance before the deposit and the amount, kept as JSON for the tab and read
// back strictly. A check says the deposit arrived only once the balance shows it all, so one more press can't send a second
// deposit. A balance read on VYRE that fails must not end the wait. `npm test` here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, numberToHex } from 'viem';
import { SentButUnconfirmedError, arcTestnet, vyreTestnet } from '@vyrechain/sdk';
import { arrival, depositArrived, depositWaitOf, heldDeposit } from '../src/lib/deposit.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ARC_TX = `0x${'a1'.repeat(32)}`;
const BEFORE = 5n * 10n ** 18n;
const AMOUNT = 2n * 10n ** 18n;
const DRIP = 10n ** 18n; // less than the deposit: what the faucet gives, say
const MAX = 2n ** 256n - 1n;
const WAIT = { account: ME, before: BEFORE.toString(), amount: AMOUNT.toString() };
/** What the transaction button does with an error: hold it as Check it, or show it and re-arm (ui.tsx, TxButton) */
const held = (e) => e instanceof SentButUnconfirmedError && !e.userOperation;
/** The record the button keeps for the tab (ui.tsx, writeHeld), as a reload reads it back */
const keptAndReadBack = (e) => JSON.parse(JSON.stringify({ hash: e.hash, chainId: e.chainId, looked: false, deposit: e.deposit }));

/** A stand-in VYRE network whose balance reads answer from `script` in turn ('busy': the read is refused), the last one from then on */
function vyre(script) {
  const state = { reads: 0, asked: [] };
  const client = createPublicClient({
    chain: vyreTestnet,
    transport: custom({
      request: async ({ method, params }) => {
        if (method !== 'eth_getBalance') throw new Error(`unexpected ${method}`);
        state.asked.push(params[0]);
        const a = script[Math.min(state.reads++, script.length - 1)];
        if (a === 'busy') { const e = new Error('rate limited'); e.code = -32005; throw e; }
        return numberToHex(a);
      },
    }, { retryCount: 0 }),
  });
  return { client, state };
}
const quick = { timeoutMs: 400, pollMs: 20, retryMs: 20 };

test('a deposit mined on Arc that hasn’t reached VYRE in time is held as Check it, for the Arc transaction, with what a check needs', async () => {
  const { client, state } = vyre([BEFORE]);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(err, 'it doesn’t resolve');
  assert.ok(state.reads > 1, 'it kept looking until the time was up');
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, ARC_TX, 'the deposit that was sent');
  assert.equal(err.chainId, arcTestnet.id, 'its receipt is read again on Arc, where it was sent');
  assert.match(err.note, /hasn’t shown up on VYRE yet/, 'says what is missing, in the app’s words');
  assert.deepEqual(err.deposit, WAIT, 'the account, its VYRE balance before and the amount, as decimal strings');
  const back = keptAndReadBack(err);
  assert.deepEqual(depositWaitOf(back.deposit), err.deposit, 'kept as JSON for the tab and read back after a reload, it is the same');
});

test('a balance read on VYRE that fails doesn’t end the wait: the deposit that arrives after it is seen', async () => {
  const { client, state } = vyre(['busy', BEFORE, 'busy', BEFORE + AMOUNT]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, { ...quick, timeoutMs: 5_000 });
  assert.equal(typeof secs, 'number');
  assert.ok(secs >= 0 && secs < 5, `took ${secs} s`);
  assert.equal(state.reads, 4, 'read until it arrived');
});

test('a smaller rise on VYRE (a faucet drip, a stranger’s transfer) is not the deposit: the wait goes on until the whole amount shows', async () => {
  const { client, state } = vyre([BEFORE, BEFORE + 1n, BEFORE + DRIP, BEFORE + AMOUNT - 1n, BEFORE + AMOUNT]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, { ...quick, timeoutMs: 5_000 });
  assert.equal(typeof secs, 'number');
  assert.equal(state.reads, 5, 'read on through every smaller rise until the balance was up by the whole amount');
  const late = vyre([BEFORE + DRIP]);
  const err = await arrival(late.client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(held(err) && late.state.reads > 1, 'a balance up by less than the amount until the time is up: held as Check it, not arrived');
  assert.deepEqual(err.deposit, WAIT);
});

test('reads that keep failing until the time is up: held as Check it too, never re-armed', async () => {
  const { client, state } = vyre(['busy']);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(state.reads > 1, 'it read again after a failed read');
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, ARC_TX);
  assert.equal(err.chainId, arcTestnet.id);
  assert.deepEqual(err.deposit, WAIT);
});

test('with no Arc transaction to follow (the email wallet’s window didn’t give one): a plain error saying to check the balance first', async () => {
  const { client } = vyre([BEFORE]);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, null, quick).then(() => null, (e) => e);
  assert.ok(err instanceof Error && !held(err));
  assert.equal(err.deposit, undefined);
  assert.match(err.message, /hasn’t shown up on VYRE yet\. Check your balance here again in a minute before sending more/);
});

test('a deposit that arrives at once: how long it took, in seconds', async () => {
  const { client } = vyre([BEFORE + AMOUNT + DRIP]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, AMOUNT, ARC_TX, quick);
  assert.ok(secs >= 0 && secs < 1, `took ${secs} s`);
});

test('a deposit whose own Arc receipt couldn’t be read (the SDK’s SentButUnconfirmedError) is marked with what a check needs too', () => {
  const unread = new SentButUnconfirmedError(ARC_TX, arcTestnet.id, new Error('HTTP request failed: 429'));
  const e = heldDeposit(unread, ME, BEFORE, AMOUNT);
  assert.ok(e === unread && held(e), 'the same error, still held by the button');
  assert.equal(e.hash, ARC_TX);
  assert.equal(e.chainId, arcTestnet.id);
  assert.deepEqual(e.deposit, WAIT);
  assert.deepEqual(depositWaitOf(keptAndReadBack(e).deposit), e.deposit);
});

test('what is read back for a held deposit is checked strictly: exactly an account, a balance and a positive amount in wei, as decimal strings', () => {
  assert.deepEqual(depositWaitOf(WAIT), WAIT);
  assert.deepEqual(depositWaitOf({ ...WAIT, account: ME.toLowerCase(), before: '0' }), { ...WAIT, before: '0' }, 'any case of the address, kept checksummed; a zero balance before');
  assert.deepEqual(depositWaitOf({ ...WAIT, before: MAX.toString(), amount: MAX.toString() }), { ...WAIT, before: MAX.toString(), amount: MAX.toString() }, 'the largest balance and amount there can be');
  assert.deepEqual(depositWaitOf({ ...WAIT, amount: '1' }), { ...WAIT, amount: '1' }, 'the smallest amount');
  assert.deepEqual(depositWaitOf({ ...WAIT, extra: 'x' }), WAIT, 'nothing else is kept');
  const odd = [5, 5n, null, '', '-1', '01', '0x10', '1e3', '1.5', ' 1', '1 ', '１', (MAX + 1n).toString(), '9'.repeat(79)];
  const bad = [
    undefined, null, '', 'x', 42, true, [], [ME, '1', '1'], {}, { account: ME }, { before: '1', amount: '1' },
    { account: ME, before: '1' }, { account: ME, amount: '1' }, { before: '1' },
    { ...WAIT, account: 42 }, { ...WAIT, account: '0x1234' }, { ...WAIT, account: ME.slice(2) }, { ...WAIT, account: `${ME}00` },
    { ...WAIT, account: `0x${'g'.repeat(40)}` }, { ...WAIT, account: `0x${'0'.repeat(40)}` }, { ...WAIT, account: ` ${ME}` },
    ...odd.map((before) => ({ ...WAIT, before })),
    ...odd.map((amount) => ({ ...WAIT, amount })),
    { ...WAIT, amount: '0' }, { ...WAIT, amount: '00' },
  ];
  for (const x of bad) assert.equal(depositWaitOf(x), null, JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
});

test('a check says the deposit arrived only once the balance on VYRE is up by the whole amount; a failed read is no answer', async () => {
  const up = vyre([BEFORE + AMOUNT]);
  assert.equal(await depositArrived(up.client, WAIT), true, 'up by exactly the amount: it arrived');
  assert.equal(up.state.asked[0].toLowerCase(), ME.toLowerCase(), 'the account the deposit goes to is the one read');
  assert.equal(await depositArrived(vyre([BEFORE + AMOUNT + DRIP]).client, WAIT), true, 'up by more (the deposit and something else): it arrived');
  for (const [b, why] of [[BEFORE, 'unchanged'], [BEFORE + 1n, 'up by 1 wei from someone else'], [BEFORE + DRIP, 'up by a faucet drip, less than the amount'],
    [BEFORE + AMOUNT - 1n, 'one wei short of the amount'], [BEFORE - 1n, 'lower (spent on VYRE meanwhile)']]) {
    assert.equal(await depositArrived(vyre([b]).client, WAIT), false, `${why}: not seen as arrived`);
  }
  await assert.rejects(depositArrived(vyre(['busy']).client, WAIT), 'a read that fails throws, so the button keeps it held');
});
