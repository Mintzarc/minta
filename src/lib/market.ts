// What the app shows about launches: prices, market caps, balances, recent trades and each launch's picture and links.
// Prices are the pool's own mid price (before fees); trades quote through the SDK, which includes every fee.
import { getAddress, parseAbi, parseAbiItem, type Address, type Hash } from 'viem';
import { getAddresses, getLaunches, vyreTestnet, vyreTokenAbi, type Launch } from '@vyrechain/sdk';
import { vyre } from './chain';

const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
]);
export const swapEvent = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);
const Q192 = 2n ** 192n;
const E18 = 10n ** 18n;

export const addresses = () => getAddresses(vyreTestnet.id);

/** USDC per token (as a float, for display) from a pool's sqrt price, given which side USDC is on */
export function priceFrom(sqrtPriceX96: bigint, quoteIsToken0: boolean): number {
  // token1 per token0, kept exact as long as possible
  const p = Number((sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / Q192) / 1e18;
  if (!isFinite(p) || p <= 0) return 0;
  return quoteIsToken0 ? 1 / p : p;
}

export interface Market {
  price: number; // USDC per token
  marketCap: number; // USDC
  quoteIsToken0: boolean;
}

export async function marketOf(launch: Launch): Promise<Market> {
  const { wusdc } = addresses();
  const [slot0, token0] = await Promise.all([
    vyre.readContract({ address: launch.pool, abi: poolAbi, functionName: 'slot0' }),
    vyre.readContract({ address: launch.pool, abi: poolAbi, functionName: 'token0' }),
  ]);
  const quoteIsToken0 = getAddress(token0) === getAddress(wusdc);
  const price = priceFrom(slot0[0], quoteIsToken0);
  return { price, marketCap: price * (Number(launch.totalSupply / 10n ** 12n) / 1e6), quoteIsToken0 };
}

export type Listed = Launch & { index: number; market?: Market };

// every launch read so far, newest first (for the search panel to open with at once), and when the newest were read
let seen: Listed[] | null = null;
let seenAt = 0;
/** The launches read so far, newest first, or null */
export const cachedLaunches = () => seen;
/** How long ago (ms) the newest launches were last read */
export const cacheAge = () => (seenAt ? Date.now() - seenAt : Infinity);

/** The newest launches with their markets (one Multicall3 round for the markets) */
export async function listLaunches(count = 30, from?: number): Promise<Listed[]> {
  const list: Listed[] = await getLaunches(vyre, { count, from });
  const markets = await Promise.all(list.map((l) => marketOf(l).catch(() => undefined)));
  const out = list.map((l, i) => ({ ...l, market: markets[i] }));
  // merged by token, the fresh read winning, so a shorter list with newer launches still lands
  const byToken = new Map((seen || []).map((l) => [l.token, l]));
  for (const l of out) {
    const before = byToken.get(l.token);
    byToken.set(l.token, l.market || !before ? l : { ...l, market: before.market });
  }
  seen = [...byToken.values()].sort((a, b) => b.index - a.index);
  if (from === undefined) seenAt = Date.now();
  return out;
}

export async function usdcBalance(account: Address): Promise<bigint> {
  return vyre.getBalance({ address: account });
}

export async function tokenBalance(token: Address, account: Address): Promise<bigint> {
  return vyre.readContract({ address: token, abi: vyreTokenAbi, functionName: 'balanceOf', args: [account] });
}

export interface Trade {
  hash: Hash;
  block: bigint;
  isBuy: boolean;
  usdc: bigint; // what the pool took, its buy fee included (a buy), or paid out after its sell fee (a sale)
  tokens: bigint;
  price: number;
  time?: number;
}

const blockTimes = new Map<bigint, number>();

/** The pool's latest swaps (every router), newest first, with block times */
export async function recentTrades(launch: Launch, quoteIsToken0: boolean, blocksBack = 200_000n, max = 25): Promise<Trade[]> {
  const latest = await vyre.getBlockNumber();
  const fromBlock = latest > blocksBack ? latest - blocksBack : 0n;
  const logs = await vyre.getLogs({ address: launch.pool, event: swapEvent, fromBlock, toBlock: latest });
  const trades = logs.slice(-max).reverse().map((l) => {
    const a0 = l.args.amount0 ?? 0n, a1 = l.args.amount1 ?? 0n;
    const quote = quoteIsToken0 ? a0 : a1, token = quoteIsToken0 ? a1 : a0;
    return {
      hash: l.transactionHash as Hash,
      block: l.blockNumber as bigint,
      isBuy: quote > 0n,
      usdc: quote < 0n ? -quote : quote,
      tokens: token < 0n ? -token : token,
      price: priceFrom(l.args.sqrtPriceX96 ?? 0n, quoteIsToken0),
    };
  });
  const blocks = [...new Set(trades.map((t) => t.block))];
  // a block's time never changes: each is read once, then kept
  const times = await Promise.all(blocks.map((b) => blockTimes.get(b) ?? vyre.getBlock({ blockNumber: b })
    .then((x) => { const t = Number(x.timestamp); blockTimes.set(b, t); return t; }).catch(() => undefined)));
  const at = new Map(blocks.map((b, i) => [b, times[i]]));
  return trades.map((t) => ({ ...t, time: at.get(t.block) }));
}

// ---------------------------------------------------------------------------------------------------------------
// A launch's picture, description and links: a small JSON file its creator points to. Only what's safe to show is
// kept: an https or ipfs picture, the known links (http or https) under fixed labels with their sites' names, and
// plain text (React escapes it). The file is read for 8 seconds at most, and 64 KB at most.
// ---------------------------------------------------------------------------------------------------------------

export type LinkKey = 'website' | 'x' | 'telegram' | 'discord';

export interface Meta {
  image?: string;
  description?: string;
  /** In a fixed order, each with its fixed label and the site it really goes to (so "X" can't hide another site) */
  links: { key: LinkKey; label: string; url: string; host: string }[];
}

const LINKS: { key: LinkKey; label: string; from: string[] }[] = [
  { key: 'website', label: 'Website', from: ['website'] },
  { key: 'x', label: 'X', from: ['x', 'twitter'] },
  { key: 'telegram', label: 'Telegram', from: ['telegram'] },
  { key: 'discord', label: 'Discord', from: ['discord'] },
];
const META_BYTES = 64_000;

const ipfs = (u: string) => (u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7)}` : u);
const urlOf = (u: unknown, protocols: string[]): URL | undefined => {
  if (typeof u !== 'string' || u.length > 500) return undefined;
  try {
    const p = new URL(ipfs(u.trim()));
    return protocols.includes(p.protocol) && p.hostname ? p : undefined;
  } catch {
    return undefined;
  }
};
const safeUrl = (u: unknown) => urlOf(u, ['https:'])?.toString();

/** A response's body as text, or null past `max` bytes (read as a stream: a missing or false length can't get round it) */
async function capped(r: Response, max: number): Promise<string | null> {
  if (Number(r.headers.get('content-length') || 0) > max) return null;
  if (!r.body) return null;
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder().decode(all);
}

const cache = new Map<string, Promise<Meta | null>>();

export function metaOf(uri: string): Promise<Meta | null> {
  if (!uri) return Promise.resolve(null);
  if (!cache.has(uri)) {
    cache.set(uri, (async () => {
      const url = safeUrl(uri);
      if (!url) return null;
      // the timeout covers the whole read, body included
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const text = await capped(r, META_BYTES);
      if (text === null) return null;
      const j = JSON.parse(text);
      if (!j || typeof j !== 'object') return null;
      const raw: Record<string, unknown> = j.links && typeof j.links === 'object' ? j.links : {};
      const links: Meta['links'] = [];
      for (const l of LINKS) {
        const from = l.from.find((k) => Object.prototype.hasOwnProperty.call(raw, k) && urlOf(raw[k], ['https:', 'http:']));
        const u = from ? urlOf(raw[from], ['https:', 'http:']) : undefined;
        if (u) links.push({ key: l.key, label: l.label, url: u.toString(), host: u.hostname });
      }
      return {
        image: safeUrl(j.image),
        description: typeof j.description === 'string' ? j.description.slice(0, 600) : undefined,
        links,
      };
    })().catch(() => null));
  }
  return cache.get(uri)!;
}

export { E18 };
