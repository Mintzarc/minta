// Wrapped USDC (WUSDC) on VYRE: a token that holds USDC one for one, the way WETH holds ether. A launch's tax is paid out as it
// (the pool's fees are WUSDC, and the launchpad's payout sends them on as they are), so a wallet that receives tax holds WUSDC,
// not USDC, until it unwraps it. Unwrapping is one call on the token, `withdraw(amount)`, sent like every other transaction here:
// through the SDK's `sendCall`, which runs it first and sends only what passes.
import { parseAbi, type Address } from 'viem';
import { getAddresses, sendCall, type ReadClient, type WalletLike } from '@vyrechain/sdk';
import { NETWORK } from './network';
import { vyre } from './chain';

export const wusdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function withdraw(uint256 wad)',
]);

/** The wrapped-USDC token of the network this build is for */
export const wrappedAddress = (): Address => getAddresses(NETWORK.vyre.id).wusdc;

/** An account's wrapped USDC on VYRE (18 decimals, like USDC there) */
export const wrappedBalance = (account: Address): Promise<bigint> =>
  vyre.readContract({ address: wrappedAddress(), abi: wusdcAbi, functionName: 'balanceOf', args: [account] });

/** Unwraps exactly `amount` of the wallet's wrapped USDC into USDC */
export function unwrap(wallet: WalletLike, client: ReadClient, amount: bigint) {
  if (amount <= 0n) throw new Error('Nothing to unwrap.');
  return sendCall(wallet, client, { address: wrappedAddress(), abi: wusdcAbi, functionName: 'withdraw', args: [amount] });
}
