// The wait after "Move to VYRE" (src/lib/deposit.ts), run by Node against a stand-in VYRE network. Once the deposit was mined
// on Arc it is on its way: if it hasn't shown up on VYRE in time, the error must be what the transaction button holds as Check
// it (src/components/ui.tsx: a SentButUnconfirmedError that isn't a Face ID operation), kept under the button's name, so one more
// press reads Arc and can't send a second deposit. A balance read on VYRE that fails must not end the wait. `npm test` here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, custom, numberToHex } from 'viem';
import { SentButUnconfirmedError, arcTestnet, vyreTestnet } from '@vyrechain/sdk';
import { arrival } from '../src/lib/deposit.ts';

const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ARC_TX = `0x${'a1'.repeat(32)}`;
const BEFORE = 5n * 10n ** 18n;
/** What the transaction button does with an error: hold it as Check it, or show it and re-arm (ui.tsx, TxButton) */
const held = (e) => e instanceof SentButUnconfirmedError && !e.userOperation;

/** A stand-in VYRE network whose balance reads answer from `script` in turn ('busy': the read is refused), the last one from then on */
function vyre(script) {
  const state = { reads: 0 };
  const client = createPublicClient({
    chain: vyreTestnet,
    transport: custom({
      request: async ({ method }) => {
        if (method !== 'eth_getBalance') throw new Error(`unexpected ${method}`);
        const a = script[Math.min(state.reads++, script.length - 1)];
        if (a === 'busy') { const e = new Error('rate limited'); e.code = -32005; throw e; }
        return numberToHex(a);
      },
    }, { retryCount: 0 }),
  });
  return { client, state };
}
const quick = { timeoutMs: 400, pollMs: 20, retryMs: 20 };

test('a deposit mined on Arc that hasn’t reached VYRE in time is held as Check it, for the Arc transaction', async () => {
  const { client, state } = vyre([BEFORE]);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, quick).then(() => null, (e) => e);
  assert.ok(err, 'it doesn’t resolve');
  assert.ok(state.reads > 1, 'it kept looking until the time was up');
  assert.ok(held(err), `held by the button (got ${err?.constructor?.name}: ${err?.message})`);
  assert.equal(err.hash, ARC_TX, 'the deposit that was sent');
  assert.equal(err.chainId, arcTestnet.id, 'read again on Arc, where it was sent');
  assert.match(err.note, /hasn’t shown up on VYRE yet/, 'says what is missing, in the app’s words');
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
});

test('with no Arc transaction to follow (the email wallet’s window didn’t give one): a plain error saying to check the balance first', async () => {
  const { client } = vyre([BEFORE]);
  const err = await arrival(client, arcTestnet.id, ME, BEFORE, null, quick).then(() => null, (e) => e);
  assert.ok(err instanceof Error && !held(err));
  assert.match(err.message, /hasn’t shown up on VYRE yet\. Check your balance here again in a minute before sending more/);
});

test('a deposit that arrives at once: how long it took, in seconds', async () => {
  const { client } = vyre([BEFORE + 10n ** 18n]);
  const secs = await arrival(client, arcTestnet.id, ME, BEFORE, ARC_TX, quick);
  assert.ok(secs >= 0 && secs < 1, `took ${secs} s`);
});
