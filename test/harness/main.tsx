// A small page for the browser check of the pre-sign check (test/minta.browser.cjs; not part of the app, never built into it).
// It uses the app's own pieces as they are: the wallet client from `walletOn`, the transaction button, the dialog and the
// stylesheet. The wallet is a stand-in the test defines before the page loads (window.__wallet); each button sends one
// transaction through it, on VYRE or on another chain. A third button stands for a trade sent whose result couldn't be read;
// a fourth for a sale whose held transaction may be the approval before it (its trade goes to ROUTER); a fifth for a send
// whose held transaction is kept for the tab; a sixth for the "From another chain" form's burn, sent but its receipt unread,
// thrown as that form throws it (src/lib/fromchain.ts); a seventh for "Move to VYRE", whose deposit was mined on Arc but hasn't
// shown up on a stand-in VYRE in time, waited for as the Wallet page waits (src/lib/deposit.ts), and checked against that VYRE's
// balance as the Wallet page checks it (the balance is window.__vyreBalance, which the test raises or makes fail).
import '../../src/styles.css';
import { createRoot } from 'react-dom/client';
import { SentButUnconfirmedError, arcTestnet, cctpSource, vyreTestnet } from '@vyrechain/sdk';
import { createPublicClient, custom, type Address, type EIP1193Provider, type PublicClient } from 'viem';
import { walletOn } from '../../src/lib/chain';
import { TxButton } from '../../src/components/ui';
import { burnSentError } from '../../src/lib/fromchain';
import { arrival, depositArrived } from '../../src/lib/deposit';
import TxCheckDialog from '../../src/components/TxCheckDialog';

const ME: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TO: Address = '0x1111111111111111111111111111111111111111';
const ROUTER: Address = '0x2222222222222222222222222222222222222222';
const MESSENGER: Address = '0x4444444444444444444444444444444444444444'; // stands for Circle's transfer contract
const BASE_SEPOLIA = cctpSource(84_532);
const wallet = () => (window as unknown as { __wallet: EIP1193Provider }).__wallet;
const count = window as unknown as { __runs?: number; __done?: number; __runs2?: number; __done2?: number; __runs3?: number; __done3?: number; __runs4?: number; __done4?: number; __runs5?: number; __done5?: number; __vyreReads?: number; __vyreBalance?: string };
const setChain = (id: number) => { (window as unknown as { __chainHex: string }).__chainHex = `0x${id.toString(16)}`; };
/** A stand-in VYRE: its balance reads answer window.__vyreBalance (0x1 unless the test sets it; 'busy' refuses the read) */
const standInVyre = createPublicClient({
  chain: vyreTestnet,
  transport: custom({
    request: async ({ method }) => {
      if (method !== 'eth_getBalance') throw new Error(`unexpected ${method}`);
      count.__vyreReads = (count.__vyreReads || 0) + 1;
      const b = count.__vyreBalance ?? '0x1';
      if (b === 'busy') throw Object.assign(new Error('rate limited'), { code: -32005 });
      return b;
    },
  }, { retryCount: 0 }),
}) as PublicClient;

function Page() {
  return (
    <main className="main narrow">
      <h1 className="h3">Pre-sign check</h1>
      <div id="vyre">
        <TxButton label="Send on VYRE" run={async () => {
          setChain(vyreTestnet.id);
          const hash = await walletOn(wallet(), ME).sendTransaction({ chain: vyreTestnet, to: TO, data: '0xdeadbeef', value: 10000n });
          return { hash, text: 'Sent.' };
        }} />
      </div>
      <div id="arc">
        <TxButton label="Send on Arc" run={async () => {
          setChain(arcTestnet.id);
          const hash = await walletOn(wallet(), ME, arcTestnet).sendTransaction({ chain: arcTestnet, to: TO, data: '0xdeadbeef', value: 10000n });
          return { hash, text: 'Sent on Arc.' };
        }} />
      </div>
      <div id="unread">
        {/* a trade sent whose result couldn't be read (the RPC busy): what the same button does next */}
        <TxButton label="Buy with 50 USDC" onDone={() => { count.__done = (count.__done || 0) + 1; }} run={async () => {
          count.__runs = (count.__runs || 0) + 1;
          throw new SentButUnconfirmedError(`0x${'cd'.repeat(32)}`, vyreTestnet.id, new Error('HTTP request failed: 429'));
        }} />
      </div>
      <div id="approval">
        <TxButton label="Sell 5 TOK" finalTo={ROUTER} onDone={() => { count.__done2 = (count.__done2 || 0) + 1; }} run={async () => {
          count.__runs2 = (count.__runs2 || 0) + 1;
          throw new SentButUnconfirmedError(`0x${'ce'.repeat(32)}`, vyreTestnet.id, new Error('HTTP request failed: 429'));
        }} />
      </div>
      <div id="kept">
        <TxButton label="Send 1 USDC" keepAs="test-kept" onDone={() => { count.__done3 = (count.__done3 || 0) + 1; }} run={async () => {
          count.__runs3 = (count.__runs3 || 0) + 1;
          throw new SentButUnconfirmedError(`0x${'cf'.repeat(32)}`, vyreTestnet.id, new Error('HTTP request failed: 429'));
        }} />
      </div>
      <div id="burn">
        {/* the burn of 100 USDC from Base Sepolia, sent (and sped up in the wallet: the form follows the newer hash) but unread */}
        <TxButton label="Send 100 USDC to Arc" keepAs="test-burn" finalTo={MESSENGER} onDone={() => { count.__done4 = (count.__done4 || 0) + 1; }} run={async () => {
          count.__runs4 = (count.__runs4 || 0) + 1;
          const unread = new SentButUnconfirmedError(`0x${'c1'.repeat(32)}`, BASE_SEPOLIA.id, new Error('HTTP request failed: 429'));
          throw burnSentError(unread, `0x${'c2'.repeat(32)}`, BASE_SEPOLIA);
        }} />
      </div>
      <div id="deposit">
        {/* 2 USDC moved to VYRE: mined on Arc, not on VYRE in time */}
        <TxButton label="Move 2 USDC to VYRE" keepAs="test-deposit" onDone={() => { count.__done5 = (count.__done5 || 0) + 1; }}
          arrived={(d) => depositArrived(standInVyre, d)}
          run={async (say) => {
            count.__runs5 = (count.__runs5 || 0) + 1;
            const before = await standInVyre.getBalance({ address: ME });
            say('Sent on Arc. Waiting for it on VYRE…');
            const secs = await arrival(standInVyre, arcTestnet.id, ME, before, `0x${'a1'.repeat(32)}`, { timeoutMs: 300, pollMs: 20, retryMs: 20 });
            return { text: `Arrived on VYRE in ${secs.toFixed(1)} s.` };
          }} />
      </div>
      <TxCheckDialog />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
