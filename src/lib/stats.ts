// What the home page shows about each launch, from its pool's swaps: the last day's volume, price change and trend,
// the USDC bought in (its milestone progress), whether it's at the milestone now and when it most recently reached
// it, and its last trade; plus holder counts from the explorer. Read in the visitor's browser from the public RPC (a few log queries for every
// listed launch at once) and the explorer's API. That's fine at testnet scale; a busy mainnet needs an indexer.
import { getAddress, parseAbiItem, type Address } from 'viem';
import { isQuoteToken0, LOG_PAGE_BLOCKS, vyreTokenAbi } from '@vyrechain/sdk';
import { EXPLORER, vyre } from './chain';
import { addresses, priceFrom, swapEvent, type Listed } from './market';

const DAY = 86_400;
export const launchCreated = parseAbiItem(
  'event LaunchCreated(address indexed token, address indexed creator, address indexed pool, string name, string symbol, uint16 buyTaxBps, uint16 sellTaxBps, uint256 openingMarketCap, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)',
);

/**
 * The milestone: this much USDC bought into a launch's pool, net of sales (the USDC side of its liquidity). A display
 * measure only: nothing on chain changes when a launch reaches it. Counted in USDC bought in, not market cap, because
 * a creator picks the opening market cap and could open above any market-cap line. A launch counts as Graduated while
 * it holds the milestone, judged at the end of each transaction (so a buy and a sale in one transaction can't claim
 * it). Small on the testnet, where test USDC is scarce.
 */
export const MILESTONE = 100;
/** The milestone as people read it: $100 */
export const MILESTONE_TEXT = `$${MILESTONE.toLocaleString('en-US')}`;

export interface Stats {
  /**
   * USDC traded in the last 24 hours (what pools took on buys and paid out on sales); null if the day can't be dated.
   * The creator's first buy is part of the launch, so it's left out of this and of change24.
   */
  volume24: bigint | null;
  /** Price change over the last 24 hours, in percent (for younger launches, from the price after the launch
   * transaction, its first buy included) */
  change24: number | null;
  /** Recent prices, oldest first, ending at the current price */
  trend: number[];
  /** USDC bought in, net of sales: the pool's USDC liquidity, from its opening and current prices */
  raised: number;
  /** raised / MILESTONE */
  progress: number;
  /** At or above the milestone now */
  graduated: boolean;
  /** The block of the transaction that last took it from below the milestone to at or above it (later is newer) */
  reachedBlock?: bigint;
  /** The block of its latest trade */
  lastTradeBlock?: bigint;
  trades: number;
}

/** The last block at or before a unix time, from the explorer; 0 before the chain began; null if it can't tell */
export async function blockBefore(unix: number): Promise<bigint | null> {
  try {
    const r = await fetch(`${EXPLORER}/api?module=block&action=getblocknobytime&timestamp=${Math.floor(unix)}&closest=before`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { status?: string; result?: { blockNumber?: string } | string };
    const n = typeof j.result === 'object' ? j.result?.blockNumber : undefined;
    if (j.status === '1' && n && /^\d+$/.test(n)) return BigInt(n);
    return null;
  } catch {
    return null;
  }
}

/** Every log between two blocks, a page of blocks at a time (newest first), until `stop` says there's enough */
export async function pagedLogs<T>(read: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint, stop?: (got: T[]) => boolean): Promise<T[]> {
  const out: T[] = [];
  for (let hi = to; hi >= from; hi -= LOG_PAGE_BLOCKS) {
    const lo = hi - LOG_PAGE_BLOCKS + 1n > from ? hi - LOG_PAGE_BLOCKS + 1n : from;
    out.push(...(await read(lo, hi)));
    if (stop?.(out)) break;
  }
  return out;
}

const thin = (xs: number[], max = 32) => (xs.length <= max ? xs : Array.from({ length: max }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (max - 1))]));
const whole = (v: bigint) => Number(v / 10n ** 12n) / 1e6;

/**
 * USDC in a pad pool at price p, for a launch that opened at p0 with its whole supply in one position from p0 up:
 * with liquidity L = supply × √p0, the USDC side is L × (√p − √p0) = supply × (√(p × p0) − p0).
 */
export const usdcIn = (supply: number, p0: number, p: number) => Math.max(0, supply * (Math.sqrt(p * p0) - p0));

/** Each listed launch's figures, by pool address */
export async function loadStats(list: Listed[]): Promise<Map<Address, Stats>> {
  const out = new Map<Address, Stats>();
  if (!list.length) return out;
  const a = addresses();
  const start = BigInt(a.startBlock ?? 0);
  const now = Math.floor(Date.now() / 1000);
  const [latest, before] = await Promise.all([vyre.getBlockNumber({ cacheTime: 0 }), blockBefore(now - DAY)]);
  const pools = list.map((l) => l.pool);
  const q0 = new Map(list.map((l) => [l.pool.toLowerCase(), l.market?.quoteIsToken0 ?? isQuoteToken0(l.token, a.wusdc)]));

  // every swap of every listed pool, and each launch's opening price (and its launch transaction)
  const [swaps, opened] = await Promise.all([
    pagedLogs((lo, hi) => vyre.getLogs({ address: pools, event: swapEvent, fromBlock: lo, toBlock: hi }), start, latest),
    pagedLogs((lo, hi) => vyre.getLogs({ address: a.pad, event: launchCreated, args: { token: list.map((l) => l.token) }, fromBlock: lo, toBlock: hi }), start, latest,
      (got) => got.length >= list.length),
  ]);
  const openPrice = new Map<string, number>();
  const launchTx = new Map<string, string>();
  for (const e of opened) {
    if (!e.args.pool || !e.args.sqrtPriceX96) continue;
    openPrice.set(e.args.pool.toLowerCase(), priceFrom(e.args.sqrtPriceX96, q0.get(e.args.pool.toLowerCase()) ?? false));
    launchTx.set(e.args.pool.toLowerCase(), e.transactionHash);
  }
  const byPool = new Map<string, typeof swaps>();
  for (const g of swaps) {
    const k = g.address.toLowerCase();
    const arr = byPool.get(k);
    if (arr) arr.push(g); else byPool.set(k, [g]);
  }

  for (const l of list) {
    // no price read for it this time: no figures, rather than zeros that look real
    if (!l.market || !(l.market.price > 0)) continue;
    const k = l.pool.toLowerCase();
    const quoteIs0 = q0.get(k) ?? false;
    const logs = (byPool.get(k) || []).sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
    const supply = whole(l.totalSupply);
    const current = l.market.price;
    const p0 = openPrice.get(k) ?? current;
    const created = launchTx.get(k);
    let volume24: bigint | null = before === null ? null : 0n;
    // where the day's change is counted from: the price going into the day, or for a younger launch the price after
    // its launch transaction (the creator's own first buy is part of the launch, not a trade of the day)
    let startPrice = p0;
    const recent: number[] = [];
    // the milestone, judged on each transaction's last swap: when it last went from below to at or above
    let above = false, reachedBlock: bigint | undefined;
    for (let i = 0; i < logs.length; i++) {
      const g = logs[i]!;
      const p = g.args.sqrtPriceX96 ? priceFrom(g.args.sqrtPriceX96, quoteIs0) : 0;
      const lastOfTx = i === logs.length - 1 || logs[i + 1]!.transactionHash !== g.transactionHash;
      if (lastOfTx && p > 0) {
        const now = usdcIn(supply, p0, p) >= MILESTONE;
        if (now && !above) reachedBlock = g.blockNumber;
        above = now;
      }
      if (g.transactionHash === created) { if (p > 0) startPrice = p; continue; }
      if (before !== null && g.blockNumber <= before) { if (p > 0) startPrice = p; continue; }
      const q = (quoteIs0 ? g.args.amount0 : g.args.amount1) ?? 0n;
      if (volume24 !== null) volume24 += q < 0n ? -q : q;
      if (p > 0) recent.push(p);
    }
    const raised = usdcIn(supply, p0, current);
    const graduated = raised >= MILESTONE;
    out.set(l.pool, {
      volume24,
      change24: before === null ? null : startPrice > 0 ? (current / startPrice - 1) * 100 : 0,
      // the day's prices; with no trade in the day, a flat line at the price (it didn't move)
      trend: thin(recent.length ? [startPrice, ...recent, current] : [current, current]),
      raised,
      progress: raised / MILESTONE,
      graduated,
      reachedBlock: graduated ? reachedBlock : undefined,
      lastTradeBlock: logs.length ? logs[logs.length - 1]!.blockNumber : undefined,
      trades: logs.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Holders, from the explorer (it counts every address with a balance), less VYRE's own contracts that hold some: the
// pool (the unsold supply), the pad (the dust its pool's position didn't take) and any other. The explorer is asked a
// few at a time and kept for a minute; the contracts' balances are read on chain in one round and kept for ten.
// ---------------------------------------------------------------------------------------------------------------

type Pair = { token: Address; pool: Address };
const held = new Map<string, { at: number; n: number | null }>();
const inContracts = new Map<string, { at: number; n: number }>();

/** How many of VYRE's contracts (the pool, the pad and the rest of the deployment) hold each token */
async function contractHolders(list: Pair[]): Promise<void> {
  const due = list.filter((l) => !(Date.now() - (inContracts.get(l.token.toLowerCase())?.at ?? 0) < 600_000));
  if (!due.length) return;
  const a = addresses();
  const ours = [a.pad, a.poolFactory, a.poolDeployer, a.feeSplitter, a.appRouter, a.swapRouter, a.quoter, a.tickLens, a.referrals, a.wusdc];
  await Promise.all(due.map(async (l) => {
    const who = [...new Set([l.pool, ...ours].map((x) => getAddress(x)))];
    try {
      const balances = await Promise.all(who.map((w) => vyre.readContract({ address: l.token, abi: vyreTokenAbi, functionName: 'balanceOf', args: [w] })));
      inContracts.set(l.token.toLowerCase(), { at: Date.now(), n: balances.filter((b) => b > 0n).length });
    } catch { /* kept as it was (or unknown) until the next try */ }
  }));
}

async function holdersOne({ token }: Pair): Promise<number | null> {
  const k = token.toLowerCase();
  const c = held.get(k);
  if (c && Date.now() - c.at < 60_000) return c.n;
  let n: number | null = null;
  try {
    const r = await fetch(`${EXPLORER}/api/v2/tokens/${token}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { holders_count?: string | number; holders?: string | number };
      const v = Number(j.holders_count ?? j.holders);
      const ours = inContracts.get(k)?.n;
      // without the contracts' count, no figure rather than one that counts them as holders
      n = Number.isFinite(v) && v >= 0 && ours !== undefined ? Math.max(0, v - ours) : null;
    }
  } catch { /* the explorer is optional */ }
  held.set(k, { at: Date.now(), n });
  return n;
}

export async function loadHolders(list: Pair[]): Promise<Map<Address, number | null>> {
  const out = new Map<Address, number | null>();
  await contractHolders(list);
  const queue = [...list];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) out.set(l.token, await holdersOne(l));
  }));
  return out;
}
