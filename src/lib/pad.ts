// The launchpad calls the pages use, for the network this build is for. On the testnet they are the SDK's own (the first
// launchpad and its app router). On mainnet they are lib/padv2.ts's: the new pad, whose creator tax is the only fee a trade pays,
// and Uniswap's SwapRouter. Both sets have the same names and shapes, so a page imports from here and never names a network.
//
// On mainnet this also tells the SDK where the new deployment is (`registerDeployment`), so everything else that asks the SDK for
// the pad's, the factory's or the router's address (`getAddresses`) gets the new contracts. The old launchpad, fee splitter, app
// router and referrals contracts stay in the record only because the SDK wants a complete record; nothing here calls them.
import * as sdk from '@vyrechain/sdk';
import type { Address } from 'viem';
import { NETWORK } from './network';
import * as v2 from './padv2';

const main = !NETWORK.testnet;

if (main) {
  sdk.registerDeployment(v2.MAINNET_ID, {
    ...sdk.getAddresses(v2.MAINNET_ID),
    pad: v2.PAD_V2.pad,
    poolFactory: v2.PAD_V2.poolFactory,
    poolDeployer: v2.PAD_V2.poolDeployer,
    swapRouter: v2.PAD_V2.swapRouter,
    quoter: v2.PAD_V2.quoter,
    tickLens: v2.PAD_V2.tickLens,
    wusdc: v2.PAD_V2.wusdc,
    startBlock: v2.PAD_V2.startBlock,
  });
}

export const LAUNCH_LIMITS = (main ? { ...sdk.LAUNCH_LIMITS, ...v2.PAD_V2_LIMITS } : { ...sdk.LAUNCH_LIMITS, minTaxBps: 0 }) as typeof sdk.LAUNCH_LIMITS & { readonly minTaxBps: number };
export const checkLaunchParams: typeof sdk.checkLaunchParams = main ? v2.checkLaunchParams : sdk.checkLaunchParams;
export const getLaunch: typeof sdk.getLaunch = main ? v2.getLaunch : sdk.getLaunch;
export const getLaunches: typeof sdk.getLaunches = main ? v2.getLaunches : sdk.getLaunches;
export const getLaunchCount: typeof sdk.getLaunchCount = main ? v2.getLaunchCount : sdk.getLaunchCount;
export const getTaxWallets: typeof sdk.getTaxWallets = main ? v2.getTaxWallets : sdk.getTaxWallets;
export const quoteBuy: typeof sdk.quoteBuy = main ? v2.quoteBuy : sdk.quoteBuy;
export const quoteSell: typeof sdk.quoteSell = main ? v2.quoteSell : sdk.quoteSell;
export const launch: typeof sdk.launch = main ? v2.launch : sdk.launch;
export const buy: typeof sdk.buy = main ? v2.buy : sdk.buy;
export const sell: typeof sdk.sell = main ? v2.sell : sdk.sell;
/** The launchpad contract's ABI for the calls the pages make (reads, launch events, the creator's controls) */
export const vyrePadAbi = (main ? v2.padV2Abi : sdk.vyrePadAbi) as unknown as typeof sdk.vyrePadAbi;

/** Where a trade is sent, and where a sale's token approval goes: the SwapRouter on mainnet, the app router on the testnet */
export const tradeRouter = (): Address => (main ? v2.PAD_V2.swapRouter : sdk.getAddresses(NETWORK.vyre.id).appRouter);

/** The launchpad's own addresses a launch's tax must never be sent to (see padv2.padV2Contracts); on the testnet the SDK's own list is used by the caller */
export const launchpadContracts = (): Address[] => (main ? v2.padV2Contracts() : []);

/** The addresses among `addrs` that are some launch's pool or token, which tax could never leave again (mainnet; on the testnet the SDK's simulation catches them) */
export const launchContractsAmong = (client: sdk.ReadClient, addrs: readonly string[]): Promise<Address[]> =>
  (main ? v2.launchContractsAmong(client, addrs) : Promise.resolve([]));

export type { Launch, LaunchParams, TaxWallets } from '@vyrechain/sdk';
