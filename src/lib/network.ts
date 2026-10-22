// Words and feature flags that follow the app's configured VYRE chain (src/lib/chain.ts).
// When VYRE_CHAIN later points at mainnet (target chain 3045, once an SDK defines it), these flip with it.
import { ARC_CHAIN, VYRE_CHAIN } from './chain';

/** True while the app is on a test network (today: VYRE Testnet 7357) */
export const IS_TESTNET = VYRE_CHAIN.testnet === true;

export const VYRE_NAME = VYRE_CHAIN.name;
export const VYRE_CHAIN_ID = VYRE_CHAIN.id;
export const ARC_NAME = ARC_CHAIN.name;

/** USDC as people should read it on this network */
export const USDC_LABEL = IS_TESTNET ? 'test USDC' : 'USDC';

/** Short network + money note for the footer (risk disclaimer stays beside it in the page) */
export const MONEY_FOOTNOTE = IS_TESTNET
  ? `${VYRE_NAME}: ${USDC_LABEL}, no real money.`
  : `${VYRE_NAME}.`;

/** Faucet UI and links: test networks only */
export const FAUCET_OFFERED = IS_TESTNET;
