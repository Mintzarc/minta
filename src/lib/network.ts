// Which VYRE network this build works on, chosen when the app is built, and everything that differs between them. The only
// file with per-network settings: chain.ts reads the chains from here, and every page asks `NETWORK` instead of naming a
// host, an address or a network's words itself.
//
//   VITE_NETWORK=mainnet | testnet     (set when building; anything else stops the build)
//
// Unset: a production build (`vite build`, which is what Vercel runs) is MAINNET, and the dev server is the testnet. The
// tests that need the other one set it.
import { arcMainnet, arcTestnet, vyreMainnet, vyreTestnet } from '@vyrechain/sdk';
import { getAddress, isAddress, isAddressEqual, zeroAddress, type Address, type Chain } from 'viem';

export type NetworkName = 'mainnet' | 'testnet';

/** The network a build is for: its setting when it names one, else mainnet for a production build and the testnet for the dev server */
export function resolveNetwork(setting: unknown, production: boolean): NetworkName {
  if (setting === undefined || setting === null || setting === '') return production ? 'mainnet' : 'testnet';
  if (setting === 'mainnet' || setting === 'testnet') return setting;
  throw new Error(`VITE_NETWORK must be "mainnet" or "testnet" (got ${JSON.stringify(setting)})`);
}

/**
 * MINTA's own fee on the launches made through this app, a launchpad ("partner") fee of the contracts: it is fixed per token
 * at launch, paid in USDC by the fee splitter to `address`, and added on top of the 1% platform fee and the creator's tax.
 * Mainnet only; the testnet's launches name no partner. This is the one place the pair is set.
 */
export const MINTA_PARTNER = {
  address: '0x72938Daaf3c2Fa4bEf722E1263a5766755788392' as Address,
  feeBps: 100,
} as const;

/** The contracts' hard maximum for a partner fee, in basis points (1%); the SDK's LAUNCH_LIMITS.maxPartnerFeeBps */
export const MAX_PARTNER_FEE_BPS = 100;
/** The platform fee every trade pays, in basis points (1%: fixed in the fee splitter and the pools) */
export const PLATFORM_FEE_BPS = 100;

export interface PartnerPair { partner: Address; partnerFeeBps: number }

/**
 * A partner and its fee must come as a pair, as the contract requires: a fee needs a partner that isn't the zero address,
 * and a partner needs a fee (an address with no fee, or a fee with no address, is refused). Returns the pair checksummed.
 */
export function checkPartnerPair(partner: unknown, feeBps: unknown): PartnerPair {
  if (typeof partner !== 'string' || !isAddress(partner, { strict: false })) throw new Error('The partner must be an address.');
  if (isAddressEqual(partner, zeroAddress)) throw new Error('A partner fee needs a partner: the zero address is refused.');
  if (!Number.isInteger(feeBps) || (feeBps as number) <= 0) throw new Error('A partner needs a fee above zero: a partner with no fee is refused.');
  if ((feeBps as number) > MAX_PARTNER_FEE_BPS) throw new Error(`The partner fee can be at most ${MAX_PARTNER_FEE_BPS} basis points (1%).`);
  return { partner: getAddress(partner), partnerFeeBps: feeBps as number };
}

/** What a launch made through the app names as its partner on `network`: MINTA on mainnet, nobody on the testnet */
export function partnerFor(network: NetworkName): PartnerPair | null {
  return network === 'mainnet' ? checkPartnerPair(MINTA_PARTNER.address, MINTA_PARTNER.feeBps) : null;
}

/** A rate in basis points as a percentage in words ("1%", "0.5%", "2%") */
export const percentOf = (bps: number) => `${bps / 100}%`;

/** The fees every trade pays besides the creator's tax, worked out from the constants: `{ platform, minta, total }` as basis points and text */
export function tradeFees(partner: PartnerPair | null, partnerName = 'MINTA') {
  const platformBps = PLATFORM_FEE_BPS, mintaBps = partner?.partnerFeeBps ?? 0, totalBps = platformBps + mintaBps;
  return {
    platformBps, mintaBps, totalBps,
    text: mintaBps
      ? `${percentOf(platformBps)} platform fee + ${percentOf(mintaBps)} ${partnerName} fee = ${percentOf(totalBps)} per trade`
      : `${percentOf(platformBps)} platform fee per trade`,
  };
}

interface NetworkSettings {
  name: NetworkName;
  testnet: boolean;
  vyre: Chain;
  arc: Chain;
  /** The app API (pictures, launch files, the check before signing): a host of the network, no slash at the end */
  api: string;
  /** The promoter service, or null where the promoter program isn't offered */
  promoters: string | null;
  /** What the network is called on screen */
  label: string;
  /** How long a withdrawal to Arc takes, in words */
  withdrawal: string;
}

const SETTINGS: Record<NetworkName, NetworkSettings> = {
  testnet: {
    name: 'testnet', testnet: true, vyre: vyreTestnet, arc: arcTestnet,
    api: 'https://testnet-api.vyrechain.com',
    promoters: `${vyreTestnet.rpcUrls.default.http[0]}/promoters`,
    label: 'VYRE Testnet',
    withdrawal: 'usually under half an hour on the testnet',
  },
  mainnet: {
    name: 'mainnet', testnet: false, vyre: vyreMainnet, arc: arcMainnet,
    api: 'https://api.vyrechain.com',
    promoters: null,
    label: 'VYRE Mainnet',
    withdrawal: 'a withdrawal takes about a day',
  },
};

/** The settings of a network, by name */
export const settingsFor = (n: NetworkName): NetworkSettings => SETTINGS[n];

/** A browser-storage key for something that belongs to one network (a launch being sent, a transaction being checked): the
 * testnet keeps its old names, the others get their network's name, so nothing kept for one is read as the other's */
export const scoped = (key: string, n: NetworkName = NETWORK.name) => (n === 'testnet' ? key : `${key}.${n}`);

/** The network this build is for */
export const NETWORK: NetworkSettings = SETTINGS[resolveNetwork(import.meta.env.VITE_NETWORK, import.meta.env.PROD)];
/** The partner (MINTA and its fee) every launch made here names, or null */
export const PARTNER: PartnerPair | null = partnerFor(NETWORK.name);
/** The fees every trade pays here besides the creator's tax, as text for the launch wizard and the token page */
export const FEES = tradeFees(PARTNER);
