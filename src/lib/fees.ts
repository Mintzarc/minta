// What a trade costs, in words, for the network this build is for. On mainnet the creator's tax is the only fee a trader pays
// (1% to 10% a side, in USDC, charged by the pool); when it is paid out, one tenth of the amount goes to the platform wallet and the
// rest to the creator's tax wallets. Nothing else is added to a trade. The testnet's first launchpad worked differently, so its
// words are unchanged. Never "10% of every trade": the tenth is of the creator's tax, not of the trade.
import { NETWORK } from './network';

const main = !NETWORK.testnet;

/** Where the creator's tax goes, for a line next to a tax figure ("paid to you" on the testnet) */
export const TAX_GOES = main ? 'in USDC; a tenth goes to the platform wallet, the rest to the creator’s tax wallets' : 'paid to you';

/** The creator-facing sentence under the tax choice on the Create page; `range` is "1 to 10%" */
export const creatorTaxLine = (range: string) => main
  ? `The only fee a trader pays, in USDC: ${range} on each side. When it is paid out, a tenth of it goes to the platform wallet and the rest to your tax wallets (you, unless you split it). You can lower it later, never raise it.`
  : `Paid to you in USDC, ${range} each. You can lower it later, never raise it.`;
