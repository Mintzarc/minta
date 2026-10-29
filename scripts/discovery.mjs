// MINTA's pages for search engines and AI assistants (public/llms.txt, public/llms-full.txt, public/agents/index.html), written from
// the facts the app itself runs on, so they cannot drift from it:
//   - the launchpad contracts and the platform wallet: src/lib/padv2.ts (PAD_V2, PAD_V2_LIMITS, PLATFORM_SHARE_BPS, POOL_FEE_KEY)
//   - the chain, its public hosts, WUSDC and Multicall3: the vendored SDK's mainnet record (@vyrechain/sdk)
//   - the SDK package the docs tell builders to install: SDK_FILE in src/pages/Docs.tsx
// Not run by the build: run `npm run discovery` after changing any of those and commit the result. test/discovery.test.mjs renders
// the same pages again and fails when a committed file is out of date.
//   node scripts/discovery.mjs          write the files
//   node scripts/discovery.mjs --check  list the files that are out of date (exit 1)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getAddresses, vyreMainnet, arcMainnet } from '@vyrechain/sdk';
import { docsSdkFile } from './check-published.mjs';

const ROOT = new URL('..', import.meta.url);
export const SITE = 'https://minta.vyrechain.com';
export const CONTACT = { telegram: 'https://t.me/+HDa2YpR0piA3ZWE0', x: 'https://x.com/MintaLaunchpad', xHandle: '@MintaLaunchpad' };
export const ADD_TO_WALLET = 'https://vyrechain.com/add/';
export const REFERENCE_CODE = 'https://github.com/Mintzarc/minta/blob/main/src/lib/padv2.ts';

// the calls an assistant needs, in the contracts' own signature text (test/discovery.test.mjs holds each to the app's ABI)
export const SIGNATURES = {
  pad: [
    'function launchesOpen() view returns (bool)',
    'function launchCount() view returns (uint256)',
    'function tokens(uint256 index) view returns (address)',
    'function launches(address token) view returns (address pool, uint16 buyTaxBps, uint16 sellTaxBps, int24 tickLower, int24 tickUpper, address creator, uint64 createdAt)',
    'function createLaunch((string name, string symbol, uint256 totalSupply, uint256 startingMarketCap, uint16 buyTaxBps, uint16 sellTaxBps, string metadataURI) p) payable returns (address token, address pool, uint256 bought)',
    'function collectCreatorFees(address token) returns (uint256 amount)',
    'function lowerTaxes(address token, uint16 buyTaxBps, uint16 sellTaxBps)',
    'event LaunchCreated(address indexed token, address indexed creator, address indexed pool, string name, string symbol, uint16 buyTaxBps, uint16 sellTaxBps, uint256 openingMarketCap, uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper)',
  ],
  router: [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
    'function refundETH() payable',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  ],
  quoter: [
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  ],
  token: ['function approve(address spender, uint256 value) returns (bool)'],
};

/** Every fact the pages state, read from the app and the SDK */
export async function loadFacts() {
  const P = await import('../src/lib/padv2.ts');
  const sdk = getAddresses(3045);
  const sdkFile = docsSdkFile(fs.readFileSync(new URL('src/pages/Docs.tsx', ROOT), 'utf8'));
  const L = P.PAD_V2_LIMITS;
  return {
    chainId: vyreMainnet.id,
    chainName: vyreMainnet.name,
    rpc: vyreMainnet.rpcUrls.default.http[0],
    explorer: vyreMainnet.blockExplorers.default.url,
    api: 'https://api.vyrechain.com',
    multicall3: vyreMainnet.contracts.multicall3.address,
    parentChainId: arcMainnet.id,
    wusdc: sdk.wusdc,
    nativeDecimals: vyreMainnet.nativeCurrency.decimals,
    pad: P.PAD_V2.pad, swapRouter: P.PAD_V2.swapRouter, quoter: P.PAD_V2.quoter, poolFactory: P.PAD_V2.poolFactory,
    poolDeployer: P.PAD_V2.poolDeployer, tickLens: P.PAD_V2.tickLens, platformWallet: P.PAD_V2.platformWallet,
    poolFeeKey: P.POOL_FEE_KEY, slippageBps: P.DEFAULT_SLIPPAGE_BPS, deadlineSeconds: P.DEFAULT_DEADLINE_SECONDS,
    platformShareBps: P.PLATFORM_SHARE_BPS,
    minTaxPct: L.minTaxBps / 100, maxTaxPct: L.maxTaxBps / 100, minTaxBps: L.minTaxBps, maxTaxBps: L.maxTaxBps,
    maxNameBytes: L.maxNameBytes, maxSymbolBytes: L.maxSymbolBytes, maxMetadataBytes: L.maxMetadataBytes, maxTaxWallets: L.maxTaxWallets,
    minSupplyWhole: (L.minSupply / 10n ** 18n).toLocaleString('en-US'), maxSupplyWhole: (L.maxSupply / 10n ** 18n).toLocaleString('en-US'),
    openingMarketCapUsdc: (L.openingMarketCap / 10n ** 18n).toLocaleString('en-US'),
    sdkInstall: `npm install ${sdkFile.url} viem`,
  };
}

const tenth = (f) => `${f.platformShareBps / 100}%`;

function llms(f) {
  return `# MINTA

> MINTA is a launchpad app on VYRE mainnet (chain ID ${f.chainId}): anyone can launch a token in one transaction, trade it with USDC and explore launches. Gas and trading are in USDC. MINTA is a website; it holds no funds and has no accounts. You sign every transaction in your own wallet.

Site: ${SITE}
Fuller version of this file, with the contract calls: ${SITE}/llms-full.txt
For people: ${SITE}/agents/

## Live facts

- Network: ${f.chainName} mainnet, chain ID ${f.chainId}, mainnet is live. Gas is USDC (the chain's native currency, ${f.nativeDecimals} decimals).
- RPC: ${f.rpc}
- Explorer: ${f.explorer}
- Add the network to a wallet: ${ADD_TO_WALLET}
- Moving USDC between VYRE and Arc (chain ${f.parentChainId}): a withdrawal to Arc takes about a day.
- Contracts (VyrePadV2, the launchpad): ${f.pad}. Trades go through the Uniswap v3 SwapRouter at ${f.swapRouter} (quoter ${f.quoter}). Full list in llms-full.txt.

## Launch and trade, in plain steps

1. Add VYRE to a wallet and put USDC in it (${ADD_TO_WALLET}).
2. To launch: choose a name, ticker, supply, and a creator tax from ${f.minTaxPct}% to ${f.maxTaxPct}% for buys and for sells. One transaction creates the token and its pool. An optional first buy can ride in the same transaction.
3. To trade: buy or sell a token with USDC at ${SITE}, or through the contracts directly (llms-full.txt).
4. The creator collects the tax whenever they like and can split it between up to ${f.maxTaxWallets} wallets.

## The fee rule

- The creator's tax is the only fee a trader pays. The creator sets it at launch, from ${f.minTaxPct}% to ${f.maxTaxPct}% per side (buy and sell separately), in USDC.
- A creator can lower the tax later, never raise it, and never below ${f.minTaxPct}%.
- When the tax is paid out, the platform takes a tenth of it (${tenth(f)}, to ${f.platformWallet}) and the creator's tax wallets get the rest.
- No other fee is added to a trade. Every transaction also pays the network fee, in USDC.
- Example: a 1,000 USDC trade with a 5% tax pays 50 USDC of tax; paid out, 5 USDC goes to the platform wallet and 45 USDC to the creator's tax wallets.

## Using MINTA from an AI assistant or a script

- The assistant prepares a transaction (target contract, call data, USDC value); the user checks it and signs it in their own wallet. Never ask a user for a private key or seed phrase, and never accept one.
- Prepare it with viem and the contract calls in llms-full.txt. Install: ${f.sdkInstall}. The SDK supplies the chain definition (vyreMainnet) and USDC helpers; use the contract addresses on this page, not the SDK's older launchpad entries.
- Read before writing: check launchesOpen() on the launchpad, simulate the call, show the user the amounts, and set a spend limit.
- Token pages are hash routes (${SITE}/#/token/<token address>) that need JavaScript; to read a launch use the contracts or the explorer.

## Risks

- USDC on VYRE mainnet is real money. Tokens can fall to zero. Transactions cannot be reversed, and a failed transaction still costs its network fee.

## Links

- Terms: ${SITE}/terms/
- Privacy: ${SITE}/privacy/
- Docs: ${SITE}/#/docs
- Support: MINTA on Telegram ${CONTACT.telegram} or on X ${CONTACT.xHandle} (${CONTACT.x})
`;
}

function llmsFull(f) {
  const lines = (a) => a.map((s) => `  ${s}`).join('\n');
  return `# MINTA: full reference for AI assistants and scripts

MINTA (${SITE}) is a launchpad app on VYRE mainnet (chain ID ${f.chainId}). This file has what an assistant needs to prepare a launch, a buy, a sell or a tax collection without MINTA's pages. The short version is ${SITE}/llms.txt.

## Rules for an assistant (read first)

1. You prepare; the user signs. Produce a transaction request (to, data, value, chainId) and let the user's own wallet sign it.
2. Never ask for, accept, store or print a private key or seed phrase. If a user pastes one, tell them to stop and treat that wallet as unsafe.
3. Everything here is real money on mainnet. Say so before every write. Show the user the contract, the function, the USDC amount and the minimum they will receive, and wait for a clear yes.
4. Simulate (eth_call) before presenting a transaction. Do not present one that fails the simulation.
5. Use a spend limit: confirm a maximum per transaction with the user and refuse to go above it.
6. Do not promise returns, prices or outcomes.

## Network

- Name: ${f.chainName} mainnet. Chain ID: ${f.chainId}. Native currency: USDC, ${f.nativeDecimals} decimals (so 1 USDC is 10^${f.nativeDecimals} units; gas is paid in it).
- RPC: ${f.rpc}
- Explorer: ${f.explorer}
- App API (token pictures, the check before signing): ${f.api}
- Add to a wallet: ${ADD_TO_WALLET}
- Parent chain: Arc (chain ID ${f.parentChainId}). Deposits start there; a withdrawal to Arc takes about a day.

## Contracts (chain ${f.chainId})

| Name | Address |
|---|---|
| VyrePadV2 (launchpad) | ${f.pad} |
| Uniswap v3 SwapRouter | ${f.swapRouter} |
| QuoterV2 | ${f.quoter} |
| Pool factory | ${f.poolFactory} |
| Pool deployer | ${f.poolDeployer} |
| TickLens | ${f.tickLens} |
| WUSDC (wrapped native USDC) | ${f.wusdc} |
| Multicall3 | ${f.multicall3} |
| Platform wallet (a wallet, not a contract) | ${f.platformWallet} |

Source of these addresses: MINTA's own code (${REFERENCE_CODE}: PAD_V2) and the SDK's mainnet record (chain, hosts, WUSDC, Multicall3). The SDK's older launchpad entries (pad, appRouter, feeSplitter) belong to the first launchpad, which mainnet launches no longer use: do not send launches or trades there.

## Launch rules (VyrePadV2)

- Name 1 to ${f.maxNameBytes} bytes, symbol 1 to ${f.maxSymbolBytes} bytes.
- totalSupply from ${f.minSupplyWhole} to ${f.maxSupplyWhole} whole tokens, written with 18 decimals.
- startingMarketCap must be exactly ${f.openingMarketCapUsdc} USDC (${f.openingMarketCapUsdc}e18): every launch opens at that market cap.
- buyTaxBps and sellTaxBps: whole numbers from ${f.minTaxBps} to ${f.maxTaxBps} (${f.minTaxPct}% to ${f.maxTaxPct}%), set separately.
- metadataURI: at most ${f.maxMetadataBytes} bytes (the link to the token's picture and details; may be empty).
- No partner fee and no promoter share.
- Transaction value: the optional first buy, in native USDC. The creator's first buy pays the creator's tax like any buy.
- Call launchesOpen() first. If it returns false, launches are closed; do not prepare a launch.

## Fees

- The creator's tax is the only fee a trade pays, in USDC, charged by the token's pool. Buys and sells carry separate taxes.
- Paying out the tax (collectCreatorFees): ${tenth(f)} (a tenth) of the amount goes to the platform wallet ${f.platformWallet}; the rest goes to the creator or the creator's tax wallets (up to ${f.maxTaxWallets}).
- A creator can lower either tax with lowerTaxes, never raise it, and never below ${f.minTaxPct}%.
- Every transaction pays the network fee, in USDC.

## Contract calls (human-readable ABI, usable with viem's parseAbi)

VyrePadV2 at ${f.pad}:
${lines(SIGNATURES.pad)}

Uniswap v3 SwapRouter at ${f.swapRouter}:
${lines(SIGNATURES.router)}

QuoterV2 at ${f.quoter} (call it as a simulation; it is not a view):
${lines(SIGNATURES.quoter)}

A launch token (standard ERC-20, with EIP-2612 permit):
${lines(SIGNATURES.token)}

## Recipes (viem)

Install: ${f.sdkInstall}

\`\`\`js
import { createPublicClient, http, encodeFunctionData, parseAbi } from 'viem';
import { vyreMainnet, parseUsdc } from '@vyrechain/sdk';

const client = createPublicClient({ chain: vyreMainnet, transport: http('${f.rpc}') });
const pad = '${f.pad}';
const router = '${f.swapRouter}';
const quoter = '${f.quoter}';
const wusdc = '${f.wusdc}';
const padAbi = parseAbi([/* the VyrePadV2 lines above */]);
const routerAbi = parseAbi([/* the SwapRouter lines above */]);
const quoterAbi = parseAbi([/* the QuoterV2 line above */]);

// 0. launches must be open
const open = await client.readContract({ address: pad, abi: padAbi, functionName: 'launchesOpen' });
if (!open) throw new Error('launches are closed');
\`\`\`

### Launch (one transaction)

\`\`\`js
const call = {
  to: pad,
  data: encodeFunctionData({
    abi: padAbi, functionName: 'createLaunch',
    args: [{ name: 'Example', symbol: 'EXMPL', totalSupply: 1_000_000_000n * 10n ** 18n,
             startingMarketCap: ${f.openingMarketCapUsdc.replace(/,/g, '')}n * 10n ** 18n, buyTaxBps: ${f.minTaxBps}, sellTaxBps: ${f.minTaxBps}, metadataURI: '' }],
  }),
  value: 0n, // or parseUsdc('5') for a first buy of 5 USDC in the same transaction
  chainId: ${f.chainId},
};
await client.call({ account: userAddress, to: call.to, data: call.data, value: call.value }); // simulate; stop if it throws
// hand \`call\` to the user's wallet to sign. The token and pool are in the LaunchCreated event of the receipt.
\`\`\`

### Buy (USDC in, tokens out)

\`\`\`js
const amountIn = parseUsdc('10');
const { result } = await client.simulateContract({
  address: quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: wusdc, tokenOut: token, amountIn, fee: ${f.poolFeeKey}, sqrtPriceLimitX96: 0n }],
});
const minOut = (result[0] * ${10_000 - f.slippageBps}n) / 10000n; // ${f.slippageBps / 100}% slippage; the quote already includes the creator's tax
const deadline = BigInt(Math.floor(Date.now() / 1000) + ${f.deadlineSeconds}); // ${f.deadlineSeconds / 60} minutes
const call = {
  to: router, chainId: ${f.chainId}, value: amountIn,
  data: encodeFunctionData({ abi: routerAbi, functionName: 'multicall', args: [[
    encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{
      tokenIn: wusdc, tokenOut: token, fee: ${f.poolFeeKey}, recipient: userAddress, deadline, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }),
    encodeFunctionData({ abi: routerAbi, functionName: 'refundETH' }),
  ]] }),
};
\`\`\`

### Sell (tokens in, USDC out)

Approve the router for exactly the amount being sold (never an unlimited approval), as its own transaction the user signs, then:

\`\`\`js
const call = {
  to: router, chainId: ${f.chainId}, value: 0n,
  data: encodeFunctionData({ abi: routerAbi, functionName: 'multicall', args: [[
    encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{
      tokenIn: token, tokenOut: wusdc, fee: ${f.poolFeeKey}, recipient: router, deadline, amountIn: tokensIn, amountOutMinimum: minUsdcOut, sqrtPriceLimitX96: 0n }] }),
    encodeFunctionData({ abi: routerAbi, functionName: 'unwrapWETH9', args: [minUsdcOut, userAddress] }),
  ]] }),
};
// get minUsdcOut from the quoter the same way as in the buy (tokenIn: token, tokenOut: wusdc)
\`\`\`

### Collect a creator's tax

\`\`\`js
const call = { to: pad, chainId: ${f.chainId}, value: 0n, data: encodeFunctionData({ abi: padAbi, functionName: 'collectCreatorFees', args: [token] }) };
\`\`\`

### Read launches

\`launchCount()\`, then \`tokens(i)\` for each index, then \`launches(token)\` for its pool, taxes, creator and creation time. The token's name, symbol and supply are ordinary ERC-20 reads. The explorer at ${f.explorer} shows the same.

## What MINTA's own code does

MINTA's pages run these same calls (${REFERENCE_CODE}), with the checks above. Read it before writing your own.

## Links

- Site: ${SITE}
- For people: ${SITE}/agents/
- Terms: ${SITE}/terms/
- Privacy: ${SITE}/privacy/
- Docs: ${SITE}/#/docs
- Support: MINTA on Telegram ${CONTACT.telegram} or on X ${CONTACT.xHandle} (${CONTACT.x})
`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function agentsPage(f) {
  const prompt = `You are helping me use MINTA, a launchpad app on VYRE mainnet (chain ID ${f.chainId}). Read ${SITE}/llms-full.txt first and follow it.
Rules: you prepare transactions, I sign them in my own wallet. Never ask for or accept my private key or seed phrase. Before every transaction show me the contract, the function, the USDC amount and the minimum I will receive, simulate it, and wait for my yes. Do not go above this spend limit per transaction: ___ USDC.
Task: `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Use MINTA with an AI assistant</title>
  <meta name="description" content="How to launch and trade tokens on MINTA, a launchpad app on VYRE mainnet, with an AI assistant: the assistant prepares the transaction, you sign it in your own wallet.">
  <link rel="canonical" href="${SITE}/agents/">
  <meta name="theme-color" content="#03070b">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="MINTA">
  <meta property="og:title" content="Use MINTA with an AI assistant">
  <meta property="og:description" content="The assistant prepares the transaction, you sign it in your own wallet. Steps and safety rules.">
  <meta property="og:url" content="${SITE}/agents/">
  <meta property="og:image" content="${SITE}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="alternate" type="text/plain" href="${SITE}/llms.txt" title="llms.txt">
  <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/legal.css">
  <style>
    pre { margin: 12px 0 0; padding: 14px; background: #07131a; border: 1px solid var(--line-2); border-radius: 8px; color: var(--soft); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
    .copy { margin-top: 10px; background: var(--lime); color: #03070b; border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-weight: 700; font-size: 14px; cursor: pointer; }
    .copy:hover { filter: brightness(1.1); }
    ol { margin: 10px 0 0; padding-left: 22px; color: var(--soft); font-size: 15px; }
  </style>
</head>
<body>
  <header class="top">
    <div class="top-in">
      <a class="brand" href="/" aria-label="MINTA home"><img src="/brand/minta-wordmark.webp" width="640" height="85" alt="MINTA"></a>
      <nav aria-label="Site">
        <a href="/#/docs">Docs</a>
        <a class="hide-sm" href="/terms/">Terms</a>
        <a class="hide-sm" href="/privacy/">Privacy</a>
      </nav>
    </div>
  </header>

  <main>
    <p class="eyebrow">For AI assistants</p>
    <h1>Use MINTA with an <em>AI assistant</em></h1>
    <p class="lede">MINTA is a launchpad app on VYRE mainnet (chain ID ${f.chainId}). An AI assistant can do the reading and the preparation for you: find a token, work out a launch or a trade, and build the transaction. You check it and sign it in your own wallet. The assistant never holds your keys.</p>

    <section>
      <h2>Safety rules</h2>
      <ul>
        <li><b>The assistant prepares, you sign.</b> Every transaction is signed in your own wallet, after you have read it.</li>
        <li><b>Never paste a private key or seed phrase</b> into a chat, a script or a file an assistant can read. No real step needs one. If you pasted one by mistake, move your funds to a new wallet.</li>
        <li><b>Set a spend limit</b> before you start, and tell the assistant. A limit per transaction is the simplest.</li>
        <li><b>These are real funds.</b> USDC on VYRE mainnet is the real thing. Tokens can fall to zero, and a transaction can’t be reversed. A failed transaction still costs its network fee, in USDC.</li>
        <li><b>Check the numbers</b> the assistant shows you against your wallet’s prompt: the contract, the amount and the minimum you receive.</li>
      </ul>
    </section>

    <section>
      <h2>Steps</h2>
      <ol>
        <li>Add VYRE mainnet to your wallet at <a href="${ADD_TO_WALLET}" target="_blank" rel="noopener noreferrer">vyrechain.com/add</a> and put some USDC in it. Moving USDC back to Arc takes about a day.</li>
        <li>Copy the starter message below, fill in your spend limit and your task, and paste it to your assistant. It points the assistant at <a href="/llms-full.txt">the full reference</a>.</li>
        <li>The assistant replies with a transaction: the contract, the call and the USDC amount. Read it.</li>
        <li>Send it to your wallet and sign it there, or reject it. Nothing moves until you sign.</li>
        <li>Check the result on the <a href="${f.explorer}" target="_blank" rel="noopener noreferrer">explorer</a>.</li>
      </ol>
      <pre id="prompt">${esc(prompt)}</pre>
      <button class="copy" type="button" data-copy="prompt">Copy the starter message</button>
    </section>

    <section>
      <h2>What it can do</h2>
      <ul>
        <li><b>Launch a token:</b> name, ticker, supply, and a creator tax of ${f.minTaxPct}% to ${f.maxTaxPct}% for buys and for sells. One transaction. An optional first buy of your own in the same transaction.</li>
        <li><b>Buy and sell:</b> with USDC, with a minimum amount out so a price move can’t take more than you accepted.</li>
        <li><b>Collect a creator’s tax,</b> or lower it later (never raise it, never below ${f.minTaxPct}%).</li>
        <li><b>Read launches:</b> the launchpad lists every token; the explorer shows the rest.</li>
      </ul>
    </section>

    <section>
      <h2>The fee rule</h2>
      <p>The creator’s tax is the only fee a trader pays. The creator sets it at launch, ${f.minTaxPct}% to ${f.maxTaxPct}% per side, and can lower it later, never raise it. When the tax is paid out, the platform takes a tenth of it and the creator’s tax wallets get the rest. No other fee is added; every transaction also pays the network fee, in USDC.</p>
      <p>Example: a 1,000 USDC trade with a 5% tax pays 50 USDC of tax; paid out, 5 USDC goes to the platform wallet and 45 USDC to the creator’s tax wallets.</p>
    </section>

    <section>
      <h2>For developers</h2>
      <p>Network: ${esc(f.chainName)} mainnet, chain ID ${f.chainId}, gas in USDC. RPC <code>${f.rpc}</code>, explorer <code>${f.explorer}</code>. Launchpad (VyrePadV2) <code>${f.pad}</code>. Install the SDK with <code>${esc(f.sdkInstall)}</code>. Machine-readable versions of this page: <a href="/llms.txt">llms.txt</a> and <a href="/llms-full.txt">llms-full.txt</a>, which have every contract address and the exact calls.</p>
    </section>

    <section>
      <h2>Help</h2>
      <p>Questions and reports go to MINTA on Telegram (<a href="${CONTACT.telegram}" target="_blank" rel="noopener noreferrer">the MINTA group</a>) or on X (<a href="${CONTACT.x}" target="_blank" rel="noopener noreferrer">${CONTACT.xHandle}</a>).</p>
    </section>
  </main>

  <footer>
    <p>MINTA runs on VYRE Mainnet: USDC and tokens here are real funds. USDC is issued by Circle; MINTA is not affiliated with or endorsed by Circle.</p>
    <p><a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a> · <a href="/#/docs">Docs</a></p>
  </footer>
  <script src="/agents/copy.js"></script>
</body>
</html>
`;
}

/** { path under public/: contents } */
export async function render() {
  const f = await loadFacts();
  return { 'public/llms.txt': llms(f), 'public/llms-full.txt': llmsFull(f), 'public/agents/index.html': agentsPage(f) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = await render();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([p, text]) => !fs.existsSync(new URL(p, ROOT)) || fs.readFileSync(new URL(p, ROOT), 'utf8') !== text).map(([p]) => p);
    if (stale.length) { console.error(`out of date (run npm run discovery): ${stale.join(', ')}`); process.exit(1); }
    console.log('discovery files are current');
  } else {
    for (const [p, text] of Object.entries(files)) {
      fs.mkdirSync(new URL('.', new URL(p, ROOT)), { recursive: true });
      fs.writeFileSync(new URL(p, ROOT), text);
      console.log(`wrote ${p}`);
    }
  }
}
