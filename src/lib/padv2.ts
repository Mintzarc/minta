// VYRE mainnet's launchpad, VyrePadV2 (chain 3045), as the app talks to it. The vendored SDK (0.6.0) is written for the first
// launchpad (VyrePad) and its app router, which mainnet no longer uses for launches; this file does the same jobs against the
// new pad and Uniswap's SwapRouter, with the same names and shapes, so the pages call one set of functions on either network
// (lib/pad.ts picks). It sends nothing by itself: every write goes through the SDK's own `sendCall`, which simulates the
// transaction first and then sends it from the visitor's wallet.
//
// The facts it rests on (the pad's deployment record and its source, VyrePadV2.sol):
//  - a launch is one `createLaunch` call; the creator's tax is 1% to 10% on each side (MIN_TAX_BPS, MAX_TAX_BPS), charged by the
//    pool itself in USDC, and it is the only fee a trade pays; there is no partner fee and no promoter share;
//  - the tax builds up in the pool's position; `collectCreatorFees` sends it out, and every payout pays exactly a tenth
//    (PLATFORM_SHARE_BPS) to the platform wallet and the rest to the creator or the creator's tax wallets;
//  - trades go through Uniswap's SwapRouter against the pool found by the token pair and the fee key 10000; the app router of the
//    first launchpad is not involved, and there is no app fee.
//
// Imports only viem and the SDK, so node runs this file in the unit tests (test/padv2.test.mjs).
import {
  encodeFunctionData, getAddress, isAddress, isAddressEqual, parseAbi, parseEventLogs, parseSignature, zeroAddress,
  type Address, type Hash, type Hex, type TransactionReceipt,
} from 'viem';
import { getChainId, readContract, signTypedData, simulateContract } from 'viem/actions';
import {
  isSmart, quoterV2Abi, sendCall, vyreTokenAbi,
  type BuyParams, type BuyResult, type Launch, type LaunchParams, type LaunchResult, type ReadClient, type SellParams, type SellResult,
  type TaxWallets, type WalletLike,
} from '@vyrechain/sdk';

/** VYRE mainnet's chain ID */
export const MAINNET_ID = 3045;

/** The contracts of VYRE mainnet's launchpad and its swap router (from the deployment record), all checksummed */
export const PAD_V2 = {
  pad: getAddress('0x3B3f9098575a88E56a22b9e2f93ea40fA9340bC5'),
  poolFactory: getAddress('0xdB209972c8E49d55774b65380fBd27547bF13f1E'),
  poolDeployer: getAddress('0x6ed298529a93f5Cf719fe4bB668aA7828f8a3bDe'),
  swapRouter: getAddress('0x38231F0fa2Bb09Fdb3fD783b110CB5B3a4d3Ad84'),
  quoter: getAddress('0x92c33Bef4552fBAb7264A4Da1805743A295FC3FA'),
  tickLens: getAddress('0xb84a8029967Ace206ad1ed5775B90c7A769c5eA8'),
  wusdc: getAddress('0xf892e07468eE3cca58795C265de4DfAa3d3b04dc'),
  /** Where the platform's tenth of every payout of a launch's tax goes */
  platformWallet: getAddress('0x72938Daaf3c2Fa4bEf722E1263a5766755788392'),
  /** The block before the fresh factory's first transaction: where to start looking for the pad's events */
  startBlock: 59,
} as const;

/** The fee key every pad pool is found by (the real fees are the pool's own buy and sell fees) */
export const POOL_FEE_KEY = 10_000;
/** 2%: another trade can land between a quote and the transaction */
export const DEFAULT_SLIPPAGE_BPS = 200;
/** A trade must be mined within 10 minutes of being made */
export const DEFAULT_DEADLINE_SECONDS = 600;
const E18 = 10n ** 18n;

/** VyrePadV2's limits on a launch (checked here first, so a bad launch fails before it reaches the wallet) */
export const PAD_V2_LIMITS = {
  maxNameBytes: 64,
  maxSymbolBytes: 16,
  minSupply: 1000n * E18,
  maxSupply: 10n ** 15n * E18,
  openingMarketCap: 3000n * E18,
  /** The lowest and highest tax on one side, in basis points: 1% and 10% */
  minTaxBps: 100,
  maxTaxBps: 1_000,
  /** This pad has no partner fee */
  maxPartnerFeeBps: 0,
  maxMetadataBytes: 256,
  maxTaxWallets: 4,
} as const;

/** The platform's share of every payout of a launch's tax, in basis points of the amount paid out: a tenth */
export const PLATFORM_SHARE_BPS = 1_000;

export const padV2Abi = parseAbi([
  'function launches(address token) view returns (address pool, uint16 buyTaxBps, uint16 sellTaxBps, int24 tickLower, int24 tickUpper, address creator, uint64 createdAt)',
  'function tokens(uint256 index) view returns (address)',
  'function tokenOfPool(address pool) view returns (address)',
  'function metadataOf(address token) view returns (string)',
  'function pendingCreator(address token) view returns (address)',
  'function taxWalletsOf(address token) view returns (address[] wallets, uint16[] bps)',
  'function launchCount() view returns (uint256)',
  'function launchesOpen() view returns (bool)',
  'function platformWallet() view returns (address)',
  'function createLaunch((string name, string symbol, uint256 totalSupply, uint256 startingMarketCap, uint16 buyTaxBps, uint16 sellTaxBps, string metadataURI) p) payable returns (address token, address pool, uint256 bought)',
  'function collectCreatorFees(address token) returns (uint256 amount)',
  'function setTaxWallets(address token, address[] wallets, uint16[] bps)',
  'function lowerTaxes(address token, uint16 buyTaxBps, uint16 sellTaxBps)',
  'function setMetadata(address token, string uri)',
  'function offerCreator(address token, address to)',
  'function acceptCreator(address token, uint16 buyTaxBps, uint16 sellTaxBps)',
  'event LaunchCreated(address indexed token, address indexed creator, address indexed pool, string name, string symbol, uint16 buyTaxBps, uint16 sellTaxBps, uint256 openingMarketCap, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)',
  'event FirstBuy(address indexed token, address indexed creator, uint256 usdcIn, uint256 tokensOut)',
  'event CreatorFeesCollected(address indexed token, address indexed creator, uint256 amount)',
  'event PlatformPaid(address indexed token, address indexed wallet, uint256 amount)',
  'event TaxPaid(address indexed token, address indexed wallet, uint256 amount)',
]);

/** Uniswap v3's SwapRouter, the calls this file makes (exact input on one pool, native USDC in and out through WUSDC) */
export const swapRouterAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function refundETH() payable',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable',
]);

const erc20Events = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
]);

// ---------------------------------------------------------------------------------------------------------------
// Launches
// ---------------------------------------------------------------------------------------------------------------

/** A launch by its token's address, or null if the token isn't a launch on the new pad. Makes 5 contract reads. */
export async function getLaunch(client: ReadClient, token: Address): Promise<Launch | null> {
  const [pool, buyTaxBps, sellTaxBps, , , creator, createdAt] = await readContract(client, {
    address: PAD_V2.pad, abi: padV2Abi, functionName: 'launches', args: [token],
  });
  if (pool === zeroAddress) return null;
  const [metadataURI, name, symbol, totalSupply] = await Promise.all([
    readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'metadataOf', args: [token] }),
    readContract(client, { address: token, abi: vyreTokenAbi, functionName: 'name' }),
    readContract(client, { address: token, abi: vyreTokenAbi, functionName: 'symbol' }),
    readContract(client, { address: token, abi: vyreTokenAbi, functionName: 'totalSupply' }),
  ]);
  return {
    token: getAddress(token), pool, creator, buyTaxBps, sellTaxBps, partner: null, partnerFeeBps: 0,
    createdAt: Number(createdAt), metadataURI, name, symbol, totalSupply,
  };
}

/** How many tokens have launched on the new pad */
export async function getLaunchCount(client: ReadClient): Promise<number> {
  return Number(await readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'launchCount' }));
}

/** Launches, newest first: up to `count` (default 10) starting at index `from` (default the newest) and going back; each carries its `index` */
export async function getLaunches(client: ReadClient, { from, count = 10 }: { from?: number; count?: number } = {}): Promise<(Launch & { index: number })[]> {
  const total = await getLaunchCount(client);
  const start = Math.min(from ?? total - 1, total - 1);
  const indexes = Array.from({ length: Math.max(0, Math.min(count, start + 1)) }, (_, k) => start - k);
  const tokens = await Promise.all(indexes.map((i) => readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'tokens', args: [BigInt(i)] })));
  const found = await Promise.all(tokens.map((t) => getLaunch(client, t)));
  return found.flatMap((l, k) => (l ? [{ ...l, index: indexes[k] }] : []));
}

/** The wallets a launch's tax is split between; both lists are empty when it all goes to the creator */
export async function getTaxWallets(client: ReadClient, token: Address): Promise<TaxWallets> {
  const [wallets, bps] = await readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'taxWalletsOf', args: [token] });
  return { wallets: [...wallets], bps: [...bps] };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Throws if a launch breaks one of the pad's limits (see PAD_V2_LIMITS) */
export function checkLaunchParams(p: LaunchParams): void {
  const L = PAD_V2_LIMITS;
  if (bytes(p.name) < 1 || bytes(p.name) > L.maxNameBytes) throw new Error(`name must be 1 to ${L.maxNameBytes} bytes`);
  if (bytes(p.symbol) < 1 || bytes(p.symbol) > L.maxSymbolBytes) throw new Error(`symbol must be 1 to ${L.maxSymbolBytes} bytes`);
  if (p.totalSupply < L.minSupply || p.totalSupply > L.maxSupply) throw new Error('totalSupply must be 1,000 to 1 quadrillion whole tokens (18 decimals)');
  if (p.startingMarketCap !== undefined && p.startingMarketCap !== L.openingMarketCap) {
    throw new Error('startingMarketCap must be $3,000 (3,000e18): every launch opens at that market cap');
  }
  for (const [name, v] of [['buyTaxBps', p.buyTaxBps], ['sellTaxBps', p.sellTaxBps]] as const) {
    if (!Number.isInteger(v) || v < L.minTaxBps || v > L.maxTaxBps) throw new Error(`${name} must be a whole number from ${L.minTaxBps} to ${L.maxTaxBps}`);
  }
  if (p.partner !== undefined && !isAddressEqual(p.partner, zeroAddress)) throw new Error('this launchpad has no partner fee');
  if ((p.partnerFeeBps ?? 0) !== 0) throw new Error('this launchpad has no partner fee');
  if (bytes(p.metadataURI ?? '') > L.maxMetadataBytes) throw new Error(`metadataURI must be at most ${L.maxMetadataBytes} bytes`);
  if ((p.firstBuyUsdc ?? 0n) < 0n) throw new Error('firstBuyUsdc must not be negative');
}

/** Launches a token in one transaction; the wallet's account becomes the creator. `firstBuyUsdc` is sent along and buys for the creator before anyone else can trade. */
export async function launch(wallet: WalletLike, client: ReadClient, p: LaunchParams): Promise<LaunchResult> {
  checkLaunchParams(p);
  const { hash, receipt } = await sendCall(wallet, client, {
    address: PAD_V2.pad,
    abi: padV2Abi,
    functionName: 'createLaunch',
    args: [{
      name: p.name, symbol: p.symbol, totalSupply: p.totalSupply, startingMarketCap: PAD_V2_LIMITS.openingMarketCap,
      buyTaxBps: p.buyTaxBps, sellTaxBps: p.sellTaxBps, metadataURI: p.metadataURI ?? '',
    }],
    value: p.firstBuyUsdc ?? 0n,
  });
  const events = parseEventLogs({ abi: padV2Abi, logs: receipt.logs }).filter((e) => isAddressEqual(e.address, PAD_V2.pad));
  const created = events.find((e) => e.eventName === 'LaunchCreated');
  if (!created || created.eventName !== 'LaunchCreated') throw new Error(`no LaunchCreated event in ${hash}`);
  const first = events.find((e) => e.eventName === 'FirstBuy');
  return {
    hash, receipt, token: created.args.token, pool: created.args.pool,
    bought: first && first.eventName === 'FirstBuy' ? first.args.tokensOut : 0n,
    openingMarketCap: created.args.openingMarketCap,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Quotes and trades
// ---------------------------------------------------------------------------------------------------------------

const errText = (e: unknown): string => {
  const parts: string[] = [];
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { shortMessage?: unknown; message?: unknown; reason?: unknown };
    for (const v of [o.shortMessage, o.reason, o.message]) if (typeof v === 'string') parts.push(v);
  }
  return parts.join(' | ');
};

/** Uniswap's QuoterV2 isn't a view (it runs the swap and reverts), so it's called as a simulation; the pool's own tax is in the answer */
async function quote(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  try {
    const { result } = await simulateContract(client, {
      address: PAD_V2.quoter, abi: quoterV2Abi, functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee: POOL_FEE_KEY, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  } catch (err) {
    // 'ZF': the swap would trade nothing (a sale into a pool with no USDC in it yet, say): nothing to get
    if (/\bZF\b/.test(errText(err))) return 0n;
    throw err;
  }
}

/** The tokens a buy of `usdcIn` native USDC gets at the pool's price now, after the creator's buy tax (the only fee) */
export function quoteBuy(client: ReadClient, { token, usdcIn }: { token: Address; usdcIn: bigint }): Promise<bigint> {
  return quote(client, PAD_V2.wusdc, token, usdcIn);
}

/** The USDC a sale of `amountIn` tokens pays out at the pool's price now, after the creator's sell tax (the only fee) */
export function quoteSell(client: ReadClient, { token, amountIn }: { token: Address; amountIn: bigint }): Promise<bigint> {
  return quote(client, token, PAD_V2.wusdc, amountIn);
}

/** The SwapRouter's multicall of a sale, with calls (a permit) put in front of it */
type Sale = (before?: Hex[]) => { address: Address; abi: typeof swapRouterAbi; functionName: 'multicall'; args: [Hex[]] };

const defaultDeadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);
const nonZero = (quoted: bigint, message: string): bigint => {
  if (quoted === 0n) throw new Error(`${message} (quote: 0)`);
  return quoted;
};
const less = (amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint => {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new Error('slippageBps must be a whole number from 0 to 10,000');
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
};
const accountOf = (wallet: WalletLike) => {
  if (!wallet.account) throw new Error('the wallet has no account');
  return wallet.account;
};
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const swapCall = (tokenIn: Address, tokenOut: Address, recipient: Address, amountIn: bigint, amountOutMinimum: bigint, deadline: bigint): Hex =>
  encodeFunctionData({
    abi: swapRouterAbi, functionName: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee: POOL_FEE_KEY, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
  });
const noRecipient = (r: Address | undefined, trader: Address) => {
  if (r !== undefined && !sameAddress(r, trader)) throw new Error('this launchpad’s trades go to the trading wallet only');
};

/** Buys a launch token with native USDC through the SwapRouter (the router wraps it; anything it doesn't spend comes back) */
export async function buy(wallet: WalletLike, client: ReadClient, p: BuyParams): Promise<BuyResult> {
  if (p.usdcIn <= 0n) throw new Error('usdcIn must be more than 0');
  const account = accountOf(wallet);
  noRecipient(p.recipient, account.address);
  const minTokensOut = p.minTokensOut ?? less(nonZero(await quoteBuy(client, p), 'this buy would get no tokens'), p.slippageBps);
  const deadline = p.deadline ?? defaultDeadline();
  const data = [
    swapCall(PAD_V2.wusdc, p.token, account.address, p.usdcIn, minTokensOut, deadline),
    encodeFunctionData({ abi: swapRouterAbi, functionName: 'refundETH' }),
  ];
  const { hash, receipt } = await sendCall(wallet, client, {
    address: PAD_V2.swapRouter, abi: swapRouterAbi, functionName: 'multicall', args: [data], value: p.usdcIn,
  });
  const t = moved(receipt, p.token, account.address);
  const wrapped = sum(parseEventLogs({ abi: erc20Events, eventName: 'Deposit', logs: receipt.logs })
    .filter((e) => sameAddress(e.address, PAD_V2.wusdc) && sameAddress(e.args.dst, PAD_V2.swapRouter)).map((e) => e.args.wad));
  return { hash, receipt, appFee: 0n, promoter: null, promoterReward: 0n, tokensOut: t.in, usdcIn: wrapped || p.usdcIn, minTokensOut };
}

/** The token amounts that moved in a receipt: to and from `who` */
function moved(receipt: TransactionReceipt, token: Address, who: Address): { in: bigint; out: bigint } {
  const ts = parseEventLogs({ abi: erc20Events, eventName: 'Transfer', logs: receipt.logs }).filter((e) => sameAddress(e.address, token));
  return {
    in: sum(ts.filter((e) => sameAddress(e.args.to, who)).map((e) => e.args.value)),
    out: sum(ts.filter((e) => sameAddress(e.args.from, who)).map((e) => e.args.value)),
  };
}
const sum = (xs: bigint[]) => xs.reduce((a, x) => a + x, 0n);

const userRejected = (e: unknown): boolean => {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { code?: unknown; name?: unknown };
    if (o.code === 4001 || o.name === 'UserRejectedRequestError') return true;
  }
  return false;
};

/**
 * Sells launch tokens through the SwapRouter for native USDC (or WUSDC). If the router's allowance is short: a signed permit for
 * exactly `amountIn` (VyreToken supports EIP-2612) in the same transaction, or an exact approval sent first when the wallet can't
 * sign one (a smart-contract wallet) or the token refuses it. Never an open-ended approval.
 */
export async function sell(wallet: WalletLike, client: ReadClient, p: SellParams): Promise<SellResult> {
  if (p.amountIn <= 0n) throw new Error('amountIn must be more than 0');
  const account = accountOf(wallet);
  noRecipient(p.recipient, account.address);
  const minUsdcOut = p.minUsdcOut ?? less(nonZero(await quoteSell(client, p), 'the pool would pay nothing for this sale now'), p.slippageBps);
  const deadline = p.deadline ?? defaultDeadline();
  const unwrap = p.unwrap ?? true;
  const data = unwrap
    ? [swapCall(p.token, PAD_V2.wusdc, PAD_V2.swapRouter, p.amountIn, minUsdcOut, deadline),
      encodeFunctionData({ abi: swapRouterAbi, functionName: 'unwrapWETH9', args: [minUsdcOut, account.address] })]
    : [swapCall(p.token, PAD_V2.wusdc, account.address, p.amountIn, minUsdcOut, deadline)];
  const sale: Sale = (before = []) => ({ address: PAD_V2.swapRouter, abi: swapRouterAbi, functionName: 'multicall', args: [[...before, ...data]] });

  let approval: SellResult['approval'] = 'allowance';
  let approvalHash: Hash | undefined;
  let sent: { hash: Hash; receipt: TransactionReceipt } | null = null;
  const allowance = await readContract(client, { address: p.token, abi: vyreTokenAbi, functionName: 'allowance', args: [account.address, PAD_V2.swapRouter] });
  if (allowance >= p.amountIn) {
    sent = await sendCall(wallet, client, sale());
  } else {
    if (p.permit !== false && !isSmart(wallet)) {
      sent = await sellWithPermit(wallet, client, account.address, p, deadline, sale);
      if (sent) approval = 'permit';
    }
    if (!sent) {
      // an approval for exactly this sale, mined before the sale is simulated (the simulation needs it)
      const approved = await sendCall(wallet, client, { address: p.token, abi: vyreTokenAbi, functionName: 'approve', args: [PAD_V2.swapRouter, p.amountIn] });
      approval = 'approve';
      approvalHash = approved.hash;
      sent = await sendCall(wallet, client, sale());
    }
  }
  const t = moved(sent.receipt, p.token, account.address);
  const paid = unwrap
    ? sum(parseEventLogs({ abi: erc20Events, eventName: 'Withdrawal', logs: sent.receipt.logs })
      .filter((e) => sameAddress(e.address, PAD_V2.wusdc) && sameAddress(e.args.src, PAD_V2.swapRouter)).map((e) => e.args.wad))
    : moved(sent.receipt, PAD_V2.wusdc, account.address).in;
  return {
    hash: sent.hash, receipt: sent.receipt, appFee: 0n, promoter: null, promoterReward: 0n, usdcOut: paid, tokensIn: t.out, minUsdcOut, approval,
    ...(approvalHash ? { approvalHash } : {}),
  };
}

/** Signs a permit for exactly the sale and sells with it in one transaction; null when the permit can't be used (the caller approves instead) */
async function sellWithPermit(
  wallet: WalletLike, client: ReadClient, owner: Address, p: SellParams, deadline: bigint,
  sale: Sale,
): Promise<{ hash: Hash; receipt: TransactionReceipt } | null> {
  const [name, nonce, chainId] = await Promise.all([
    readContract(client, { address: p.token, abi: vyreTokenAbi, functionName: 'name' }),
    readContract(client, { address: p.token, abi: vyreTokenAbi, functionName: 'nonces', args: [owner] }),
    client.chain ? Promise.resolve(client.chain.id) : getChainId(client),
  ]);
  let signature: Hex;
  try {
    // VyreToken's permit domain: OpenZeppelin's ERC20Permit(name), version "1"
    signature = await signTypedData(wallet, {
      account: wallet.account!,
      domain: { name, version: '1', chainId, verifyingContract: p.token },
      types: { Permit: [
        { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      ] },
      primaryType: 'Permit',
      message: { owner, spender: PAD_V2.swapRouter, value: p.amountIn, nonce, deadline },
    });
  } catch (err) {
    if (userRejected(err)) throw err;
    return null;
  }
  let sig;
  try { sig = parseSignature(signature); } catch { return null; }
  const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
  const permit = encodeFunctionData({ abi: swapRouterAbi, functionName: 'selfPermitIfNecessary', args: [p.token, p.amountIn, deadline, v, sig.r, sig.s] });
  try {
    await simulateContract(client, { account: wallet.account!, ...sale([permit]) });
  } catch (err) {
    // Was it the permit? Tried on its own: if the token takes it, the sale failed for another reason (the price moved past the
    // minimum, say) and an approval wouldn't help
    const permitWorks = await simulateContract(client, {
      account: wallet.account!, address: p.token, abi: vyreTokenAbi, functionName: 'permit',
      args: [owner, PAD_V2.swapRouter, p.amountIn, deadline, v, sig.r, sig.s],
    }).then(() => true, () => false);
    if (permitWorks) throw err;
    return null;
  }
  return sendCall(wallet, client, sale([permit]));
}

// ---------------------------------------------------------------------------------------------------------------
// Tax wallets
// ---------------------------------------------------------------------------------------------------------------

/**
 * The contracts of the launchpad's deployment that a launch's tax must never be sent to, lower-cased: the pad, the factory, the
 * pool deployer, the SwapRouter (anyone can take what is sent to it), QuoterV2, TickLens and WUSDC. (A launch's own pool and token,
 * every other launch's, and the chain's Multicall3 are added by the caller; the pad itself refuses the existing pools and tokens.)
 */
export const padV2Contracts = (): Address[] => [PAD_V2.pad, PAD_V2.poolFactory, PAD_V2.poolDeployer, PAD_V2.swapRouter, PAD_V2.quoter, PAD_V2.tickLens, PAD_V2.wusdc];

/**
 * Whether each address is some launch's pool or token on the new pad (read from the pad): tax sent there could never move again.
 * Returns the addresses that are. A read that fails throws, so a save is not allowed on a guess.
 */
export async function launchContractsAmong(client: ReadClient, addrs: readonly string[]): Promise<Address[]> {
  const hits: Address[] = [];
  for (const a of addrs) {
    if (!isAddress(a, { strict: false })) continue;
    const [[pool], tokenOfIt] = await Promise.all([
      readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'launches', args: [a] }),
      readContract(client, { address: PAD_V2.pad, abi: padV2Abi, functionName: 'tokenOfPool', args: [a] }),
    ]);
    if (pool !== zeroAddress || tokenOfIt !== zeroAddress) hits.push(getAddress(a));
  }
  return hits;
}
