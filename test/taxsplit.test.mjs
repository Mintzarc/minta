// The Manage page's check on a tax split (src/lib/taxsplit.ts). Tax is paid in WUSDC, so a split must never name a contract
// that can't pass WUSDC on (the tax is lost for good) or one that passes on whatever anyone asks it to (the chain's
// Multicall3: anyone can take it). The pad refuses only a few of those itself, so the page refuses the rest: at least
// every address the SDK's own setTaxWallets refuses, and the chain's system addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, custom, getAddress } from 'viem';
import { getAddresses, setTaxWallets, vyreTestnet } from '@vyrechain/sdk';
import { refusedTaxWallets, splitBps, taxSplitProblem } from '../src/lib/taxsplit.ts';

const A = getAddresses(vyreTestnet.id);
const MULTICALL3 = vyreTestnet.contracts.multicall3.address;
const POOL = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const CREATOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const OTHER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
// as the page builds it: the SDK's list for the chain, the chain's Multicall3, and the launch's own pool and token
const refused = refusedTaxWallets(A, [MULTICALL3, POOL, TOKEN]);
const one = (addr) => taxSplitProblem([{ addr, share: '100' }], refused);

/** What the SDK's setTaxWallets says of a one-wallet split to `addr`, without the network (its own checks come first) */
async function sdkSays(addr) {
  const dead = custom({ request: async () => { throw new Error('no network in this test'); } });
  const pub = createPublicClient({ chain: vyreTestnet, transport: dead });
  const wal = createWalletClient({ account: CREATOR, chain: vyreTestnet, transport: dead });
  try { await setTaxWallets(wal, pub, { token: TOKEN, wallets: [addr], bps: [10_000] }); return 'sent'; } catch (e) { return /VYRE's/.test(e.message) ? 'refused' : 'passed'; }
}

test('every address the SDK’s setTaxWallets refuses is refused by the page too', async () => {
  const listed = [...Object.entries(A).filter(([, v]) => typeof v === 'string'), ['Multicall3', MULTICALL3]];
  assert.ok(listed.length >= 11, 'the SDK lists the chain’s contracts');
  for (const [name, addr] of listed) {
    assert.equal(await sdkSays(addr), 'refused', `the SDK refuses ${name}`);
    assert.match(one(addr), /contracts/, `the page refuses ${name} (${addr})`);
    assert.match(one(addr.toLowerCase()), /contracts/, `in lower case too (${name})`);
  }
});

test('Multicall3, the referrals contract, the quoter, TickLens and the pool deployer are each refused', () => {
  for (const addr of [MULTICALL3, A.referrals, A.quoter, A.tickLens, A.poolDeployer]) assert.notEqual(one(addr), '', addr);
});

test('the launch’s own pool and token are refused', () => {
  assert.match(one(POOL), /contracts/);
  assert.match(one(TOKEN), /contracts/);
});

test('the chain’s system addresses (precompiles and the like) are refused', () => {
  for (const n of [0x1, 0x9, 0x64, 0x6e, 0xc8, 0xff, 0x100, 0xa4b05]) {
    const addr = getAddress(`0x${n.toString(16).padStart(40, '0')}`);
    assert.match(one(addr), /system address/, addr);
  }
  assert.match(one('0x0000000000000000000000000000000000000000'), /system address/);
});

test('a plain wallet, or a split between wallets, is accepted; the other rules stay', () => {
  assert.equal(one(CREATOR), '');
  assert.equal(taxSplitProblem([{ addr: CREATOR, share: '60' }, { addr: OTHER, share: '40' }], refused), '');
  assert.deepEqual(splitBps([{ addr: CREATOR, share: '60.5' }, { addr: OTHER, share: '39.5' }]), [6050, 3950]);
  assert.match(taxSplitProblem([], refused), /One to four/);
  assert.match(taxSplitProblem(Array(5).fill({ addr: CREATOR, share: '20' }), refused), /One to four/);
  assert.match(taxSplitProblem([{ addr: CREATOR.toLowerCase().replace('c', 'C'), share: '100' }], refused), /checksum/);
  assert.match(taxSplitProblem([{ addr: CREATOR, share: '0' }, { addr: OTHER, share: '100' }], refused), /above 0%/);
  assert.match(taxSplitProblem([{ addr: CREATOR, share: '60' }, { addr: OTHER, share: '30' }], refused), /add up to 100%/);
});
