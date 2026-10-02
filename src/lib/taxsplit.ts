// The check on a launch's tax split (the Manage page's "Split the tax"), made before anything is sent.
//
// Tax is paid in WUSDC. The pad itself refuses only a few addresses as tax wallets (zero, the pad, launch pools and
// tokens, the quote token, the pool factory and the fee splitter); tax sent to any other contract that can't pass WUSDC on
// is lost for good, and tax sent to the chain's Multicall3 can be taken by anyone (it makes whatever call it is asked
// to). So this refuses, besides the pad's own rules: every contract the SDK lists for the chain (the same list the SDK's
// own setTaxWallets refuses), the chain's Multicall3, the launch's own pool and token, and the chain's system addresses.
//
// No imports from the app (only viem), so node runs this file in the unit tests (test/taxsplit.test.mjs).
import { isAddress } from 'viem';

export type SplitRow = { addr: string; share: string };

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

/** Whether a (valid) address is one of the chain's system addresses */
export const isSystemAddress = (addr: string) => BigInt(addr) < SYSTEM_BELOW;

/** Each row's share as basis points */
export const splitBps = (rows: readonly SplitRow[]) => rows.map((r) => Math.round(Number(r.share) * 100));

/** Why a split can't be saved, in words ('' when it can) */
export function taxSplitProblem(rows: readonly SplitRow[], refused: ReadonlySet<string>): string {
  const bps = splitBps(rows);
  return rows.length === 0 || rows.length > 4 ? 'One to four wallets.'
    : rows.some((r) => !isAddress(r.addr, { strict: true })) ? 'Every wallet needs a full address, typed exactly (a mistyped letter in a mixed-case address fails its checksum).'
    : rows.some((r) => isSystemAddress(r.addr)) ? 'That’s one of the chain’s system addresses, not a wallet: tax sent there would be lost.'
    : rows.some((r) => refused.has(r.addr.toLowerCase())) ? 'That’s one of the chain’s or the launchpad’s own contracts: tax sent there would be lost, or open to anyone to take.'
    : bps.some((x) => !isFinite(x) || x <= 0) ? 'Every share must be above 0%.'
    : bps.reduce((a, x) => a + x, 0) !== 10_000 ? 'The shares must add up to 100%.' : '';
}
