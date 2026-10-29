# MINTA on Google Play: the owner's guide

MINTA's Android app is a thin wrapper (a Trusted Web Activity) that opens https://minta.vyrechain.com full screen, with no browser bar once
Google has confirmed the app and the site belong together. The package name is `com.vyrechain.minta`. Nothing here needs a Mac or Android Studio:
the app is built on GitHub (Linux) and you only use a browser, GitHub and Play Console.

What is in the app (the facts the tests check):

- package `com.vyrechain.minta`, target API 36 (Android 16), minimum API 24 (Android 7.0), `versionCode 1`, version name `1.0.0`
- no permissions a user is asked for (the Android library adds one internal, unexported one), no native code (so it is 64-bit ready), no ads, no billing
- the store pictures and texts are in `store/android/` (made from the real site by `store/android/make-screenshots.mjs`)
- **what the app does today: browse, read and report.** It cannot connect a wallet (Part 3), so launching and trading happen in a wallet app's own browser. Every line of the listing says so.

## Part 1: what you do, in order

### 0. Merge `android` into `main` and let Vercel deploy it first

Do this before anything else, and before the Play review. Reasons: (1) the privacy policy link you give Play, the Report, Hide and Terms features, the
blocklist and the Digital Asset Links file are all part of the website, and Google's reviewers and users see the website as it is on
`https://minta.vyrechain.com`, not this branch; (2) the release key may only be used by builds from `main` (step 2), so the Android folder must be on
`main` before a release can be built. Merge the pull request that holds this branch into `main` (tap Merge on GitHub), wait for Vercel's deploy to turn
green, then check that `https://minta.vyrechain.com/blocklist.json` and `https://minta.vyrechain.com/privacy/#delete` open.


### 1. Make the upload key (once, on any computer)

The upload key proves that your builds come from you. Google keeps the real signing key (Play App Signing), so if you lose the upload key
Google can reset it. You still keep it safe: never put it in GitHub's files, chat or email.

You need `keytool`, which comes with a Java JDK (version 17 or newer; the build itself uses 17). If you have none: on Windows run
`winget install EclipseAdoptium.Temurin.17.JDK` in PowerShell, then **close that PowerShell window and open a new one** (the old one does not know the new program
yet). Or use a GitHub Codespace on this repository (Code, Codespaces): it is a Linux terminal in your browser and already has Java. A Codespace is deleted
after a while, so download `minta-upload.keystore` from its file list (right-click, Download) and keep it safely before you delete the Codespace; never
leave the only copy there.

```
keytool -genkeypair -v -keystore minta-upload.keystore -alias minta-upload -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password twice (use a long one, write it down in your password manager), then your name and organisation (any honest answers;
they are not shown to users). Press Enter at "key password" to use the same password. Keep `minta-upload.keystore` and the password in two
safe places (a password manager and an offline copy). Do not commit it: the repository's `.gitignore` already refuses `*keystore*`.

Then turn the file into one line of text:

- Linux or Codespaces: `base64 -w0 minta-upload.keystore`
- Mac Terminal: `base64 -i minta-upload.keystore`
- Windows PowerShell (run it in the folder that holds the file): `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path minta-upload.keystore)))`. To copy the result straight to the clipboard add ` | Set-Clipboard`.

Copy that whole line (it is long). It is the only form in which the key goes to GitHub.

### 2. Make the `android-release` environment and put the four secrets in it

GitHub, repository Mintzarc/minta, Settings, Environments, "New environment", name it exactly `android-release`. In it:

- Deployment branches and tags: "Selected branches and tags", add **`main` only** (nothing else may use the key; this is why step 0 comes first).
- Optional but wise: "Required reviewers", add yourself, so every release run waits for your tap.
- **Plan note:** on a **private** repository GitHub only enforces an environment's branch rule and required reviewers on a paid plan (Pro, Team or Enterprise); on a **public** repository both are free. On a private repository without a paid plan the environment still holds the secrets, but anyone who can run workflows on a branch could use them: in that case keep write access to the repository to people you trust, and make the repository public or upgrade before the first release.
- Environment secrets, "Add environment secret", exactly these four:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the long line from step 1 |
| `ANDROID_KEYSTORE_PASSWORD` | the password you typed |
| `ANDROID_KEY_ALIAS` | `minta-upload` |
| `ANDROID_KEY_PASSWORD` | the same password (the key password) |

Nobody can read a secret back once it is saved, and the workflow never prints them. To change one, save it again. Put them in the environment, not in the repository's own secrets, so only the release job on `main` can read them.

### 3. Build the release bundle

GitHub, Actions, "Android release", Run workflow. Choose `main`. Fill `version_code` (1 for the first upload;
every later upload needs a higher whole number) and `version_name` (for example `1.0.0`). Tick `first_upload` only for the very first upload: the release
refuses to build while `public/.well-known/assetlinks.json` has no fingerprint, and the fingerprint only exists after that first upload (step 9). When the run is green (about 5 minutes), open it and
download the artifact **minta-release-aab** (a zip with `app-release.aab` inside). Unzip it.

If it fails with "A repository secret is missing", step 2 is incomplete (the secrets must be in the `android-release` environment). If it fails at signing, the password or alias is wrong.

To test on a phone before Play: Actions, "Android debug", Run workflow, download **minta-debug-apk**, and install it on an Android phone (allow
installs from your browser or files app). It works, but it shows a browser bar at the top: that is expected for a build Google has not
signed yet (see step 9).

### 4. Create the app in Play Console

Play Console, Create app. App name `MINTA`, default language English (United States), "App", "Free" (the app itself costs nothing; MINTA takes no
payments through Play), and tick the declarations.
Whether Play first asks for a closed test depends on the account: see Part 2, point 1.

### 5. App content (Policy and programs, App content). Answers to give

- **Privacy policy:** `https://minta.vyrechain.com/privacy/`
- **Ads:** No, the app does not contain ads.
- **App access:** answer that some functionality is restricted, and say: "Browsing and reading are open to everyone and need no sign-in. Launching and trading need a crypto wallet, which this app cannot connect: users do those in their wallet app's own browser at minta.vyrechain.com. No login or test account is needed to review the app."
- **Target audience and content:** only "18 and over". Do not tick any younger group. The app does not appeal to children (see the note on the gecko picture in Part 2).
- **Content rating:** the questionnaire is multiple choice and asks you to be truthful. Expected answers: category "All other app types"; no violence, no sexual content, no profanity, no controlled substances; no gambling (MINTA has no chance game: Trader Rewards and any draw are not in the app); users can interact and share content (token names, pictures and descriptions made by users); no location sharing; digital purchases of crypto or tokens: answer yes where it asks about users buying crypto or digital goods with real money. Expect a rating for adults (18+).
- **News app:** No. **Government app:** No. **Health:** No.
- **Financial features declaration:** read the options as Play shows them. MINTA is non-custodial (it never holds funds or keys), which Google's policy says is out of scope of the cryptocurrency exchange and software wallet rules. Do not tick "Cryptocurrency exchange" or "Cryptocurrency wallet" unless you decide MINTA is one. Tick "Tokenized digital asset (NFT) sales, trading, and awards" if it is offered and describes launching and trading tokens. Answer every custody and licence question truthfully. If Play routes you to country forms asking for an exchange licence, remove those countries from the targeting instead of claiming a licence you do not hold (Part 2, point 2).
- **Data safety:** below.
- **Account deletion:** MINTA has no accounts of its own, and the mainnet app offers no email sign-in (it is switched off there), so answer that the app does not let users create an account. The privacy page still has a "Deleting your data" section (`https://minta.vyrechain.com/privacy/#delete`) saying what exists and how to clear it; if Play asks for a link anyway, give that one. The page promises that a deletion request written to MINTA's Telegram or X is acted on: the owner must be ready to do that.

#### Data safety form: answers

The principle: say Yes to sharing wherever MINTA is not sure a recipient is only its own service provider, because over-declaring is safe and under-declaring is a violation. MINTA has no server of its own; the pages call services run by others, and each call carries the visitor's IP address. What each recipient receives (the privacy page, section 2, says the same):

| Recipient | Receives |
|---|---|
| Vercel (hosts the pages) | IP address and browser, to serve the files |
| rpc.vyrechain.com, explorer.vyrechain.com, api.vyrechain.com (run by the network's operator) | IP address; wallet address (balances); for a launch, the picture, description and links; for a transaction, the check described below |
| The transaction check (on api.vyrechain.com) | wallet address, destination, call data and USDC amount of a transaction, just before the wallet asks to sign; it asks GoPlus about the other addresses only |
| GoPlus (address security) | the addresses in a transaction other than the user's own, and the check service's server address (never the user's IP or address) |
| rpc.mainnet.arc.io (Arc's public RPC) | IP address and wallet address (balance and withdrawal status on the Wallet page) |
| Where a token's creator chose (for example IPFS) | IP address, when a token's details load from there |
| Trust Wallet (link.trustwallet.com) | IP address, only if the user presses "Open in Trust Wallet" |

Fonts are served from MINTA's own site (no font service sees the visitor). Email sign-in is switched off on mainnet, so the app does not collect email addresses; the Play app is the mainnet one.

Form answers. Is all data encrypted in transit: **Yes** (HTTPS everywhere). Can users request deletion: **Yes** (the privacy page's "Deleting your data"). Data is not sold. No ads.

| Data type | Collected | Shared | Optional | Purposes | Certainty |
|---|---|---|---|---|---|
| Device or other IDs, or Approximate location (whichever Play says an IP address belongs to) | Yes: the IP address every request carries | **Yes**: Vercel, the network's RPC, explorer and API, Arc's RPC, token details hosts | No (any web request has one) | App functionality, Fraud prevention and security (rate limits) | Owner to confirm in Play Console which category Play lists an IP address under |
| Financial info, Other financial info (or User IDs): the wallet address | Yes: sent to the RPC and to Arc's RPC to read balances, and to the transaction check | **Yes**: the network's operator and Arc's public RPC | Yes (only to look at one's own wallet or to trade) | App functionality, Fraud prevention and security | Owner to confirm the category; the wallet address is public on the blockchain |
| Financial info, Other financial info: transaction details | Yes: the destination, call data and USDC amount of a transaction go to the check service just before signing | **Yes**: the network's operator (GoPlus gets the other addresses) | Yes (only when a user is about to sign) | Fraud prevention and security | Owner to confirm. In the Android app no wallet connects, so this arises only when someone uses the same pages elsewhere; declare it because the code is there |
| Photos and videos, Photos | Yes: a picture the creator picks for a token | **Yes**: public on the token's page for anyone | Yes | App functionality | Owner to confirm |
| App activity, Other user-generated content | Yes: a token's description and links | **Yes**: public on the token's page | Yes | App functionality | Owner to confirm |

No other category is collected. If Play's form offers a recipient exemption (service provider) that you judge fits Vercel, keep Vercel's part of the IP row as "not shared" and the rest shared; Google does not check the answers, and you alone are responsible for them (answer/10787469).

### 6. Store listing

Main store listing: app name `MINTA`; short description from `store/android/short-description.txt`; full description from `store/android/full-description.txt`;
icon `store/android/icon-512.png`; feature graphic `store/android/feature-graphic.jpg`; phone screenshots from `store/android/phone/`;
7-inch tablet from `store/android/tablet-7in/`; 10-inch tablet from `store/android/tablet-10in/`; Chromebook / large screen from `store/android/desktop/`.
Category: Finance. Contact: Play requires a public email: use one MINTA's team reads and says so in the Terms. Website `https://minta.vyrechain.com`. The same address can go in `REPORT_EMAIL` in `src/lib/contact.ts` (OWNER TO CONFIRM: it is empty today, so the report panel shows Telegram and X only; set it and the Email link appears with a prefilled subject and message).

The pictures are unmodified clips of real screens (nothing is hidden or drawn on them): the docs pages on fees, on supply and tax, and (tablets and desktop) on the contracts, clipped below the app's top bar and, on wide screens, to the article column; the AI assistants page at its safety rules (phones and 7-inch tablets); the Terms (one text page per set); on phones, a token page cropped to the Report panel and the Hide buttons, with no picture and no price; and, on phones, the page a blocked token shows. **That last one is staged honestly:** the live blocklist is empty, so the capture script serves a `blocklist.json` that names the first token for that one picture (the app and the page are the real ones). No picture shows a token picture, a price or a trade panel: the app cannot trade, and the one token on the chain has cartoon art. The explore list is not used for the same reason. Regenerate any time: `npm ci`, `npx playwright install chromium`, then `node store/android/make-screenshots.mjs` (against the deployed site; before the web part is deployed use a local build, `npm run build`, `npx vite preview --port 4173`, `MINTA_SITE=http://127.0.0.1:4173 node store/android/make-screenshots.mjs`: the pictures in this repository were taken that way). After the deploy in step 0, regenerate them from the live site.

### 7. Upload to Internal testing

Test and release, Testing, Internal testing, Create new release. Accept Play App Signing when asked (leave "Google-generated key"). Upload `app-release.aab`.
Add yourself and your team as testers (a list of email addresses), save, roll out, and open the opt-in link on an Android phone.

### 8. Closed testing, then production

Add a Closed testing track the same way if you need more testers, or go to Production when the Dashboard lets you (Part 2 says what the rule is).
Each review can take days. Answer the review's questions with the facts in `store/android/full-description.txt` and Part 2.

### 9. After the first upload: the Digital Asset Links fingerprint

Until this is done the installed app shows a browser bar at the top. Play Console, Test and release, App integrity (in the current Console it
is under "Protected with Play, Play Store protection, Manage Play app signing"), "App signing key certificate": copy the **SHA-256 certificate fingerprint**
(form `AA:BB:...`, 32 pairs). If Play shows more than one fingerprint (hybrid signing), register each.

Edit `public/.well-known/assetlinks.json` in this repository (GitHub's pencil button works) so it reads:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.vyrechain.minta",
    "sha256_cert_fingerprints": ["AA:BB:CC:...the fingerprint..."]
  }
}]
```

Commit it. The site publishes it at `https://minta.vyrechain.com/.well-known/assetlinks.json` (the repository's `vercel.json` serves it as
`application/json`). Check it with `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://minta.vyrechain.com&relation=delegate_permission/common.handle_all_urls`
and then reinstall the app from Play: the bar is gone. The `test/android.test.mjs` test refuses a malformed fingerprint.

## Part 2: what Google Play's rules say about MINTA (read in October 2026)

Each point is from Google's own pages; "NOT VERIFIED" marks what could not be read there. Page numbers are `support.google.com/googleplay/android-developer/answer/<n>`.

1. **Testing requirement (answer/14151465).** The page says the closed test (at least 12 testers opted in continuously for at least 14 days, then "Apply for production") applies to "personal developer accounts created after November 13, 2023". It does not mention organisation accounts or older accounts, and shows no date. So it reads as applying to new personal accounts only; the Play Console Dashboard is the proof: if it offers production without a closed test, the rule does not apply to the account. If it does apply, run the closed test with 12 real people for 14 days; production cannot be requested directly where the rule applies.
2. **Crypto (answers 13607354, 16329703, 9876821).** Exchanges and software wallets may be published only with the licences listed per country (for example FinCEN plus state registration in the US, a MiCA licence in the EU, the FCA in the UK); "Non-custodial wallets are out of scope"; unlisted countries may publish but must follow local law. Blockchain-based content means "tokenized digital assets secured on a blockchain"; apps that sell or let users earn them must say so in the Financial features declaration, and "You may not promote or glamorize any potential earning from playing or trading activities." Nothing there bans a launchpad. The risk is how Google classes MINTA (exchange or not); the policy pages do not say. Verdict in point 12.
3. **User generated content (answer/9876937).** Apps with UGC need terms users accept, a definition of objectionable content, in-app reporting AND blocking of users and content that is easy to find, and follow-up on reports. **What is built:** terms with section 8 (what tokens may not be) and section 9 (what MINTA may stop showing); an "I accept the Terms" box on the launch wizard's last step and on Manage's picture, description and links save (without it neither goes ahead); on every token page a **Report this token** panel (a message to copy, with links to MINTA's Telegram group and X account, and an Email link once `REPORT_EMAIL` is set); **Hide this token** and **Hide everything from this creator** on each Explore card and token page (kept on the device, with "Show all" on Explore and the Wallet page); and `public/blocklist.json`, a list of token and creator addresses MINTA's team has decided to hide, read by the app at start and applied to Explore, the search, the top list, the ticker along the top (by token and by creator) and token pages, and to the Portfolio rows (a wallet's own Hide choices are not applied to its holdings); nothing of the lists, the ticker or a token page is drawn until the file has been read, for at most 1.5 seconds, so a blocked token is not shown for a moment (if the file fails to load, everything is shown) (a blocked token's page says "MINTA hides this token because it was reported." and has a way back). **Removal path:** the team edits `public/blocklist.json` (schema: `{"version": 1, "tokens": [addresses], "creators": [addresses]}`), merges, and Vercel deploys; the picture service can also delete a picture; the token's record on the chain stays. **Block applies:** the only content shown from other people is a token's name, picture, description and links, and the creator is the only "user" behind it, so Hide everything from this creator is the block (on the device), and the blocklist is MINTA's block for everyone. There are no profiles, messages or comments. **How reports are handled (OWNER TO CONFIRM): reports reach MINTA's team through the channels listed (Telegram, X, and the email address once set); the team may hide a token with the blocklist.** Google lists "Apps that continually fail to address user complaints about objectionable content" as a violation, so the team must read the channels and act. **Honest risk:** Google may still ask for an in-app channel that sends the report to MINTA without leaving the app (Telegram, X and email open outside it). If it does, the answer is option B below, which is designed and not built.
4. **AI-generated content (answer/13985936).** Applies to apps that generate content with AI (chatbots as a core feature, images or video from prompts). MINTA generates none; its AI page only explains how an outside assistant can prepare a transaction. Not in scope.
5. **Deceptive behavior and misrepresentation (answers 17006354, 9888689).** False or misleading claims about what the app does are banned, and the title, icon and description must honestly show what the app does. The app cannot connect a wallet today (Part 3), so it lets people browse, read and report; launching and trading are done in a wallet app's browser. The listing states that in its first lines, its bullets list only what works in the app, and the screenshots show only screens that work in the app (the token page with its trade panel hidden). Do not claim more.
6. **Store listing (answer/9866151).** Screenshots must show the real app, and graphics must not suggest rankings, prices or testimonials; do not use "Best", "#1", "Top", "New", "Free", "Discount". The files in `store/android/` follow this, and `test/android.test.mjs` checks the wording rules and that the pictures do not show screens that cannot work in the app.
7. **Families and children (answer/9893335).** Families rules apply only if children are a target audience. Choose 18 and over only. The page warns that imagery and terminology that could be seen as targeting children can affect Google's assessment, and that a listing must not promote an adults-only app to children. No screenshot and not the feature graphic shows any token picture or mascot: the pictures are docs, terms, privacy, AI-page and report-panel clips, and the feature graphic is MINTA's own brand art. The explore list shows whatever pictures token creators choose (today one cartoon one); that is why it is not in the listing.
8. **Data safety and privacy policy (answer/10787469).** Required even for apps that collect nothing, with a privacy policy link; data from webviews counts. Answers in step 5. Account deletion rules are on answer/13327111 (the deletion link goes in the form if the app has accounts).
9. **Payments (answer/9858738).** Play billing is required for purchases of in-app digital features and virtual currency. The page does not mention crypto or tokenized assets (NOT VERIFIED how Google treats token purchases made from a user's own wallet). MINTA sells nothing itself: users trade tokens with their own wallet on the chain, MINTA takes no payment through the app, and Play billing is not used.
10. **Developer verification (answer/10841920).** Organisation accounts are verified with a government ID, an official organisation document, a D-U-N-S number and website verification; accounts that cannot be verified risk removal and cannot submit apps. Google's separate Android developer verification (registering package names) is described in android-developers.googleblog.com/2026/06/android-developer-verification.html (a second-hand summary only was read): check the Play Console Home page after the first upload.
11. **Target API and 64-bit.** New apps and updates must target Android 16 (API 36) or higher from 31 August 2026 (answer/11926878); this app targets API 36. The 64-bit rule covers native code; this app has none (developer.android.com/google/play/requirements/64-bit). Play App Signing is on for new apps (answer/9842756).
12. **Account standing (answer/9899234).** A rejected app does not affect the account's standing; removals do not immediately, but multiple removals can lead to suspension, and strikes can end in termination of related accounts. Google tells developers to fix violations across the whole catalogue. So do not submit MINTA with anything in this guide unresolved.

13. **Facts the listing states, and where they come from.** "The whole supply goes into the pool as one position that nothing can remove" and "the creator may buy part of the supply in the launch transaction": the launch contract's own description of what it does. Owner to confirm: confirmed against the deployed launch contract, source reviewed by the owner, before the listing goes live; if it cannot be confirmed, delete those sentences from the listing and the site. The fee wording (creator tax 1-10% a side, a tenth to the platform, no other fee) is the Token page's text. "Locked liquidity" is not used on its own anywhere: wherever the site spoke of locked liquidity it now says the precise fact and that this is not a safety guarantee.

**Verdict: go with changes.** Nothing read blocks a non-custodial launchpad outright, and no licence is needed for a non-custodial app by the policy's own wording. Before the first review: answer the Financial features declaration truthfully, keep the listing honest about what the app does today (browse, read and report; launch and trade in a wallet app's browser), act on reports, deploy this branch's web changes first (privacy section, Report and Hide buttons, Terms box, assetlinks file, self-hosted fonts), confirm the Data safety answers in Play Console, and have the Digital Asset Links fingerprint ready for step 9. The part Google may still decide for itself is whether MINTA counts as an exchange; if it does, the countries listed in answer/16329703 need licences you should not claim.

### If Google asks for an in-app channel (option B: designed, not built)

Telegram, X and email open outside the app. If Google's review says reporting must work without leaving the app, build this. It is ready to implement; the server part is not built (it needs a change to MINTA's app service, the one that keeps pictures, as well as to this repository).

1. **The form (this repository).** Under "Report this token" a "Send a report" form: a reason from a list (`illegal`, `hateful`, `copy`, `deceptive`, `other`), an optional note (plain text, at most 500 characters), a Send button. The token and its creator are filled in by the page. Sent with `fetch` to the app service; the answer is shown in words ("Sent. MINTA's team reads reports.", or "Couldn't send just now").
2. **The endpoint (app service).** `POST /report`, JSON `{ "token": "0x…", "reason": "illegal|hateful|copy|deceptive|other", "note": "…" }`, answer `204`; CORS only for `https://minta.vyrechain.com`. The service checks that `token` is a launch it knows, that `reason` is on the list, and cuts `note` at 500 characters. No account, no cookie, no wallet.
3. **Limits.** At most 5 reports per IP address per hour, and 1 per IP address per token per day; at most 200 reports a day in all (more are answered `429`). A body over 2 KB is refused.
4. **Storage.** One row per report: token, creator, reason, note, time, and a hash of the IP address (salted, not the address itself). Kept 180 days, then deleted; readable only by MINTA's team. Nothing is shown publicly.
5. **How the team reads reports.** The service posts each new report to a private channel of the team's (the one used for support), and a daily message lists reports per token with a count and the reasons; a token with 3 or more reports from different addresses is marked. The team opens the token, decides, and either adds the token or its creator to `public/blocklist.json` (merge, Vercel deploys) or closes the report. The reporter is never told who decided.
6. **Privacy and Data safety.** The privacy page gains one row (the report form sends the token, reason, note and a hashed IP address to the app service, kept 180 days) and the Data safety form one line (App activity, Other user-generated content: collected, not shared, optional, App functionality).
7. **Tests when built:** the form posts exactly that body; the service refuses unknown tokens and reasons, long notes, and the 6th report in an hour; the stored row has no raw IP address.

The owner decides whether to build it. Until then the Report panel (Telegram, X, and email once `REPORT_EMAIL` is set) is the report channel, and the Hide buttons and the blocklist are the block.

## Part 3: what works inside the app, and what does not

The app opens the site in Chrome's full-screen mode. Chrome on Android has no extensions and no wallet app can reach into it, and MINTA connects wallets only through the browser (the EIP-6963 way). It has no WalletConnect.

- Works: browsing, charts, token pages, docs, terms and privacy, the AI assistants page, Report this token, Hide this token, sharing links, Android's Back button, the home-screen shortcuts "Explore tokens" and "Read the docs" (the launch wizard walks to its last step but cannot go further without a wallet).
- Does not work in the app: connecting a browser wallet, so no launch or trade from the app. Email sign-in is switched off on mainnet, and an email wallet could not launch or trade there anyway.
- Inside the app (detected from the start address's `?app=1`, or the app as referrer; nothing changes anywhere else) the connect menu, the Launch page, the Buy panel and the Wallet page say: "This app can't connect wallets. Open minta.vyrechain.com in your wallet app's browser." with a Copy link button and an "Open in Trust Wallet" button (Trust Wallet's documented link form `https://link.trustwallet.com/open_url?coin_id=60&url=https://minta.vyrechain.com`). For MetaMask, Coinbase Wallet, Rabby and others the note gives plain instructions only (open the wallet app's browser tab and type the address): no deep link for them is used because their forms were not verified.
- A real fix inside the app is adding WalletConnect to the web app (an outside review is needed); that is not in this branch. A WebView wrapper would have the same wallet limit and is more likely to be called a webview-spam app.
- **A restored or fresh tab loses the app flag.** The app is recognised from the start address (`?app=1`, removed after it is seen) or the app as referrer, and remembered for the visit only. If Android restores a tab from nothing, or a link is opened in a new tab, the wallet note is not shown there. That is accepted: the note is a convenience, and nothing else depends on it. `?app=1` is never an authority: anyone can add it to an address and the only effect is that the wallet note shows (a test checks that nothing else reads the flag).
- **Content security policy.** `vercel.json` is one static file for every build of the site, so its `frame-src https://pw-auth.circle.com` (the window Circle's email sign-in opens) stays; the mainnet app never opens it (email sign-in is off there, and the sign-in service is not asked). Removing it would need a separate CSP for the test network's build.
- **Exported components (what another app can start).** From the built app's merged manifest: `LauncherActivity` (exported; the launcher and the `https://minta.vyrechain.com` link filter), `ShortcutTrampolineActivity` (exported; the library's activity for home-screen shortcuts), and `androidx.profileinstaller.ProfileInstallReceiver` (exported; an AndroidX component protected by the system's DUMP permission). The file provider, the cold-shortcut activity and the startup provider are not exported.
- **Can another app make the app open another site?** The library (androidbrowserhelper 2.7.4, read from its compiled classes with `javap`, since no sources jar is published) rejects an incoming address unless it is on a trusted origin (the app's start address and any listed origins) or matches the app's own intent filter (`LauncherActivity.isRejectedIntentUrl`, `isTrustedIntentUrl`, `Utils.isTrustedOrigin`). The only origin listed is minta.vyrechain.com. Even a trusted address opens in Chrome, and Chrome only hides its address bar for a site that Digital Asset Links verifies. Residual risk: `LauncherActivity` and `ShortcutTrampolineActivity` are exported (the launcher and shortcuts need them), so any app can start them; the worst it can do is open a page of minta.vyrechain.com.

## Part 4: tests and how to run them

| What | Command | Needs |
|---|---|---|
| Repo checks, including the Android, store-text, in-app note, report/hide/terms and network tests (`test/android.test.mjs`, `test/twa.test.mjs`, `test/ugc.test.mjs`, `test/network.test.mjs`) | `npm ci && npm test` | Node 22 |
| The release gate: refuses unless `assetlinks.json` names the Play key (the release workflow runs it unless `first_upload` is ticked) | `RELEASE_CHECK=1 node --test test/android.test.mjs` | Node 22 |
| Debug APK, lint, no native code | `cd android && ./gradlew assembleDebug lintDebug` (or the "Android debug" workflow) | JDK 17, Android SDK 36 |
| Signed release bundle with a throwaway key (never your real one) | `keytool -genkeypair ...` then `MINTA_KEYSTORE_FILE=... MINTA_KEYSTORE_PASSWORD=... MINTA_KEY_ALIAS=... MINTA_KEY_PASSWORD=... ./gradlew bundleRelease` | as above |
| Store pictures from the real site (a local build until the web part is deployed: `MINTA_SITE=http://127.0.0.1:4173`) | `node store/android/make-screenshots.mjs` (one set: `phone`, `tablet7`, `tablet10`, `desktop`, `assets`) | Playwright Chromium |
| End-to-end checks at phone, tablet and desktop sizes | `node store/android/e2e.mjs` (against a local build: `npm run build && npx vite preview --port 4173` then `MINTA_SITE=http://127.0.0.1:4173 node store/android/e2e.mjs`) | Playwright Chromium |
| App launches on an emulator, loads the site, Back works | the "Android emulator check" workflow (runs `android/scripts/emulator-check.sh`) | GitHub runner |

The release workflow reads the four secrets only in its signing step, never prints them, deletes the decoded key file after the build, and uses only
actions pinned by commit. `store/android/e2e.mjs` prints PASS, FAIL or WARN lines; WARN lines are facts (for example the controls that are smaller than
48 by 48 pixels, which are the site's own styling, and that the app has no offline mode).
