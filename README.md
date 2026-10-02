# MINTA

Launch, trade and explore tokens on [VYRE](https://vyrechain.com), the people's layer. **Testnet:** test USDC, no real money.

MINTA is a launchpad app: a static website (React, Vite, TypeScript, [viem](https://viem.sh)) with no server of its own.
Anyone launches a token with one transaction, trades it with USDC, and watches launches, trades and a live ticker. Creators pick
their supply, taxes and picture; liquidity is locked by the contracts. MINTA is its own project: it uses the network's contracts
and public services the way any other app on it can.

## Run it

```bash
npm ci               # exactly what package-lock.json says; no install scripts run (.npmrc)
npm run dev          # http://localhost:5173
npm run build        # typecheck, then the site into dist/
npm run typecheck && npm test
npm run test:browser # a real-browser check of the wizard, docs, ticker, splash, the check before signing; needs `npx playwright install chromium`
```

Node 22 or newer. Routes live after a `#` (`/#/token/0x…`), so any static host works with no rewrite rules.

## Configure (all optional)

Set these when building (`VITE_…` values are public: they end up in the page):

| Variable | What | Default |
|---|---|---|
| `VITE_SITE_URL` | the site's own address, for the link-preview image (`https://example.com`, no slash at the end). On Vercel its production domain is used when this isn't set | none: the preview image address stays relative |
| `VITE_API_URL` | the app API: picture upload, token details files, card checkout links, email sign-in | `https://api.vyrechain.com` |
| `VITE_PROMOTERS_URL` | the promoter-code lookup | `https://testnet-rpc.vyrechain.com/promoters` |
| `VITE_CARD_TOPUP` | `1` shows the card checkout on the Wallet page, `0` hides it. Turn it on for a network other than the testnet only once a live checkout works for your site | shown on the test network only |

## What it depends on

| What | Where | For |
|---|---|---|
| VYRE Testnet (chain ID 7357) | `https://testnet-rpc.vyrechain.com` | every read and every transaction |
| The contracts (launchpad, fee splitter, app router, …) | addresses and ABIs inside the SDK | launching, trading, promoters |
| `@vyrechain/sdk` | `vendor/vyrechain-sdk-0.5.0.tgz` | chain definition, addresses, typed calls |
| The VYRE app API | `https://api.vyrechain.com` | token pictures (`POST /image`), details files, card checkout links, email sign-in, and the advisory check before a wallet signs (`POST /txcheck`) |
| The explorer | `https://explorer.vyrechain.com` | links, holder counts, the block at a given time (called from the visitor’s browser) |
| The faucet | `https://vyrechain.com/faucet` | test USDC |
| Circle, Transak | their own services | email sign-in; card purchases of USDC (testnet staging) |

Each endpoint can be pointed elsewhere at build time (the `VITE_…` settings above). `docs/HANDOFF.md` says what to do when MINTA
gets a domain of its own or moves to another network.

**The SDK is vendored** so the build doesn't depend on another site being up. To update it, take the new
`vyrechain-sdk-<version>.tgz` from <https://vyrechain.com/sdk/>, put it in `vendor/`, record its SHA-256 in
`vendor/SHA256SUMS` (`cd vendor && sha256sum *.tgz > SHA256SUMS`; remove the old file first), change the path in
`package.json`, run `npm install`, then the tests (`test/vendor.test.mjs` checks that the file, its recorded hash and the
lockfile agree). A new SDK always comes as a new version: never replace a vendored file with different contents under the same name. The SDK carries the contract addresses: after VYRE redeploys its contracts,
MINTA needs the SDK released after that.

## Layout

```
src/pages/        Explore, Token, Launch (a five-step wizard), Manage, Portfolio, Wallet, Docs (MINTA's in-app docs)
src/components/   header, ticker, splash, token art, search, charts, shared UI
src/lib/          chain and wallet plumbing, the app API client, the check before signing, the ticker's feed, picture preparation, routes
public/           the logo, art, meme mascots for tokens with no picture, the splash film, manifest, terms and privacy pages
brand/            tools that make those pictures (logo cuts, mascots, art, splash); see each folder
test/             unit tests (node --test) and a browser check (Playwright)
vercel.json       the page's security headers (a strict content security policy) and the build settings
```

## Hosting

Any static host. On Vercel: import the repository (framework Vite; `vercel.json` has the settings), then add your domain.
Keep the headers in `vercel.json` wherever you host: the page runs no inline script, and the policy is part of what keeps a
visitor's wallet safe from a script injected from elsewhere.

## Status

Testnet only. MINTA has had internal review rounds, **no outside security audit**. It shows no token, price or number it can't
read from the chain, and doesn't promise returns. Not built on purpose: staking or any token rewards (there is no MINTA
token), "fair launch" rounds (launches here are instant), a whitepaper.

## Licence

Code: MIT (`LICENSE`). The logo, wordmark, mascots, art and splash film are not covered by it.
