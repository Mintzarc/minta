// Who launched each token, read from the launchpad's launch events (a launch's `creator` changes when it is handed over; the
// event does not). Read only when a creator is hidden or blocked (components/Hidden.tsx), once from the launchpad's first block
// and after that only the blocks since.
import { vyre } from './chain';
import { addresses } from './market';
import { launchCreated, pagedLogs } from './stats';

const known = new Map<string, string>();
let readTo: bigint | null = null;
let reading: Promise<ReadonlyMap<string, string>> | null = null;

/** token -> the creator in its launch event (both lower-cased), brought up to the chain's newest block; a failed read throws and keeps what was known */
export function firstCreators(): Promise<ReadonlyMap<string, string>> {
  reading ??= (async () => {
    try {
      const a = addresses();
      const latest = await vyre.getBlockNumber({ cacheTime: 0 });
      const from = readTo !== null ? readTo + 1n : BigInt(a.startBlock ?? 0);
      if (from <= latest) {
        const logs = await pagedLogs((lo, hi) => vyre.getLogs({ address: a.pad, event: launchCreated, fromBlock: lo, toBlock: hi }), from, latest);
        for (const l of logs) if (l.args.token && l.args.creator) known.set(l.args.token.toLowerCase(), l.args.creator.toLowerCase());
        readTo = latest;
      }
      return new Map(known);
    } finally { reading = null; }
  })();
  return reading;
}
