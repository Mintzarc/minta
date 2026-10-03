# Running MINTA: what it depends on, and the steps when things change

This file is for the people who run MINTA. It says what the app calls, what to do when it gets its own domain or moves to another
network, and what is still unfinished. It holds no keys and no secrets, and none should ever be added.

## 1. When MINTA gets its own domain

1. Create the hosting project from this repository (Vercel: framework Vite, settings in `vercel.json`) and attach the domain.
2. Build with `VITE_SITE_URL=https://<the domain>` (or rely on Vercel's production domain) so the link-preview image has an
   absolute address. Check one link in a chat app.
3. Open the live site and walk through: the home page and splash, a token page, Create (the wizard, a picture upload), the Wallet
   page (Get test USDC, with a wallet that hasn't had any today), the docs, `/terms/`, `/privacy/`.
4. **The services MINTA calls only answer pages they know.** Picture upload, card checkout links and email sign-in are served by the
   app API (`api.vyrechain.com` unless you set `VITE_API_URL`), which accepts requests from a list of page addresses. Ask whoever
   operates that API to add your domain, or host your own (section 2) and point `VITE_API_URL` at it. Card checkout also returns the
   buyer to a fixed address and is registered with the card provider per domain: both are set up with the API's operator. The same
   goes for the check before signing (section 2): until the API lists your domain, the check gets no answer and stays silent.
   The faucet behind the Wallet page's Get test USDC (`testnet-rpc.vyrechain.com/faucet`) is a separate service and also answers a
   browser only from the pages it knows: ask its operator to add your domain too, or every Get test USDC on your domain is refused
   ("not from another website") while it works on the faucet's own page.
   The Wallet page shows the card checkout only on the test network unless the build sets `VITE_CARD_TOPUP` (README); on any
   other network leave it off until a live checkout has been tested for your domain, and keep the terms and privacy pages in step.
5. Promoter links: MINTA remembers a promoter from `?ref=<code or wallet address>` in the address, and shows each approved
   promoter their own link in the Wallet page.

## 2. What MINTA calls but doesn't own

- The network (VYRE Testnet) and its contracts (`VyrePad`, `VyreFeeSplitter`, `VyreAppRouter`, `VyreReferrals`, ...), the public RPC, the
  explorer, the faucet and the promoter sign-up and lookup. Their addresses are in the README and, for the contracts, inside the SDK.
- **Pictures** are uploaded to the API's `POST /image` and served from its `/i/` path. To host them yourself you need a small service
  with the same contract (a still PNG, JPEG or WebP up to 400 KB, 16 to 1,024 px, structure-checked, stored by hash and served as an
  image only), plus the legal side: a takedown contact and a designated agent for copyright notices. Then build with `VITE_API_URL`
  pointing at it. The terms and privacy pages say where pictures live today; change them if that changes. **The app draws only those
  pictures** (`<VITE_API_URL>/i/<sha256>.<webp|png|jpg>`, `shownPicture` in `src/lib/picture.ts`): a picture link to any other site or
  to IPFS is never drawn (the token's mascot is), because such a file can be any size and a small one can decode to gigabytes in every
  visitor's browser. A replacement service must keep the 1,024 px limit for the same reason.
- **The check before signing** (`src/lib/txcheck.ts`, `src/components/TxCheckDialog.tsx`): before a browser wallet is asked to send a
  transaction on VYRE, `walletOn` (`src/lib/chain.ts`) runs it past the API's `POST /txcheck`, which simulates it on the network
  without sending it and looks up the addresses in it with a third-party security service. It is advisory and fails open: it waits at
  most 800 ms, and any error, timeout, busy answer or empty answer lets the transaction go on without a word (an answer whose simulation didn't run still shows a flagged address, which doesn't depend on it, and nothing else). Only
  when the answer carries flags (an unlimited approval, an approval to a contract that isn't one of the launchpad's own, a flagged
  address, or a transaction that would fail) does a dialog open before the wallet's prompt, with Continue anyway and Cancel; its words
  are MINTA's own and nothing from the service's text is shown. It checks VYRE transactions sent from a browser wallet only: not Arc, not contract creations or call data over 24 KB. Point `VITE_API_URL` at your own service with the
  same route to move it, or take `txcheck.ts` out of `walletOn` to turn it off. The privacy page and the FAQ say what it sends. Not
  covered: Face ID wallets (parked, section 5), which send through a bundler rather than the wallet's own provider, and the email
  wallet's sends (off until its provider signs for VYRE): if either returns, check the built transaction first. At the move to the
  main network the check follows the app's own VYRE chain (`walletOn` passes it), and the service has to answer the new site (ask its
  operator to allow your domain).
- **The services' host names.** The RPC and the explorer come with the SDK's definition of the network, and the app API's address
  (`API_URL` in `src/lib/api.ts`) is the SDK's record of the test network's API unless the build sets `VITE_API_URL`. If the
  network's services move to other host names (another network taking over the current ones, say) while MINTA stays on the test
  network, vendor the SDK release that carries the new names, and publish a build with it, before the old names point anywhere
  else: until then the pages would send pictures, launch files and the check before signing, and open explorer links, at whatever
  answers at the old names. Then change by hand what doesn't come from the SDK: the promoter service's address
  (`VITE_PROMOTERS_URL`, or its default in `src/lib/api.ts`) and the hosts the terms and privacy pages name
  (`public/terms/index.html`, `public/privacy/index.html`). A test keeps every other page free of written-out host names.
- **Fees:** the 1% platform fee and the promoters' share are set in the launchpad contracts and paid by the fee splitter contract.
  A launchpad fee on top (0 to 1% per side) is named by the launch itself: any launch can name a partner address and its fee, with
  no registration or approval, and the fee splitter pays that address its part in USDC. The partner can move where its part is paid
  (`offerPartnerPayout` from the address paid now, then `acceptPartnerPayout` from the new one). MINTA names no partner today. The
  app shows every fee before a trade is confirmed.

## 3. Pages to complete before anything but test money

`public/terms/` and `public/privacy/` are drafts for the test network. They say honestly that the operator's name, a contact
address and the governing law are **not yet published**, and they must be completed (and read by a lawyer) before MINTA is offered
with real money. The in-app Docs (`src/pages/Docs.tsx`) carry no contact address for the same reason.

## 4. Another network

Not live today. MINTA is built for the test network, and much of what it says and offers belongs to that network, so moving it is a
change to the code and the words, not a setting. In order:

1. **An SDK release** that carries the new network's definition and addresses (the launchpad's contracts, the outbox for moves out,
   the networks USDC can come from), vendored in `vendor/` as today.
2. **The network itself, chosen in one place:** `VYRE_CHAIN` and `ARC_CHAIN` in `src/lib/chain.ts`. Every other file reads them from
   there: the launchpad's addresses (`addresses()` in `src/lib/market.ts`, used by the trade button, Create, Manage, the tax split's
   list of refused addresses and the docs' contract table), the network a wallet is switched to before a send, the Arc side of
   deposits, moves out and claims, the explorers, and the check before signing. A test keeps it that way: no other file names the
   SDK's test networks (`src/lib/txcheck.ts` keeps the test network's id only as a fallback for its own unit tests; the app always
   passes its own). The SDK sends trades and launches to its own records for the client's network, so these must be the same
   network: if they weren't, a trade that went through could read as "only the approval" and be offered again, and Manage's changes
   would go to an address with no contract. Check one buy, one sell and one Manage change on the new network before anyone else uses it.
3. **The other addresses:** the RPC and the explorer come with the network's definition; set the app API (`VITE_API_URL`), the
   promoter service (`VITE_PROMOTERS_URL`: its default in `src/lib/api.ts` is the test network's) and the site's own address
   (`VITE_SITE_URL`).
4. **What only the test network has**, taken out or switched off: the faucet (the Wallet page's Get test USDC and its status, and the
   Faucet link in the network menu), the card checkout (`src/lib/features.ts`: off on any other network unless the build sets it;
   leave it off until a live checkout has been tested for your domain), and the test networks USDC can come from (`CCTP_SOURCES`,
   used by `src/lib/pending.ts`, `src/components/ui.tsx` and `src/pages/Wallet.tsx`).
5. **What's stored in the browser** belongs to one network: the launch being sent (`vyre.launch`), transactions whose result is still
   being checked (`minta.held.*`), transfers on their way (`vyre.fromChain.pending`) and the Face ID wallet's records (parked,
   section 5). Give those keys the network's name, or clear them, so nothing from the test network is read as the new one's.
6. **The words.** These files say "testnet", "test USDC", "no real money", "VYRE Testnet" or "chain 7357", or offer the faucet, and
   each must be rewritten for real money: `src/App.tsx` (the footer and the network menu), `src/components/Ticker.tsx`,
   `src/components/ui.tsx` (the wallet menu, the connect menu's help link, the email wallet's note), `src/pages/Docs.tsx`,
   `src/pages/Explore.tsx` (the milestone note), `src/pages/Launch.tsx` (the review's network, the note about a reset),
   `src/pages/Wallet.tsx`, `index.html`, `public/manifest.webmanifest`, `public/terms/index.html` and `public/privacy/index.html`
   (which must be completed before real money anyway, section 3). A test fails for any file with such words that isn't named here.
   Search the new build for those words before it is published.
7. **The launch milestone:** the "graduated" line is $100 of USDC bought in on the testnet (`MILESTONE` in `src/lib/stats.ts`); pick
   the figure for real money. The launchpad contract requires every launch to open at a $3,000 market cap on a new deployment; the
   testnet's older contract still takes any value, so the app and SDK enforce $3,000 there.
8. **A fresh review of everything that moves money,** then the walk-through in section 1 on the new network, with a small amount.

## 5. Face ID wallets are parked

Sign-in with a passkey (Face ID) exists in the code (`src/lib/faceid.ts`, the SDK, a bundler service) but is **switched off**
(`FACE_ID_OFFERED = false`): a card purchase can't be delivered to a smart-contract wallet, so a Face ID wallet's "no app" promise
stops at an empty wallet. Passkeys are bound to the address of the page that made them, so wallets made at another address during
testing can't sign in on this one. Bringing it back needs the flag, a card route that reaches smart wallets, a claimer service for
moving USDC out, and a decision about the passkeys' domain.

## 6. The pictures here

- Logo: `brand/logo-source.jpg`, cut by `brand/logo/make-assets.py` into `public/brand/`, the icons and the link preview.
- Mascots for tokens with no picture: 50 pictures in `public/memes/` (`m01.webp` to `m50.webp`); each token picks one from its address (`src/lib/memes.ts`).
- Art for the docs and Create pages: `public/art/`.
- Splash films: `src/lib/films.ts` lists them (`public/splash/`: H.264, silent, about 1.2 MB each, with a poster), cut by
  `brand/splash/make-assets.sh` from source films that are not in the repository. With more than one, they take turns, one each time the
  splash plays. It plays on the home page once every six hours, can always be skipped, and stands down by itself (reduced motion,
  Data Saver, autoplay refused, a film that doesn't start). `/?splash` plays it on demand.

## 7. Review status

Reviewed in internal rounds (no critical or high findings open; the medium findings found were fixed and tested). **No outside
audit.** The browser check (`npm run test:browser`) covers the wizard's messages, the docs, the ticker, the check before signing, picture
preparation, the splash and the wallet menu; the on-chain behaviour (launch, buy, sell) was checked by hand against the test network.
