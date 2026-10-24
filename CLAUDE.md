# CLAUDE.md — MINTA mainnet / chain 3045 deploy briefing

This file is for a future Claude (or human) session that will plan or execute deploying **MINTA** to mainnet. Read it before changing chain config or vendoring an SDK.

## What MINTA is

- **Package / product:** `minta` — the launchpad front end (static React + Vite + TypeScript + viem).
- **Not** a nested “LaunchPad” module: the whole repo *is* MINTA.
- **Entry:** `src/main.tsx` → `App.tsx`. Routes are hash-based (`/#/token/0x…`).
- **Depends on:** `@vyrechain/sdk` (vendored tarball in `vendor/`), VYRE RPC/explorer/API, optional Circle email wallet SDK.

## Current state vs target

| | Today | Target |
|---|---|---|
| Network | **VYRE Testnet** | Mainnet |
| Chain ID | **7357** (`vyreTestnet` in SDK) | **3045** |
| Config | `VYRE_CHAIN = vyreTestnet`, `ARC_CHAIN = arcTestnet` in `src/lib/chain.ts` | Switch only after an SDK that defines 3045 |
| Money | Test USDC, faucet available | Real USDC; no faucet |

**Do not** set `VYRE_CHAIN` / `ARC_CHAIN` to 3045, vendor a new SDK, or deploy until the hard blocker below is cleared.

## Three-pass audit summary (completed, audit-only)

1. **Pass 1 — health + hardcoding**  
   `npm run typecheck`, `npm test` (142 pass / 1 skip then), `npm run build` clean. Network selection centralized in `src/lib/chain.ts`. Hardcoding scan: app and vendored SDK only know **7357**; **3045 appears nowhere** as a chain id.

2. **Pass 2 — money paths + browser**  
   Deep read of Launch / Token / Manage / Wallet (slippage, exact approvals, held txs, deposits). `npm run test:browser` **all passed**.

3. **Pass 3 — cross-check**  
   SECURITY.md: no outside audit. SDK exports `registerNetwork` / `registerDeployment` for teaching a new chain when a record exists. **CCTP is Sepolia-sandbox only** (`iris-api-sandbox.circle.com`, Sepolia source chains) in SDK 0.5.6.

## Hard blocker

**Vendored `@vyrechain/sdk@0.5.6` only knows chain 7357.**  
`getAddresses(3045)` throws. `mainnet.generated.js` is empty (“the SDK knows the testnet alone”). Until an SDK release (or `registerNetwork` record) defines **3045** (addresses, RPC, explorer, API, Arc/CCTP parent, Face ID if used), the app **cannot** point at mainnet safely.

## HANDOFF checklist (authoritative)

Full operator runbook: **`docs/HANDOFF.md`**, especially **§4 Another network**. Order of work there:

1. SDK with new network → vendor in `vendor/` + lockfile  
2. Flip `VYRE_CHAIN` / `ARC_CHAIN` in `src/lib/chain.ts` only  
3. Env: `VITE_API_URL`, `VITE_PROMOTERS_URL`, `VITE_SITE_URL`  
4. Domain allowlists (API, faucet if any, txcheck, card return URL)  
5. Faucet / card / CCTP sources  
6. Browser storage (now chain-scoped — see below)  
7. Copy / terms / privacy  
8. Milestone figure  
9. Fresh money-path review + small live walk-through  

## Already prepared in-repo (3045-prep, no chain switch)

Done without switching chains or vendoring a new SDK:

- **Faucet gated:** `FAUCET_OFFERED` in `src/lib/network.ts` (false when `VYRE_CHAIN.testnet` is false). Wallet card + App faucet links respect it.
- **Card top-up gated for live:** `LIVE_CARD_TOPUP_READY = false` in `src/lib/features.ts`. Non-testnet needs both that flag **and** `VITE_CARD_TOPUP=1`.
- **Copy chain-aware:** `src/lib/network.ts` (`IS_TESTNET`, `VYRE_NAME`, `USDC_LABEL`, …) drives App / Wallet / Docs / Ticker / Explore; static terms/privacy/manifest/index softened for a later mainnet legal pass.
- **Storage namespaced by chain id:** `storeKey(base, chainId)` in `src/lib/storeKey.ts` — keys like `vyre.launch:7357`, `minta.held:7357.*`, pending/moves/email/faceid/wallet/splash/ref.
- **Milestone revisited:** `MILESTONE_TESTNET = 100`, `MILESTONE_MAINNET = 10_000` in `src/lib/stats.ts` (confirm product figure before publish).

## Full fix list (priorities)

### Blockers (need 3045 SDK / ops)

1. **SDK defining chain 3045** (deployment, RPC, explorer, API, rollup/Arc parent, CCTP mainnet sources) → vendor + `npm` lock  
2. Set **`VYRE_CHAIN` / `ARC_CHAIN`** in `src/lib/chain.ts` (and only there)  
3. Env: **`VITE_API_URL`**, **`VITE_PROMOTERS_URL`**, **`VITE_SITE_URL`**  
4. **Domain allowlists** on API / txcheck / promoters / (if used) faucet & Transak return URLs  

### Required before real money

5. Confirm faucet stays off (already gated)  
6. Complete **`public/terms/`** and **`public/privacy/`** (operator, contact, governing law) — lawyer review  
7. Confirm chain-scoped storage OK after switch (or clear legacy unscoped keys if any remain in the wild)  
8. Confirm **`MILESTONE_MAINNET`** with product  
9. Re-test buy / sell / Manage / deposit / CCTP on 3045 with small size  

### Known gaps (not fixed by flipping the chain)

10. **Tx-check fails open** (≤800 ms, silent on error) — intentional; revisit for mainnet risk  
11. **Face ID parked** (`FACE_ID_OFFERED = false`, ~400 lines in `src/lib/faceid.ts`, still in bundle)  
12. **Email wallet can’t trade on VYRE** until Circle supports the chain id (`EMAIL_TRADE_NOTE`)  
13. **Feed / stats** client-side log scans — fine at testnet scale; mainnet needs an indexer  
14. **No outside security audit** (SECURITY.md / HANDOFF §7)  
15. **`npm audit`:** ~15 issues / ~8 high — mostly Circle SDK → firebase/undici and vite tooling; Firebase app/auth are shimmed out of Apple sign-in  

### Optional / polish

- Tighten CSP `connect-src` in `vercel.json`  
- Code-split large main chunk  
- Flip `LIVE_CARD_TOPUP_READY` only after live Transak tested for the production domain  

## Session constraints (this prep work)

- Audit completed in three passes; prep changes above are allowed.  
- **Still forbidden until SDK exists:** switching `VYRE_CHAIN`/`ARC_CHAIN` to 3045, vendoring a fake/empty 3045 SDK, deploying to production mainnet.  
- Prefer HANDOFF §4 order over inventing a parallel migration path.

## Useful commands

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:browser   # needs Playwright Chromium
npm run check:published
```

## Key files

| Path | Role |
|---|---|
| `src/lib/chain.ts` | **Only** place to choose VYRE/Arc chains |
| `src/lib/network.ts` | Testnet flags + display copy helpers |
| `src/lib/storeKey.ts` | Chain-scoped storage key helper |
| `src/lib/features.ts` | Card top-up gating / `LIVE_CARD_TOPUP_READY` |
| `src/lib/stats.ts` | `MILESTONE_*` |
| `src/lib/api.ts` | `VITE_API_URL` / promoters default |
| `docs/HANDOFF.md` | Operator checklist |
| `vendor/vyrechain-sdk-*.tgz` | Vendored SDK |
| `vercel.json` | CSP + static hosting |
