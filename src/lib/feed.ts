// What the top ticker shows: the latest buys and sales on MINTA's pools, the newest launches, and a few totals, read in the
// visitor's browser from the public RPC (one scan of the launches and of the day's swaps, then a small one every poll). Real
// trades only: whatever the pools' swap events say, test trades included (it's a testnet, and the bar says so). No wallet is
// named: a trade is shown by its token and its size. Dust (under $0.01) is left out of the line and of the volume, and a token shows once, so a few cheap trades can't fill
// the line (it is still an open chain: anyone can trade for real in small amounts; on mainnet raise MIN_USDC and add a hide
// list). Fine at testnet scale; a busy chain needs an indexer (a small server-built feed file, like the gas page's).
import type { Address, Hash } from 'viem';
import { isQuoteToken0, LOG_PAGE_BLOCKS } from '@vyrechain/sdk';
import { vyre } from './chain';
import { addresses, swapEvent } from './market';
import { blockBefore, launchCreated, pagedLogs } from './stats';

const DAY = 86_400;
const MIN_USDC = 0.01; // smaller trades aren't shown
const SHOWN = 24; // trades in the line (one per token)
const SHOWN_LAUNCHES = 6;
const MAX_ROWS = 4000; // swaps kept for the day's volume
const MAX_SPAN = LOG_PAGE_BLOCKS * 40n; // the most blocks one read covers; older ones are skipped (an indexer's job)
const DAY_START_EVERY = 600_000; // the day's first block is looked up again this often (ms)

export type FeedItem =
  | { kind: 'trade'; id: string; side: 'buy' | 'sell'; usdc: number; token: Address; symbol: string; time?: number }
  | { kind: 'launch'; id: string; token: Address; symbol: string; name: string; time?: number }
  | { kind: 'stat'; id: string; label: string; value: string };

interface Pool { token: Address; symbol: string; name: string; launchTx: Hash; quote0: boolean }
interface Row { id: string; block: bigint; index: number; pool: string; side: 'buy' | 'sell'; usdc: number }
interface Launch { id: string; block: bigint; pool: string }

export interface FeedState {
  pools: Map<string, Pool>;
  launches: Launch[];
  /** Every kept swap of the pad's pools since the day began, newest first */
  rows: Row[];
  /** The newest block read */
  last: bigint;
  /** The last block of the day before the one now (the explorer's answer), and when it was asked */
  dayStart: bigint | null;
  dayAt: number;
  /** Whether every block of the day was read, so its totals are whole */
  complete: boolean;
  /** Whether every launch since the pad began was read (the chain is younger than one read's reach) */
  launchesWhole: boolean;
}

const times = new Map<bigint, number>();
const timeMisses = new Map<bigint, number>();
async function timeOf(block: bigint): Promise<number | undefined> {
  const k = times.get(block);
  if (k !== undefined) return k;
  if (Date.now() - (timeMisses.get(block) ?? 0) < 60_000) return undefined; // asked just now and it failed: not again yet
  try {
    const b = await vyre.getBlock({ blockNumber: block });
    if (times.size > 600) times.clear();
    const t = Number(b.timestamp);
    times.set(block, t);
    return t;
  } catch { timeMisses.set(block, Date.now()); return undefined; }
}
const whole = (v: bigint) => Number(v / 10n ** 12n) / 1e6;
const byNewest = (x: { block: bigint; index?: number }, y: { block: bigint; index?: number }) => (x.block === y.block ? (y.index ?? 0) - (x.index ?? 0) : x.block < y.block ? 1 : -1);

/** Reads what's new since `prev` (or what the ticker needs, the first time); throws if the chain can't be read */
export async function loadFeed(prev?: FeedState): Promise<FeedState> {
  const a = addresses();
  const start = BigInt(a.startBlock ?? 0);
  const latest = await vyre.getBlockNumber({ cacheTime: 0 });
  let { dayStart, dayAt } = prev ?? { dayStart: null as bigint | null, dayAt: 0 };
  if (!prev || Date.now() - dayAt > DAY_START_EVERY) {
    const d = await blockBefore(Math.floor(Date.now() / 1000) - DAY);
    if (d !== null && (dayStart === null || d >= dayStart)) { dayStart = d; dayAt = Date.now(); } // never backwards
  }
  const floor = latest > MAX_SPAN ? latest - MAX_SPAN : 0n;
  // launches older than one read's reach aren't seen: then the launch count (and the swaps of those pools) are partial
  const launchesWhole = start >= floor;
  let from = prev ? prev.last + 1n : dayStart !== null ? dayStart + 1n : floor;
  let complete = prev?.complete ?? false;
  if (from < floor) { from = floor; complete = false; } // too much to read here: the day's totals are left out
  if (from < start) from = start;
  // the day's totals are whole when the read began at the day's start (or at the pad's own first block, when it is younger than a day)
  if (!prev) complete = dayStart !== null && from <= (dayStart + 1n > start ? dayStart + 1n : start) && launchesWhole;
  const pools = new Map(prev?.pools);
  const launches = [...(prev?.launches ?? [])];
  let rows = [...(prev?.rows ?? [])];
  if (!prev || from <= latest) {
    const [made, swaps] = await Promise.all([
      pagedLogs((lo, hi) => vyre.getLogs({ address: a.pad, event: launchCreated, fromBlock: lo, toBlock: hi }), prev ? from : floor > start ? floor : start, latest),
      pagedLogs((lo, hi) => vyre.getLogs({ event: swapEvent, fromBlock: lo, toBlock: hi }), from, latest),
    ]);
    for (const e of made) {
      const pool = e.args.pool, token = e.args.token;
      if (!pool || !token) continue;
      pools.set(pool.toLowerCase(), { token, symbol: String(e.args.symbol ?? ''), name: String(e.args.name ?? ''), launchTx: e.transactionHash as Hash, quote0: isQuoteToken0(token, a.wusdc) });
      const id = `${e.transactionHash}:${e.logIndex}`;
      if (!launches.some((l) => l.id === id)) launches.push({ id, block: e.blockNumber as bigint, pool: pool.toLowerCase() });
    }
    for (const g of swaps) {
      const p = pools.get(g.address.toLowerCase());
      if (!p || g.transactionHash === p.launchTx) continue; // another kind of pool; or the creator's first buy, which belongs to the launch
      const q = (p.quote0 ? g.args.amount0 : g.args.amount1) ?? 0n;
      if (q === 0n || whole(q < 0n ? -q : q) < MIN_USDC) continue; // dust: not in the line, not in the volume, and it can't push real trades out of the kept rows
      rows.push({ id: `${g.transactionHash}:${g.logIndex}`, block: g.blockNumber as bigint, index: g.logIndex as number, pool: g.address.toLowerCase(), side: q > 0n ? 'buy' : 'sell', usdc: whole(q < 0n ? -q : q) });
    }
  }
  const seen = new Set<string>();
  rows = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  rows.sort(byNewest);
  // what's older than the day isn't needed for its volume; the rest is kept up to a bound (a busy chain needs an indexer)
  if (dayStart !== null) rows = rows.filter((r) => r.block > dayStart!);
  if (rows.length > MAX_ROWS) { rows = rows.slice(0, MAX_ROWS); complete = false; }
  return { pools, launches, rows, last: prev && prev.last > latest ? prev.last : latest, dayStart, dayAt, complete, launchesWhole: prev ? prev.launchesWhole : launchesWhole };
}

/** The ticker's items from the state: totals, then the newest trades (one per token, no dust) and launches by time */
export async function feedItems(s: FeedState): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  const stats: FeedItem[] = [];
  if (s.launches.length && s.launchesWhole) {
    const day = s.complete && s.dayStart !== null ? s.launches.filter((l) => l.block > s.dayStart!).length : 0;
    stats.push({ kind: 'stat', id: 's-launches', label: 'Tokens launched', value: `${s.launches.length.toLocaleString('en-US')}${day ? ` · ${day} in the last 24h` : ''}` });
  }
  if (s.complete) {
    const volume = s.rows.reduce((n, r) => n + r.usdc, 0);
    if (volume > 0) stats.push({ kind: 'stat', id: 's-volume', label: '24h volume', value: `$${volume >= 1000 ? `${(volume / 1000).toFixed(1)}K` : volume.toFixed(2)}` });
  }
  const onePerToken = new Set<string>();
  const trades = s.rows.filter((r) => {
    if (r.usdc < MIN_USDC || onePerToken.has(r.pool)) return false;
    onePerToken.add(r.pool);
    return true;
  }).slice(0, SHOWN);
  const newest = [...s.launches].sort(byNewest).slice(0, SHOWN_LAUNCHES);
  // block times, a few at a time (the public RPC answers a visitor's requests one after another)
  const blocks = [...new Set([...trades.map((t) => t.block), ...newest.map((l) => l.block)])];
  const at = new Map<bigint, number | undefined>();
  for (let i = 0; i < blocks.length; i += 3) {
    await Promise.all(blocks.slice(i, i + 3).map(async (b) => { at.set(b, await timeOf(b)); }));
  }
  const items: (FeedItem & { sort: bigint })[] = [];
  for (const t of trades) {
    const p = s.pools.get(t.pool);
    if (p) items.push({ kind: 'trade', id: t.id, side: t.side, usdc: t.usdc, token: p.token, symbol: p.symbol, time: at.get(t.block), sort: t.block });
  }
  for (const l of newest) {
    const p = s.pools.get(l.pool);
    if (p) items.push({ kind: 'launch', id: `l-${l.id}`, token: p.token, symbol: p.symbol, name: p.name, time: at.get(l.block), sort: l.block });
  }
  items.sort((x, y) => (x.sort === y.sort ? 0 : x.sort < y.sort ? 1 : -1));
  out.push(...stats);
  // the totals come back after every few items, so they're seen however long the line runs
  items.forEach((it, i) => {
    out.push(it);
    if ((i + 1) % 8 === 0 && stats[0]) out.push({ ...stats[0], id: `${stats[0].id}-${i}` });
  });
  return out;
}
