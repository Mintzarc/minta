// The connected wallet's wrapped USDC, shown only when it holds some, with a button that unwraps all of it to USDC.
import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { vyre } from '../lib/chain';
import { exact, shortAmount } from '../lib/format';
import { useWallet } from '../lib/wallet';
import { unwrap, wrappedBalance } from '../lib/wrapped';
import { TxButton } from './ui';

export const WRAPPED_FACT = 'A launch’s tax is paid out as wrapped USDC (WUSDC), a token that holds USDC one for one. Unwrapping gives the same amount back as USDC.';

/** `again`: a number the page bumps when something that could change the balance has happened (a collect, a send) */
export function WrappedUsdc({ account, again = 0, onDone }: { account: Address; again?: number; onDone?: () => void }) {
  const { onVyre, confirmHint, email } = useWallet();
  const [held, setHeld] = useState<bigint | null>(null);
  // the account the balance on screen is for: an answer for another one is dropped
  const shownFor = useRef('');
  const read = async () => {
    const who = account.toLowerCase();
    if (shownFor.current !== who) { shownFor.current = who; setHeld(null); }
    const v = await wrappedBalance(account).catch(() => null);
    if (shownFor.current === who && v !== null) setHeld(v);
    return v;
  };
  useEffect(() => { read(); }, [account, again]);
  if (!held) return null;
  return (
    <div className="card wrapped-usdc">
      <h2 className="h3">Wrapped USDC</h2>
      <p className="small">This wallet holds <b className="break">{shortAmount(held, 4)} WUSDC</b>. {WRAPPED_FACT} Unwrapping is a transaction, so it needs a little USDC on VYRE for the network fee.</p>
      {email && <p className="small muted wrapped-email">An email wallet can’t send transactions on VYRE yet, so it can’t unwrap here.</p>}
      {!email && (
        <TxButton className="btn btn-line" label={`Unwrap ${exact(held)} WUSDC to USDC`} keepAs={`unwrap:${account.toLowerCase()}`}
          onDone={() => { read(); onDone?.(); }}
          run={async (say) => {
            const w = await onVyre();
            // the amount on the button is the amount sent: if the balance has moved since it was read, nothing is sent
            const now = await wrappedBalance(account);
            if (now !== held) { setHeld(now); throw new Error('Your wrapped USDC changed since this page read it, so nothing was sent. Check the amount and press again.'); }
            say(confirmHint);
            const r = await unwrap(w, vyre, held);
            return { hash: r.hash, text: `Unwrapped ${exact(held)} WUSDC to USDC.` };
          }} />
      )}
    </div>
  );
}
