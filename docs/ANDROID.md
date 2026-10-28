# MINTA on Google Play: the owner's guide

MINTA's Android app is a thin wrapper (a Trusted Web Activity) that opens https://minta.vyrechain.com full screen, with no browser bar once
Google has confirmed the app and the site belong together. The package name is `com.vyrechain.minta`. Nothing here needs a Mac or Android Studio:
the app is built on GitHub (Linux) and you only use a browser, GitHub and Play Console.

What is in the app (the facts the tests check):

- package `com.vyrechain.minta`, target API 36 (Android 16), minimum API 24 (Android 7.0), `versionCode 1`, version name `1.0.0`
- no permissions a user is asked for (the Android library adds one internal, unexported one), no native code (so it is 64-bit ready), no ads, no billing
- the store pictures and texts are in `store/android/` (made from the live site by `store/android/make-screenshots.mjs`)

## Part 1: what you do, in order

### 1. Make the upload key (once, on any computer)

The upload key proves that your builds come from you. Google keeps the real signing key (Play App Signing), so if you lose the upload key
Google can reset it. You still keep it safe: never put it in GitHub's files, chat or email.

You need `keytool`, which comes with any Java JDK. If you have none: on Windows run `winget install EclipseAdoptium.Temurin.17.JDK` in
PowerShell, or on any computer open a GitHub Codespace on this repository (Code, Codespaces), which already has Java.

```
keytool -genkeypair -v -keystore minta-upload.keystore -alias minta-upload -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password twice (use a long one, write it down in your password manager), then your name and organisation (any honest answers;
they are not shown to users). Press Enter at "key password" to use the same password. Keep `minta-upload.keystore` and the password in two
safe places (a password manager and an offline copy). Do not commit it: the repository's `.gitignore` already refuses `*keystore*`.

Then turn the file into one line of text:

- Linux or Codespaces: `base64 -w0 minta-upload.keystore`
- Mac Terminal: `base64 -i minta-upload.keystore`
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("minta-upload.keystore"))`

Copy that whole line (it is long). It is the only form in which the key goes to GitHub.

### 2. Add the four secrets on GitHub

GitHub, repository Mintzarc/minta, Settings, Secrets and variables, Actions, "New repository secret". Make exactly these four:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the long line from step 1 |
| `ANDROID_KEYSTORE_PASSWORD` | the password you typed |
| `ANDROID_KEY_ALIAS` | `minta-upload` |
| `ANDROID_KEY_PASSWORD` | the same password (the key password) |

Nobody can read a secret back once it is saved, and the workflow never prints them. To change one, save it again.

### 3. Build the release bundle

GitHub, Actions, "Android release", Run workflow. Choose the branch that holds the `android` folder. Fill `version_code` (1 for the first upload;
every later upload needs a higher whole number) and `version_name` (for example `1.0.0`). When the run is green (about 5 minutes), open it and
download the artifact **minta-release-aab** (a zip with `app-release.aab` inside). Unzip it.

If it fails at the first step with "A repository secret is missing", step 2 is incomplete. If it fails at signing, the password or alias is wrong.

To test on a phone before Play: Actions, "Android debug", Run workflow, download **minta-debug-apk**, and install it on an Android phone (allow
installs from your browser or files app). It works, but it shows a browser bar at the top: that is expected for a build Google has not
signed yet (see step 9).

### 4. Create the app in Play Console

Play Console, Create app. App name `MINTA`, default language English (United States), "App", "Free" (the app itself costs nothing; MINTA takes no
payments through Play), and tick the declarations. Your account is an organisation account that has published before, so the new-account testing
rule below should not apply: see Part 2.

### 5. App content (Policy and programs, App content). Answers to give

- **Privacy policy:** `https://minta.vyrechain.com/privacy/`
- **Ads:** No, the app does not contain ads.
- **App access:** "All functionality is available without special access" (browsing needs no login). Launching and trading need a wallet of the user's own; say so in the instructions box: "Browsing needs no sign-in. To launch or trade a user signs with their own crypto wallet in a browser that has one."
- **Target audience and content:** only "18 and over". Do not tick any younger group. The app does not appeal to children (see the note on the gecko picture in Part 2).
- **Content rating:** the questionnaire is multiple choice and asks you to be truthful. Expected answers: category "All other app types"; no violence, no sexual content, no profanity, no controlled substances; no gambling (MINTA has no chance game: Trader Rewards and any draw are not in the app); users can interact and share content (token names, pictures and descriptions made by users); no location sharing; digital purchases of crypto or tokens: answer yes where it asks about users buying crypto or digital goods with real money. Expect a rating for adults (18+).
- **News app:** No. **Government app:** No. **Health:** No.
- **Financial features declaration:** read the options as Play shows them. MINTA is non-custodial (it never holds funds or keys), which Google's policy says is out of scope of the cryptocurrency exchange and software wallet rules. Do not tick "Cryptocurrency exchange" or "Cryptocurrency wallet" unless you decide MINTA is one. Tick "Tokenized digital asset (NFT) sales, trading, and awards" if it is offered and describes launching and trading tokens. Answer every custody and licence question truthfully. If Play routes you to country forms asking for an exchange licence, remove those countries from the targeting instead of claiming a licence you do not hold (Part 2, point 2).
- **Data safety:** below.
- **Account deletion:** MINTA has no accounts of its own. Email sign-in, where offered, is handled by Circle. Answer that the app does not let users create an account, or if Play counts email sign-in as one, enter the deletion link `https://minta.vyrechain.com/privacy/#delete`. The text on that page says a request goes to MINTA's Telegram or X and MINTA will pass it to Circle: confirm that is a promise you will keep.

#### Data safety form: exact answers

Does the app collect or share required user data types: **Yes**. Is all data encrypted in transit: **Yes** (everything is HTTPS). Can users request deletion: **Yes** (the privacy page's "Deleting your data").

| Data type | Collected | Shared | Optional | Purpose |
|---|---|---|---|---|
| Personal info, Email address | Yes, only for email sign-in | No (Circle handles it for MINTA as a service provider) | Yes | App functionality, Account management |
| Photos and videos, Photos | Yes, only a picture the user picks for their own token | No | Yes | App functionality (the picture is public on the token's page) |
| App activity, Other user-generated content | Yes, a token's description and links | No | Yes | App functionality (public) |
| Financial info, Other financial info | Yes: the wallet address and transaction details sent to the network's service and to a transaction check before signing | No | Yes (needed only to trade) | App functionality, Fraud prevention and security |
| Device or other IDs | Yes: the IP address that the host and services see on every request | No | No (any web request has one) | App functionality, Fraud prevention and security (rate limits) |

No data is sold. No ads. If Play shows a category that fits the wallet address or IP address better than these, use that one: these two rows are the least certain (Google's category list for them is NOT VERIFIED here). The test is simply that everything the privacy page lists as received by a service appears somewhere in the form.

### 6. Store listing

Main store listing: app name `MINTA`; short description from `store/android/short-description.txt`; full description from `store/android/full-description.txt`;
icon `store/android/icon-512.png`; feature graphic `store/android/feature-graphic.jpg`; phone screenshots from `store/android/phone/`;
7-inch tablet from `store/android/tablet-7in/`; 10-inch tablet from `store/android/tablet-10in/`; Chromebook / large screen from `store/android/desktop/`.
Category: Finance. Contact: email is required by Play (use team@vyrechain.com if that is the address you want public; this repository does not state one), website `https://minta.vyrechain.com`.

Regenerate pictures any time: `npm ci`, `npx playwright install chromium`, `node store/android/make-screenshots.mjs`. The pictures show the live
site as it is that day (including the one token that exists today, a picture of a cartoon gecko; see Part 2).

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

## Part 2: what Google Play's rules say about MINTA (read 2026-10-28)

Each point is from Google's own pages; "NOT VERIFIED" marks what could not be read there. Page numbers are `support.google.com/googleplay/android-developer/answer/<n>`.

1. **Testing requirement (answer/14151465).** The page says the closed test (at least 12 testers opted in continuously for at least 14 days, then "Apply for production") applies to "personal developer accounts created after November 13, 2023". It does not mention organisation accounts or older accounts, and shows no date. So it reads as not applying to an older organisation account; Play Console is the proof: if the Dashboard offers production without the closed test, it does not apply. If it does apply, run the closed test with 12 real people for 14 days. Production cannot be requested directly where the rule applies.
2. **Crypto (answers 13607354, 16329703, 9876821).** Exchanges and software wallets may be published only with the licences listed per country (for example FinCEN plus state registration in the US, a MiCA licence in the EU, the FCA in the UK); "Non-custodial wallets are out of scope"; unlisted countries may publish but must follow local law. Blockchain-based content means "tokenized digital assets secured on a blockchain"; apps that sell or let users earn them must say so in the Financial features declaration, and "You may not promote or glamorize any potential earning from playing or trading activities." Nothing there bans a launchpad. The risk is how Google classes MINTA (exchange or not); the policy pages do not say. Verdict in point 12.
3. **User generated content (answer/9876937).** Apps with UGC need terms users accept, a definition of objectionable content, and in-app reporting and blocking that is easy to find, with follow-up on reports. MINTA's terms (section 8 and 9) define what is not allowed; this branch adds a **Report this token** button on every token page (it shows a message to copy and links to MINTA's Telegram and X, and collects nothing). There are no user profiles or messages, so there is nothing to block; a token shown to everyone can only be hidden by MINTA. MINTA must read the reports and act on them: Google lists "Apps that continually fail to address user complaints about objectionable content" as a violation.
4. **AI-generated content (answer/13985936).** Applies to apps that generate content with AI (chatbots as a core feature, images or video from prompts). MINTA generates none; its AI page only explains how an outside assistant can prepare a transaction. Not in scope.
5. **Deceptive behavior and misrepresentation (answers 17006354, 9888689).** False or misleading claims about what the app does are banned, and the title, icon and description must honestly show what the app does. Because email wallets cannot launch or trade on mainnet today and Chrome on Android has no wallet extensions, the app mostly lets people browse, read and report; trading needs a wallet that works in the browser the app opens. The description says exactly that. Do not claim more.
6. **Store listing (answer/9866151).** Screenshots must show the real app, and graphics must not suggest rankings, prices or testimonials; do not use "Best", "#1", "Top", "New", "Free", "Discount". The files in `store/android/` follow this, and `test/android.test.mjs` checks the wording rules.
7. **Families and children (answer/9893335).** Families rules apply only if children are a target audience. Choose 18 and over only. The page warns that imagery and terminology that could be seen as targeting children can affect Google's assessment, and that a listing must not promote an adults-only app to children. The one token on MINTA today shows a cartoon gecko eating pizza and is in the first screenshot: if you worry about a children review, replace that token or swap the order of screenshots (edit `SCREENS` in `store/android/viewports.mjs`). The feature graphic and icon use MINTA's own brand art only.
8. **Data safety and privacy policy (answer/10787469).** Required even for apps that collect nothing, with a privacy policy link; data from webviews counts. Answers in step 5. Account deletion rules are on answer/13327111 (the deletion link goes in the form if the app has accounts).
9. **Payments (answer/9858738).** Play billing is required for purchases of in-app digital features and virtual currency. The page does not mention crypto or tokenized assets (NOT VERIFIED how Google treats token purchases made from a user's own wallet). MINTA sells nothing itself: users trade tokens with their own wallet on the chain, MINTA takes no payment through the app, and Play billing is not used.
10. **Developer verification (answer/10841920).** Organisation accounts are verified with a government ID, an official organisation document and a D-U-N-S number, plus website verification; accounts that cannot be verified risk removal. Your account is already verified as an organisation. Google's separate Android developer verification (registering package names) says most Play developers are already covered and "over 99% of their apps" are registered; check the Play Console Home page for MINTA's status after the first upload (android-developers.googleblog.com/2026/06/android-developer-verification.html, second-hand summary; the page itself was not read).
11. **Target API and 64-bit.** New apps and updates must target Android 16 (API 36) or higher from 2026-08-31 (answer/11926878); this app targets API 36. The 64-bit rule covers native code; this app has none (developer.android.com/google/play/requirements/64-bit). Play App Signing is on for new apps (answer/9842756).
12. **Account standing (answer/9899234).** A rejected app does not affect the account's standing; removals do not immediately, but multiple removals can lead to suspension, and strikes can end in termination of related accounts. Google tells developers to fix violations across the whole catalogue. Your other app, STAGR, has been approved, so nothing is open. Because a MINTA removal counts toward the same account, do not submit MINTA with anything in this guide unresolved.

**Verdict: go with changes.** Nothing read blocks a non-custodial launchpad outright, and no licence is needed for a non-custodial app by the policy's own wording. Before the first review: answer the Financial features declaration truthfully, keep the listing honest about what the app does today (browse, report, and launch or trade only where the user has a wallet), act on reports, deploy this branch's web changes first (privacy section, Report button, assetlinks file), and have the Digital Asset Links fingerprint ready for step 9. The part Google may still decide for itself is whether MINTA counts as an exchange; if it does, the countries listed in answer/16329703 need licences you should not claim.

## Part 3: what works inside the app, and what does not

The app opens the site in Chrome's full-screen mode. Chrome on Android has no extensions and no wallet app can reach into it, and MINTA connects wallets only through the browser (the EIP-6963 way). It has no WalletConnect.

- Works: browsing, charts, token pages, docs, terms, the launch wizard up to its last step, the Report button, sharing links, Android's Back button, the home-screen shortcuts "Explore" and "Launch a token".
- Does not work in the app: connecting a browser wallet, so no launch or trade from the app. Email sign-in (Circle) opens, but on mainnet an email wallet cannot launch or trade yet (the page says so).
- Wallet apps' own browsers (a wallet's built-in "browser" tab) do inject the wallet: users who want to trade open https://minta.vyrechain.com there. A real fix inside the app is adding WalletConnect to the web app (an outside review is needed); that is not in this branch.
- Because of this, the Play description does not promise trading from the app. If Google's review wants more than a browsing app, the next step is WalletConnect, not a different wrapper (a WebView wrapper would have the same wallet limit and is more likely to be called a webview-spam app).

## Part 4: tests and how to run them

| What | Command | Needs |
|---|---|---|
| Repo checks, including the Android and store-text tests (`test/android.test.mjs`) | `npm ci && npm test` | Node 22 |
| Debug APK, lint, no native code | `cd android && ./gradlew assembleDebug lintDebug` (or the "Android debug" workflow) | JDK 17, Android SDK 36 |
| Signed release bundle with a throwaway key (never your real one) | `keytool -genkeypair ...` then `MINTA_KEYSTORE_FILE=... MINTA_KEYSTORE_PASSWORD=... MINTA_KEY_ALIAS=... MINTA_KEY_PASSWORD=... ./gradlew bundleRelease` | as above |
| Store pictures from the live site | `node store/android/make-screenshots.mjs` (one set: `phone`, `tablet7`, `tablet10`, `desktop`, `assets`) | Playwright Chromium |
| End-to-end checks at phone, tablet and desktop sizes | `node store/android/e2e.mjs` (against a local build: `npm run build && npx vite preview --port 4173` then `MINTA_SITE=http://127.0.0.1:4173 node store/android/e2e.mjs`) | Playwright Chromium |
| App launches on an emulator, loads the site, Back works | the "Android emulator check" workflow (runs `android/scripts/emulator-check.sh`) | GitHub runner |

The release workflow reads the four secrets only in its signing step, never prints them, deletes the decoded key file after the build, and uses only
actions pinned by commit. `store/android/e2e.mjs` prints PASS, FAIL or WARN lines; WARN lines are facts (for example the controls that are smaller than
48 by 48 pixels, which are the site's own styling, and that the app has no offline mode).
