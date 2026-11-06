# MINTA in Google Play Console: step by step

For a browser extension (or a person) that drives Play Console. Plain steps, in order. Every text and answer below is the one the repository already holds:
the listing texts are the files in this folder, and the long reasons are in `docs/ANDROID.md`. Where this file and Play Console's own wording differ, read
Play's words first and follow the meaning.

## Rules that never bend

1. **Never type a password, a key, a keystore, a seed phrase or a one-time code.** If Google asks to sign in, to confirm identity or to type a code, stop and tell the owner.
2. **Stop and ask the owner** (do not guess, do not tick the safer-looking box) at: any payment or fee, any legal question (licences, entity, tax, "are you a regulated entity", country law), any question about
   a government ID or business registration, any form that says MINTA needs a licence, any country list, any "I agree" box that is not listed here, and anything this file does not cover.
3. Answer every form truthfully with the facts below. If a question does not fit, stop and ask.
4. Do not publish to Production. Stop after the release is saved and sent for review only if the owner has said so in the same session; otherwise stop at "ready to send".
5. Do not upload anything except the files named here. Do not edit the app's code from Play Console.

## 0. Facts to have open

- App name: `MINTA`. Package name: `com.vyrechain.minta`. Version name `1.0.0`, version code `1` (first upload).
- Website: `https://minta.vyrechain.com`. Privacy policy: `https://minta.vyrechain.com/privacy/`. Terms: `https://minta.vyrechain.com/terms/`.
- Contact on the pages: MINTA on Telegram `https://t.me/+HDa2YpR0piA3ZWE0` and X `@MintaLaunchpad`. **No email address is published.** Play requires a contact email for the store listing: the
  owner gives it (OWNER DECISION). If it is a new address, the owner also adds it to the Terms and privacy contact lines (a pull request in the repository); do not enter one that is not given.
- The app is a Trusted Web Activity: it opens the site full screen. It has no ads, no billing, no accounts, no permissions a user is asked for, no native code. Wallets connect with WalletConnect (the wallet app signs every transaction); MINTA never holds funds or keys.
- Texts: `store/android/short-description.txt`, `store/android/full-description.txt`, picture descriptions `store/android/alt-text.txt`.
- The signed release file (`app-release.aab`) is made by the repository's "Android release" workflow and handed over by the owner. It is never rebuilt or signed here.

## 1. Create the app

Play Console, All apps, Create app.

- App name: `MINTA`
- Default language: English (United States)
- App or game: **App**
- Free or paid: **Free**
- Declarations: read each one; tick the Developer Program Policies and US export laws declarations only if the owner has said to. They are legal statements: **ask the owner** before ticking.

## 2. Store listing (Grow, Store presence, Main store listing)

- App name: `MINTA`
- Short description (copy the file's single line exactly): `Launch and trade tokens on VYRE. Connect your wallet app with WalletConnect.`
- Full description: paste the whole of `store/android/full-description.txt` unchanged.
- App icon: `store/android/icon-512.png` (512 x 512).
- Feature graphic: `store/android/feature-graphic.jpg` (1024 x 500).
- Category: **Finance**. Tags: only if Play insists; choose nothing about trading performance or earning.
- Contact details: Website `https://minta.vyrechain.com`; Email: the address the owner gives (OWNER DECISION, see section 0); Phone: leave empty unless the owner gives one.
- Do not add a promotional video.

### Graphics, in this order (each set has exactly four; the number in the file name is the order)

Upload in the order of the file names. After each upload, the alt text for it is the line for that file in `store/android/alt-text.txt` (Play's "alt text" box, if the Console shows one).

| Play section | Folder | Order |
|---|---|---|
| Phone screenshots | `store/android/phone/` | `01-docs-launch-model.jpg`, `02-report.jpg`, `03-agents.jpg`, `04-terms.jpg` |
| 7-inch tablet screenshots | `store/android/tablet-7in/` | `01-docs-sdk-narrow.jpg`, `02-agents.jpg`, `03-privacy.jpg`, `04-terms.jpg` |
| 10-inch tablet screenshots | `store/android/tablet-10in/` | `01-docs-faq.jpg`, `02-agents.jpg`, `03-privacy.jpg`, `04-terms.jpg` |
| Chromebook screenshots (large screens) | `store/android/desktop/` | `01-docs-faq.jpg`, `02-agents.jpg`, `03-privacy.jpg`, `04-terms.jpg` |

Do not upload any other picture. None of them shows a price, a fee split, a wallet address of a person or a token picture.

Save the listing. If Play warns about a picture size or ratio, stop and tell the owner which file: do not resize or edit it.

## 3. App content (Policy and programs, App content)

Open each item and answer exactly as below. Save each one.

1. **Privacy policy:** `https://minta.vyrechain.com/privacy/`
2. **Ads:** No, the app does not contain ads.
3. **App access:** "All or some functionality is restricted". Instructions for reviewers (paste): *Browsing and reading are open to everyone and need no sign-in. Launching and trading need a crypto wallet app: users tap Connect Wallet, choose WalletConnect and approve in their own wallet app (or open minta.vyrechain.com in their wallet app's browser). No login or test account is needed to review the app; the app can be reviewed without connecting a wallet.* Do not enter any username or password.
4. **Target audience and content:** target age group **18 and over only**. Tick no younger group. "Appeals to children": **No**.
5. **Content rating (questionnaire):** category "All other app types" (not a game, not social, not news). Answer truthfully: no violence, no sexual content, no profanity, no controlled substances, no gambling (MINTA has no chance game and no draw), no location sharing. Users can interact or share content (token names, pictures and descriptions are made by the people who launch tokens): **Yes**. Digital purchases of crypto or tokens with real money: **Yes** where the questionnaire asks about users buying crypto or digital goods. Expect an adult rating. If any question needs a legal judgement, stop and ask.
6. **News app:** No. **Government app:** No. **Health app / health features:** No. **COVID-19 contact tracing or status app:** No.
7. **Advertising ID:** the app does not use it (No).
8. **Data safety:** section 4 below.
9. **Account deletion:** the app has no accounts of its own (email sign-in is switched off on the mainnet app): "No, the app does not let users create an account". If Play still asks for a link, give `https://minta.vyrechain.com/privacy/#delete`.
10. **Financial features declaration (STOP AND READ BEFORE ANSWERING).** Open the form and read every option and every follow-up question as Play shows it.
    - MINTA is non-custodial: it never holds funds or keys, and Google's own policy text says non-custodial wallets are out of scope of the exchange and software-wallet rules. Do **not** tick "Cryptocurrency exchange" or "Cryptocurrency wallet" unless the owner decides MINTA is one.
    - Tick "Tokenized digital asset" sales, trading or awards (the NFT or tokenized-asset option) only if Play offers it and it describes launching and trading tokens.
    - If any option or follow-up asks for a **licence, a registration, a regulator, a country, "do you hold a licence", or a legal entity answer**: **stop and ask the owner**. Do not answer yes to a licence MINTA does not hold; do not tick "none of the above" if it would be untrue.
    - If Play sends the app to country forms that ask for an exchange licence, stop: removing those countries from targeting (section 5) is the owner's decision.
11. Any other declaration that appears (for example "Health Connect", "Photo and video permissions", "Foreground service", "Government"): the app uses none of these. If a form cannot be answered with "not applicable", stop and ask.

## 4. Data safety (App content, Data safety)

The principle: say Yes to sharing wherever MINTA cannot be sure a recipient acts only as its own service provider (over-declaring is safe, under-declaring is not). MINTA has no server of its own; its pages call services run by others, and each call carries the visitor's IP address.

First screens:

- Does the app collect or share any required user data types? **Yes**.
- Is all of the user data collected by your app encrypted in transit? **Yes** (HTTPS and secure WebSocket everywhere).
- Do you provide a way for users to request that their data is deleted? **Yes**. Link: `https://minta.vyrechain.com/privacy/#delete`.
- Data is not sold. There are no ads.

Who sees what (the privacy page, section 2, says the same; every host below must be named in any free-text box Play offers, and none may be left out):

| Recipient (host) | What it receives | When |
|---|---|---|
| Vercel (the site's host) | IP address and browser | every page load |
| `rpc.vyrechain.com` (the network's public RPC) | IP address; wallet address when a balance is read | browsing, trading, balances |
| `explorer.vyrechain.com` (the network's explorer) | IP address; the tokens shown | holder counts and times on pages |
| `api.vyrechain.com` (picture service and transaction check) | IP address; for a launch the picture, description and links; for a transaction, the wallet address, destination, call data and USDC amount just before signing | launching, and before every transaction is signed |
| GoPlus (address security, asked by the check service) | the addresses in a transaction other than the user's own, and the check service's server address (never the user's IP or address) | before signing |
| `rpc.mainnet.arc.io` (Arc's public RPC) | IP address and wallet address | balance and withdrawal status on the Wallet page |
| `ipfs.io` (public IPFS gateway) and any `https` host a token's creator chose | IP address | when a token's details (description and links) load from an `ipfs://` link or that host |
| `link.trustwallet.com` (Trust Wallet) | IP address; for the WalletConnect link, the pairing address | only if the user presses "Open in Trust Wallet" or "Open Trust Wallet" |
| `relay.walletconnect.org` (WalletConnect relay, run by Reown) | IP address, MINTA's WalletConnect project ID, the pairing and MINTA's web address, and the encrypted messages between the page and the wallet app | when the user connects with WalletConnect, and again on later visits while a saved connection exists |
| `verify.walletconnect.org` (WalletConnect verification, a hidden frame the library opens at each connect or sign request) | IP address, MINTA's project ID and MINTA's web address | when the user connects or signs with WalletConnect |

Notes for the free-text boxes: fonts are served from MINTA's own site (no font service sees the visitor); usage reporting of the WalletConnect library is switched off; the library also lists `verify.walletconnect.com` as an alternative address of the verification service, which MINTA does not choose and which the page's security policy does not allow as a frame. Email sign-in is off on mainnet, so no email address is collected.

Data types (tick these, no others). For each: Collected **Yes**; Shared **Yes**; processed ephemerally **No**; collection is **optional** where stated; purposes as stated.

| Play data type | Why | Optional | Purposes |
|---|---|---|---|
| Device or other IDs, or Approximate location (whichever category Play lists an IP address under) | the IP address every request carries | No (any web request has one) | App functionality; Fraud prevention, security, and compliance (rate limits) |
| Financial info, Other financial info (or User IDs): the wallet address | sent to the RPCs and the check service; with WalletConnect the wallet app gives it to the page | Yes (only to look at one's own wallet or to trade) | App functionality; Fraud prevention, security, and compliance |
| Financial info, Other financial info: transaction details | the destination, call data and USDC amount go to the check service just before signing | Yes (only when the user is about to sign) | Fraud prevention, security, and compliance |
| Photos and videos, Photos | a picture the creator picks for a token (public on the token's page) | Yes | App functionality |
| App activity, Other user-generated content | a token's description and links (public on the token's page) | Yes | App functionality |

The category an IP address or a wallet address belongs to is the owner's call if Play's wording is unclear: stop and ask rather than leave the type unticked. If Play offers a service-provider exemption for Vercel, the owner decides whether to use it (default: do not use it, declare as shared).

Save, then review the summary Play generates. It must show data shared, none sold, encrypted in transit, deletion available. Submit.

## 5. Countries and regions (Release, Production, Countries/regions) — OWNER DECISION

**Do not choose countries.** The owner decides where the first release is available. Stop here and ask: "Which countries should the first release be available in?" Reasons for care: Google's cryptocurrency policy lists licence rules by country for exchanges and software wallets, and the owner's licence position is the owner's to state. Enter exactly the list the owner gives. If Play later asks for licence documents for a listed country, stop and ask.

## 6. Release (Test and release)

1. **App signing / App integrity:** when asked, accept **Play App Signing** with the "Google-generated key" (the default). Do not upload or paste any key. The owner's upload key stays only with the owner and the repository's release workflow.
2. **Internal testing first:** Test and release, Testing, Internal testing, Create new release. Upload `app-release.aab` (version code 1, version name 1.0.0). Release name: `1.0.0`. Release notes: `First release.`
3. **Testers:** add only the email addresses the owner gives (a list). Save, review, roll out. Send the opt-in link to the owner.
4. **Closed testing / Production:** whether Play asks for a closed test first (12 testers for 14 days) depends on the account; read the Dashboard. Do not start a closed test or Production without the owner's go-ahead. At "Send for review", stop unless the owner has said to send.
5. Anything Play asks about developer verification, identity, D-U-N-S, organisation documents or fees: stop and ask.

## 7. After the first upload: the Digital Asset Links fingerprint

Until this is done the installed app shows a browser bar at the top.

1. Play Console, Test and release, **App integrity** (in some Consoles: Protected with Play, Manage Play app signing). Under **App signing key certificate**, copy the **SHA-256 certificate fingerprint**: 32 pairs like `AA:BB:CC:…`. If Play lists more than one (upload key and signing key), copy each separately and say which is which.
2. Give the fingerprint(s) to the owner. **Do not paste them anywhere public.** The owner (or a coding session) puts them into `public/.well-known/assetlinks.json` in the repository through a pull request:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.vyrechain.minta",
       "sha256_cert_fingerprints": ["AA:BB:CC:…the fingerprint…"]
     }
   }]
   ```

   The file is empty (`[]`) until then, on purpose: the release workflow refuses to build a non-first release while it has no fingerprint. Merging the pull request makes the site publish it at `https://minta.vyrechain.com/.well-known/assetlinks.json`.
3. Check it: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://minta.vyrechain.com&relation=delegate_permission/common.handle_all_urls` must list the fingerprint. Then reinstall the app from Play: the browser bar is gone.

## 8. Stop-and-ask list (summary)

Stop and ask the owner at: the contact email; the declarations in section 1; the Financial features declaration whenever it mentions a licence, regulator, country or legal status; the content-rating questions that need a judgement; the category an IP address or a wallet address falls under when Play's wording is unclear; the country list; any fee or payment; identity, organisation or D-U-N-S verification; sending the release for review; Production; and anything not written here. Never enter a password, a key, a keystore or a code.
