// The platform wallet (where a tenth of each tax payout goes), as the launchpad contract names it now. The contract's owner can
// move it, so the pages read it from the chain and show that; the address written in the app is only what is shown while the
// read is on its way, or with a note when the chain can't be read.
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { vyre } from './chain';
import { NETWORK } from './network';
import { PAD_V2, padV2Abi } from './padv2';
import { platformWalletShown, type PlatformWalletRead } from './platformShown';

let reading: Promise<Address> | null = null;
const read = (): Promise<Address> => {
  // only the mainnet launchpad has one (the pages show it only there)
  if (NETWORK.name !== 'mainnet') return Promise.reject(new Error('no platform wallet on this network'));
  reading ??= vyre.readContract({ address: PAD_V2.pad, abi: padV2Abi, functionName: 'platformWallet' });
  // a failed read is tried again by the next page that asks
  reading.catch(() => { reading = null; });
  return reading;
};

/** The platform wallet to show, and a note when it is not the chain's own answer */
export function usePlatformWallet(): { address: Address; note: string } {
  const [got, setGot] = useState<PlatformWalletRead>('reading');
  useEffect(() => {
    let live = true;
    read().then((a) => { if (live) setGot(a); }, () => { if (live) setGot('failed'); });
    return () => { live = false; };
  }, []);
  return platformWalletShown(got, PAD_V2.platformWallet);
}
