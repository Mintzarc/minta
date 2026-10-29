// Which VYRE network this build works on, chosen when the app is built, and everything that differs between them. The only
// file with per-network settings: chain.ts reads the chains from here, and every page asks `NETWORK` instead of naming a
// host, an address or a network's words itself.
//
//   VITE_NETWORK=mainnet | testnet     (set when building; anything else stops the build)
//
// Unset: a production build (`vite build`, which is what Vercel runs) is MAINNET, and the dev server is the testnet. The
// tests that need the other one set it.
import { arcMainnet, arcTestnet, vyreMainnet, vyreTestnet } from '@vyrechain/sdk';
import type { Chain } from 'viem';

export type NetworkName = 'mainnet' | 'testnet';

/** The network a build is for: its setting when it names one, else mainnet for a production build and the testnet for the dev server */
export function resolveNetwork(setting: unknown, production: boolean): NetworkName {
  if (setting === undefined || setting === null || setting === '') return production ? 'mainnet' : 'testnet';
  if (setting === 'mainnet' || setting === 'testnet') return setting;
  throw new Error(`VITE_NETWORK must be "mainnet" or "testnet" (got ${JSON.stringify(setting)})`);
}

/** The contracts' largest tax a creator can set on one side, in basis points (10%): the SDK's LAUNCH_LIMITS.maxTaxBps */
export const MAX_TAX_BPS = 1000;

interface NetworkSettings {
  name: NetworkName;
  testnet: boolean;
  vyre: Chain;
  arc: Chain;
  /** The app API (pictures, launch files, the check before signing): a host of the network, no slash at the end */
  api: string;
  /** The promoter service, or null where the promoter program isn't offered */
  promoters: string | null;
  /** The smallest tax a creator can set on one side when launching here, in basis points (mainnet: 1%; the testnet's contract allows none) */
  minTaxBps: number;
  /** What the network is called on screen */
  label: string;
  /** How long a withdrawal to Arc takes, in words */
  withdrawal: string;
  /** Whether email sign-in (Circle) is offered here. Where it is not, the app never asks the sign-in service about it */
  emailSignIn: boolean;
}

const SETTINGS: Record<NetworkName, NetworkSettings> = {
  testnet: {
    name: 'testnet', testnet: true, vyre: vyreTestnet, arc: arcTestnet,
    api: 'https://testnet-api.vyrechain.com',
    promoters: `${vyreTestnet.rpcUrls.default.http[0]}/promoters`,
    minTaxBps: 0,
    label: 'VYRE Testnet',
    withdrawal: 'usually under half an hour on the testnet',
    emailSignIn: true,
  },
  mainnet: {
    name: 'mainnet', testnet: false, vyre: vyreMainnet, arc: arcMainnet,
    api: 'https://api.vyrechain.com',
    promoters: null,
    minTaxBps: 100,
    label: 'VYRE Mainnet',
    withdrawal: 'a withdrawal takes about a day',
    emailSignIn: false,
  },
};

/** The settings of a network, by name */
export const settingsFor = (n: NetworkName): NetworkSettings => SETTINGS[n];

/** A browser-storage key for something that belongs to one network (a launch being sent, a transaction being checked): the
 * testnet keeps its old names, the others get their network's name, so nothing kept for one is read as the other's */
export const scoped = (key: string, n: NetworkName = NETWORK.name) => (n === 'testnet' ? key : `${key}.${n}`);

/** The network this build is for */
export const NETWORK: NetworkSettings = SETTINGS[resolveNetwork(import.meta.env.VITE_NETWORK, import.meta.env.PROD)];

// Words and flags the wallet page uses; they follow the network the app was built for
/** True while the app is built for the test network */
export const IS_TESTNET = NETWORK.testnet;
/** USDC as people should read it on this network */
export const USDC_LABEL = IS_TESTNET ? 'test USDC' : 'USDC';
/** Faucet UI and links: the test network only */
export const FAUCET_OFFERED = IS_TESTNET;
