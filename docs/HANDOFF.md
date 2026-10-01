# Running MINTA: what it depends on, and the steps when things change

This file is for the people who run MINTA. It says what the app calls, what to do when it gets its own domain or moves to another
network, and what is still unfinished. It holds no keys and no secrets, and none should ever be added.

## 1. When MINTA gets its own domain

1. Create the hosting project from this repository (Vercel: framework Vite, settings in `vercel.json`) and attach the domain.
2. Build with `VITE_SITE_URL=https://<the domain>` (or rely on Vercel's production domain) so the link-preview image has an
   absolute address. Check one link in a chat app.
3. Open the live site and walk through: the home page and splash, a token page, Create (the wizard, a picture upload), the Wallet
   page, the docs, `/terms/`, `/privacy/`.
4. **The services MINTA calls only answer pages they know.** Picture upload, card checkout links and email sign-in are served by the
   app API (`api.vyrechain.com` unless you set `VITE_API_URL`), which accepts requests from a list of page addresses. Ask whoever
   operates that API to add your domain, or host your own (section 2) and point `VITE_API_URL` at it. Card checkout also returns the
   buyer to a fixed address and is registered with the card provider per domain: both are set up with the API's operator.
5. Promoter links: MINTA remembers a promoter from `?ref=<code or wallet address>` in the address, and shows each approved
   promoter their own link in the Wallet page.

## 2. What MINTA calls but doesn't own

- The network (VYRE Testnet) and its contracts (`VyrePad`, `VyreFeeSplitter`, `VyreAppRouter`, `VyreReferrals`, ...), the public RPC, the
  explorer, the faucet and the promoter sign-up and lookup. Their addresses are in the README and, for the contracts, inside the SDK.
- **Pictures** are uploaded to the API's `POST /image` and served from its `/i/` path. To host them yourself you need a small service
  with the same contract (a still PNG, JPEG or WebP up to 400 KB, 16 to 1,024 px, structure-checked, stored by hash and served as an
  image only), plus the legal side: a takedown contact and a designated agent for copyright notices. Then build with `VITE_API_URL`
  pointing at it. The terms and privacy pages say where pictures live today; change them if that changes.
- **Fees:** the 1% platform fee and the promoters' share are set in the launchpad contracts and paid by the fee splitter contract.
  A launchpad fee on top (0 to 1%) is possible for a partner launchpad registered with the splitter, which the contracts' owner does.
  The app shows every fee before a trade is confirmed.

## 3. Pages to complete before anything but test money

`public/terms/` and `public/privacy/` are drafts for the test network. They say honestly that the operator's name, a contact
address and the governing law are **not yet published**, and they must be completed (and read by a lawyer) before MINTA is offered
with real money. The in-app Docs (`src/pages/Docs.tsx`) carry no contact address for the same reason.

## 4. Another network

Not live today. When there is one, MINTA needs: an SDK release that carries that network's definition and addresses, the chain switch
in `src/lib/chain.ts`, its RPC, explorer and API addresses (and `VITE_API_URL` if the API differs), a decision on the launch
milestone (the "graduated" line is $100 of USDC bought in on the testnet; about $10,000 was suggested for real money), and a fresh
review of everything that moves money. The launchpad contract requires every launch to open at a $3,000 market cap on a new
deployment; the testnet's older contract still takes any value, so the app and SDK enforce $3,000 there.

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
audit.** The browser check (`npm run test:browser`) covers the wizard's messages, the docs, the ticker, picture
preparation, the splash and the wallet menu; the on-chain behaviour (launch, buy, sell) was checked by hand against the test network.
