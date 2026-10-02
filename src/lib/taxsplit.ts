// The checks on a launch's tax split (the Manage page's "Split the tax") and on lowering its taxes, made before anything is sent.
//
// Tax is paid in WUSDC. The pad itself refuses only a few addresses as tax wallets (zero, the pad, launch pools and
// tokens, the quote token, the pool factory and the fee splitter); tax sent to any other contract that can't pass WUSDC on
// is lost for good, and tax sent to the chain's Multicall3 can be taken by anyone (it makes whatever call it is asked
// to). So this refuses, besides the pad's own rules: every contract the SDK lists for the chain (the same list the SDK's
// own setTaxWallets refuses), the chain's Multicall3, the launch's own pool and token, and the chain's system addresses.
//
// A share or a tax is read as a plain percent with at most two decimals, or not at all: never "0x19", "1e1" or "+40" read as
// some number, and never a third decimal rounded away.
//
// No imports from the app (only viem), so node runs this file in the unit tests (test/taxsplit.test.mjs).
import { isAddress } from 'viem';

export type SplitRow = { addr: string; share: string };

// a percent as people type it: a plain number with at most two decimals (the pad counts in 0.01% steps). The same rule as
// format.ts's percentBps, which the tests hold this to (it isn't imported from there, so that node can run this file alone).
const PERCENT = /^\d+(\.\d{0,2})?$/;
const percentBps = (typed: string): number => {
  const s = typed.trim();
  if (!PERCENT.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
};

/** Addresses this low are the chain's system addresses (precompiles and the like), never someone's wallet */
const SYSTEM_BELOW = 1n << 32n;

/**
 * The addresses a tax split must never name, lower-cased: every address in `contracts` (the SDK's list for the chain;
 * entries that aren't addresses on this chain, like its first block or the parent chain's list, are skipped) and in
 * `more` (the chain's Multicall3, the launch's own pool and token)
 */
export function refusedTaxWallets(contracts: object, more: readonly (string | null | undefined)[]): Set<string> {
  return new Set([...(Object.values(contracts) as unknown[]), ...more]
    .filter((a): a is string => typeof a === 'string' && isAddress(a, { strict: false }))
    .map((a) => a.toLowerCase()));
}

/**
 * The addresses a launch's tax split must never name: `refusedTaxWallets` over the SDK's contracts for the chain and its Face ID
 * wallet contracts (the EntryPoint, the wallet factory and its implementation: `getFaceIdAddresses`, passed in so this file still
 * imports only viem), plus `more`
 */
export function refusedForSplit(contracts: object, faceIdContracts: object | null, more: readonly (string | null | undefined)[]): Set<string> {
  return refusedTaxWallets(contracts, [...(faceIdContracts ? (Object.values(faceIdContracts) as (string | null | undefined)[]) : []), ...more]);
}

/** Whether a (valid) address is one of the chain's system addresses */
export const isSystemAddress = (addr: string) => BigInt(addr) < SYSTEM_BELOW;

/** Each row's share as basis points (NaN for a share that isn't a plain percent with at most two decimals) */
export const splitBps = (rows: readonly SplitRow[]) => rows.map((r) => percentBps(r.share));

/** Why a split can't be saved, in words ('' when it can) */
export function taxSplitProblem(rows: readonly SplitRow[], refused: ReadonlySet<string>): string {
  const bps = splitBps(rows);
  return rows.length === 0 || rows.length > 4 ? 'One to four wallets.'
    : rows.some((r) => !isAddress(r.addr, { strict: true })) ? 'Every wallet needs a full address, typed exactly (a mistyped letter in a mixed-case address fails its checksum).'
    : rows.some((r) => isSystemAddress(r.addr)) ? 'That’s one of the chain’s system addresses, not a wallet: tax sent there would be lost.'
    : rows.some((r) => refused.has(r.addr.toLowerCase())) ? 'That’s one of the chain’s or the launchpad’s own contracts: tax sent there would be lost, or open to anyone to take.'
    : bps.some((x) => !Number.isInteger(x)) ? 'Each share is a percent with at most two decimals (like 12.5).'
    : bps.some((x) => x <= 0) ? 'Every share must be above 0%.'
    : bps.reduce((a, x) => a + x, 0) !== 10_000 ? 'The shares must add up to 100%.' : '';
}

/** Lowered taxes as typed (basis points, NaN for a field that isn't a plain percent with at most two decimals), and whether they can be sent: both read, neither higher than now, at least one lower */
export function loweredTaxes(buy: string, sell: string, now: { buyTaxBps: number; sellTaxBps: number }): { buy: number; sell: number; ok: boolean } {
  const b = percentBps(buy), s = percentBps(sell);
  const ok = Number.isInteger(b) && Number.isInteger(s) && b <= now.buyTaxBps && s <= now.sellTaxBps && (b < now.buyTaxBps || s < now.sellTaxBps);
  return { buy: b, sell: s, ok };
}
