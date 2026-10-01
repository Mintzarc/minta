// A small page for the browser check of the pre-sign check (test/minta.browser.cjs; not part of the app, never built into it).
// It uses the app's own pieces as they are: the wallet client from `walletOn`, the transaction button, the dialog and the
// stylesheet. The wallet is a stand-in the test defines before the page loads (window.__wallet); each button sends one
// transaction through it, on VYRE or on another chain.
import '../../src/styles.css';
import { createRoot } from 'react-dom/client';
import { arcTestnet, vyreTestnet } from '@vyrechain/sdk';
import type { Address, EIP1193Provider } from 'viem';
import { walletOn } from '../../src/lib/chain';
import { TxButton } from '../../src/components/ui';
import TxCheckDialog from '../../src/components/TxCheckDialog';

const ME: Address = '0x5899a0576A94327a6316E01190f951edf7645914';
const TO: Address = '0x1111111111111111111111111111111111111111';
const wallet = () => (window as unknown as { __wallet: EIP1193Provider }).__wallet;
const setChain = (id: number) => { (window as unknown as { __chainHex: string }).__chainHex = `0x${id.toString(16)}`; };

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
      <TxCheckDialog />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
