// Whether the launchpad contract is taking new launches. VyrePad has a switch for it (`launchesOpen`, set by the contract's
// owner): while it is off, a launch fails with "launches closed" and the Create page says so up front instead of letting the
// wizard run to a failure. Trading on launches that already exist is never affected.
import { useEffect, useState } from 'react';
import { vyre } from './chain';
import { vyrePadAbi } from './pad';
import { addresses } from './market';

/** `true` open, `false` closed, `null` when it couldn't be read (the wizard then stays usable: the SDK's own check stops a launch that would fail) */
export async function readLaunchesOpen(): Promise<boolean | null> {
  try {
    return await vyre.readContract({ address: addresses().pad, abi: vyrePadAbi, functionName: 'launchesOpen' });
  } catch {
    return null;
  }
}

/** The switch as the page sees it: undefined while it is being read, then true, false or null (unreadable); read again every 30 s */
export function useLaunchesOpen(): boolean | null | undefined {
  const [open, setOpen] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => readLaunchesOpen().then((v) => { if (live) setOpen(v); });
    read();
    const t = setInterval(read, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return open;
}
