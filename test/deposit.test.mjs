// The wait after "Move to VYRE" (src/lib/deposit.ts), run by Node against a stand-in VYRE network. Once the deposit was mined
// on Arc it is on its way: if it hasn't shown up on VYRE in time, the error must be what the transaction button holds as Check
// it (src/components/ui.tsx: a SentButUnconfirmedError that isn't a Face ID operation), kept under the button's name, and it must
// carry what a check needs to look for what's missing: the account and its VYRE balance before the deposit, kept as JSON for the
// tab and read back strictly. A check says the deposit arrived only once that balance has risen, so one more press can't send a
// second deposit. A balance read on VYRE that fails must not end the wait. `npm test` here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, numberToHex } from 'viem';
import { SentButUnconfirmedError, arcTestnet, vyreTestnet } from '@vyrechain/sdk';
import { arrival, depositArrived, depositWaitOf, heldDeposit } from '../src/lib/deposit.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ARC_TX = `0x${'a1'.repeat(32)}`;
const BEFORE = 5n * 10n ** 18n;
const MAX = 2n ** 256n - 1n;
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
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(err, 'it doesn’t resolve');
  assert.ok(state.reads > 1, 'it kept looking until the time was up');
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, ARC_TX, 'the deposit that was sent');
  assert.equal(err.chainId, arcTestnet.id, 'its receipt is read again on Arc, where it was sent');
  assert.match(err.note, /hasn’t shown up on VYRE yet/, 'says what is missing, in the app’s words');
  assert.deepEqual(err.deposit, { account: ME, before: BEFORE.toString() }, 'the account and its VYRE balance before, as a decimal string');
  const back = keptAndReadBack(err);
  assert.deepEqual(depositWaitOf(back.deposit), err.deposit, 'kept as JSON for the tab and read back after a reload, it is the same');
});

test('a balance read on VYRE that fails doesn’t end the wait: the deposit that arrives after it is seen', async () => {
  const { client, state } = vyre(['busy', BEFORE, 'busy', BEFORE + 1n]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, { ...quick, timeoutMs: 5_000 });
  assert.equal(typeof secs, 'number');
  assert.ok(secs >= 0 && secs < 5, `took ${secs} s`);
  assert.equal(state.reads, 4, 'read until it arrived');
});

test('reads that keep failing until the time is up: held as Check it too, never re-armed', async () => {
  const { client, state } = vyre(['busy']);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(state.reads > 1, 'it read again after a failed read');
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, ARC_TX);
  assert.equal(err.chainId, arcTestnet.id);
  assert.deepEqual(err.deposit, { account: ME, before: BEFORE.toString() });
});

test('with no Arc transaction to follow (the email wallet’s window didn’t give one): a plain error saying to check the balance first', async () => {
  const { client } = vyre([BEFORE]);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, null, quick).then(() => null, (e) => e);
  assert.ok(err instanceof Error && !held(err));
  assert.equal(err.deposit, undefined);
  assert.match(err.message, /hasn’t shown up on VYRE yet\. Check your balance here again in a minute before sending more/);
});

test('a deposit that arrives at once: how long it took, in seconds', async () => {
  const { client } = vyre([BEFORE + 10n ** 18n]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, quick);
  assert.ok(secs >= 0 && secs < 1, `took ${secs} s`);
});

test('a deposit whose own Arc receipt couldn’t be read (the SDK’s SentButUnconfirmedError) is marked with what a check needs too', () => {
  const unread = new SentButUnconfirmedError(ARC_TX, arcTestnet.id, new Error('HTTP request failed: 429'));
  const e = heldDeposit(unread, ME, BEFORE);
  assert.ok(e === unread && held(e), 'the same error, still held by the button');
  assert.equal(e.hash, ARC_TX);
  assert.equal(e.chainId, arcTestnet.id);
  assert.deepEqual(e.deposit, { account: ME, before: BEFORE.toString() });
  assert.deepEqual(depositWaitOf(keptAndReadBack(e).deposit), e.deposit);
});

test('what is read back for a held deposit is checked strictly: exactly an account and a balance in wei, as a decimal string', () => {
  const good = { account: ME, before: '5000000000000000000' };
  assert.deepEqual(depositWaitOf(good), good);
  assert.deepEqual(depositWaitOf({ account: ME.toLowerCase(), before: '0' }), { account: ME, before: '0' }, 'any case of the address, kept checksummed; a zero balance');
  assert.deepEqual(depositWaitOf({ ...good, before: MAX.toString() }), { ...good, before: MAX.toString() }, 'the largest balance there can be');
  assert.deepEqual(depositWaitOf({ ...good, extra: 'x' }), good, 'nothing else is kept');
  const bad = [
    undefined, null, '', 'x', 42, true, [], [ME, '1'], {}, { account: ME }, { before: '1' },
    { ...good, account: 42 }, { ...good, account: '0x1234' }, { ...good, account: ME.slice(2) }, { ...good, account: `${ME}00` },
    { ...good, account: `0x${'g'.repeat(40)}` }, { ...good, account: `0x${'0'.repeat(40)}` }, { ...good, account: ` ${ME}` },
    { ...good, before: 5 }, { ...good, before: 5n }, { ...good, before: null }, { ...good, before: '' }, { ...good, before: '-1' },
    { ...good, before: '01' }, { ...good, before: '0x10' }, { ...good, before: '1e3' }, { ...good, before: '1.5' }, { ...good, before: ' 1' },
    { ...good, before: '1 ' }, { ...good, before: '１' }, { ...good, before: (MAX + 1n).toString() }, { ...good, before: '9'.repeat(79) },
  ];
  for (const x of bad) assert.equal(depositWaitOf(x), null, JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
});

test('a check says the deposit arrived only once the balance on VYRE is above what it was before; a failed read is no answer', async () => {
  const d = { account: ME, before: BEFORE.toString() };
  const up = vyre([BEFORE + 1n]);
  assert.equal(await depositArrived(up.client, d), true, 'the balance rose: it arrived');
  assert.equal(up.state.asked[0].toLowerCase(), ME.toLowerCase(), 'the account the deposit goes to is the one read');
  assert.equal(await depositArrived(vyre([BEFORE]).client, d), false, 'unchanged: not yet');
  assert.equal(await depositArrived(vyre([BEFORE - 1n]).client, d), false, 'lower (spent on VYRE meanwhile): not seen as arrived');
  await assert.rejects(depositArrived(vyre(['busy']).client, d), 'a read that fails throws, so the button keeps it held');
});
