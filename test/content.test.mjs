// What MINTA's pages, docs and notes say, read from the files themselves: claims that match the contracts and each other,
// nothing announced that isn't built, a privacy page that names every service a visitor's browser calls, and no notes about
// how other projects' services are configured or why something was decided.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
// the visible words of a page: tags dropped, entities for quotes and spaces turned back, runs of space made one
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const terms = words(read('public/terms/index.html'));
const privacy = words(read('public/privacy/index.html'));
// the test network's own pages (the footer links to them in a test-network build)
const termsT = words(read('public/terms-testnet/index.html'));
const privacyT = words(read('public/privacy-testnet/index.html'));
const docs = read('src/pages/Docs.tsx');
const wallet = read('src/pages/Wallet.tsx');
const handoff = read('docs/HANDOFF.md');

test('the terms and the docs say the same thing about who stands behind the contracts', () => {
  assert.doesNotMatch(terms, /independent/i, 'the terms call MINTA independent');
  assert.doesNotMatch(terms, /operator doesn[’']t control|operated by others|vyrechain\.com\. MINTA doesn[’']t control/i, 'the terms say MINTA’s operator has nothing to do with the contracts or the network’s services');
  assert.match(terms, /deployed by the network[’']s operator, which also holds the owner role/, 'the terms say who deployed and owns the contracts');
  assert.doesNotMatch(docs, /our own (tests|review)/i, 'the docs present MINTA as the contracts’ own team');
  assert.match(docs, /review rounds by the network[’']s operator/, 'the docs say whose review rounds they were');
});

test('the handover notes describe a partner launchpad’s fee as the contracts do: named by the launch, no registration', () => {
  assert.doesNotMatch(handoff, /registered with the splitter|contracts' owner does/);
  assert.match(handoff, /no registration/i);
  assert.match(handoff, /offerPartnerPayout/);
});

test('the docs announce no contracts that aren’t deployed', () => {
  assert.doesNotMatch(docs, /being deployed/i);
});

test('the Wallet page promises no cash-out to a bank, and shows the card checkout only where this build offers it', () => {
  assert.doesNotMatch(wallet, /bank account|card partner/i);
  assert.match(wallet, /\{CARD_TOPUP && account && !faceId && <CardTopup /, 'the card checkout is behind the build setting');
  assert.equal((wallet.match(/<CardTopup /g) || []).length, 1, 'and is drawn in one place only');
  assert.match(termsT, /card and Apple Pay purchases of USDC, where offered/, 'the test network’s terms name the card provider only where it is offered');
  assert.match(privacyT, /Buy USDC with a card or Apple Pay \(where offered\)/, 'and so does its privacy page');
  assert.match(privacyT, /Transak : card and Apple Pay purchases of USDC, where offered/, 'in its list of companies too');
  // mainnet's pages: the card checkout is not offered and nothing says it is
  assert.match(terms, /doesn[’']t offer card or Apple Pay purchases of USDC/, 'the mainnet terms say card purchases are not offered');
  assert.doesNotMatch(privacy, /Transak|card or Apple Pay|checkout/i, 'and the mainnet privacy page has no card checkout');
});

test('the privacy page names the explorer, which every page calls from the visitor’s browser', () => {
  assert.match(read('src/lib/stats.ts'), /fetch\(`\$\{EXPLORER\}/, 'the pages do call the explorer');
  assert.match(privacy, /the network’s explorer \(explorer\.vyrechain\.com\)[^.]*receives the tokens shown and your IP address/);
});

test('no settings of other services, internal paths, dated decisions or business suggestions in MINTA’s files', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => f && /\.(tsx?|mjs|cjs|js|md|html|css|json)$/.test(f) && !/package-lock\.json$/.test(f));
  const bad = [
    [/\b[A-Z][A-Z0-9]*_ORIGINS\b/, 'a server setting of the API'],
    [/\bdocs\/(?!HANDOFF\.md)[a-z0-9-]+\.md\b/, 'a path to another project’s notes'],
    [/project[’']s call|owner[’']s call/i, 'a decision note'],
    [/\b20\d\d-[01]\d-[0-3]\d\b/, 'a dated note'],
    [/was suggested/i, 'a business suggestion'],
    [/up to\s+(\*\s*)?3 a day to one address \(/, 'a service’s internal limits cited in a comment'],
  ];
  const found = [];
  for (const f of files) {
    if (f === 'test/content.test.mjs') continue;
    const text = fs.readFileSync(new URL(f, root), 'utf8');
    for (const [re, what] of bad) if (re.test(text)) found.push(`${f}: ${what} (${text.match(re)[0]})`);
  }
  assert.deepEqual(found, []);
});

test('the card checkout is offered on a test network unless switched off, and elsewhere only when switched on', async () => {
  const { cardTopupOffered } = await import('../src/lib/features.ts');
  assert.equal(cardTopupOffered(undefined, true), true, 'the test network, by default');
  assert.equal(cardTopupOffered(undefined, false), false, 'any other network, by default');
  assert.equal(cardTopupOffered('', false), false);
  assert.equal(cardTopupOffered('0', true), false, 'switched off');
  assert.equal(cardTopupOffered('1', false), true, 'switched on');
  for (const odd of ['true', 'yes', ' 1', 'on', 1, true]) assert.equal(cardTopupOffered(odd, false), false, `${JSON.stringify(odd)} is not a setting`);
  assert.match(wallet, /cardTopupOffered\(import\.meta\.env\.VITE_CARD_TOPUP, NETWORK\.testnet\)/, 'the Wallet page asks with the build setting and the app’s own network');
  assert.match(read('README.md'), /VITE_CARD_TOPUP/, 'the setting is documented');
});

// Every service a visitor's browser calls, read from the code that calls it, is named on the privacy page with what it receives;
// and the page doesn't say that what's kept in the browser is never sent anywhere, since three things kept there are sent on.
test('the privacy page names every call the pages make, and which stored things are sent, and to whom', () => {
  const src = (f) => read(`src/${f}`);
  // the email sign-in settings, asked on every page by the wallet provider
  assert.match(src('lib/circle.ts'), /api<WalletConfig>\('\/wallet\/config'\)/);
  assert.match(src('lib/wallet.tsx'), /useEffect\(\(\) => \{ walletConfig\(\)/);
  assert.match(privacy, /Open any page[^.]*\.[^.]*\.[^|]*sign-in service \(api\.vyrechain\.com\) is asked whether email sign-in is offered/, 'every page asks the sign-in service');
  // the faucet, from the Wallet page
  assert.match(src('pages/Wallet.tsx'), /getFaucetStatus\(\)/);
  assert.match(privacyT, /faucet \(testnet-rpc\.vyrechain\.com\/faucet\)[^|]*your wallet address/, 'the faucet, and the wallet address a request sends it');
  // the promoter status lookup with the connected wallet, from the Wallet page
  assert.match(src('pages/Wallet.tsx'), /promoterStatus\(account\)/);
  assert.match(privacyT, /Open the Wallet page with a wallet connected[^|]*promoter service \(testnet-rpc\.vyrechain\.com\)[^|]*wallet address/, 'the promoter status lookup and the wallet address it sends');
  // the stored promoter code, looked up again from token pages
  assert.match(src('pages/Token.tsx'), /promoterWallet\(code\)/);
  assert.match(privacyT, /each token page you open looks the stored code up again/);
  // Circle's transfer service: its fees when the Wallet page opens, and the stored transfers' hashes
  assert.match(read('node_modules/@vyrechain/sdk/dist/cctp.js'), /iris-api-sandbox\.circle\.com/);
  assert.match(privacyT, /Circle’s transfer service \(iris-api-sandbox\.circle\.com\)[^|]*fees[^|]*transaction hash/, 'Circle’s transfer service, its fees and the transfers’ hashes');
  // section 3: what's kept in the browser and what of it is sent
  assert.doesNotMatch(privacyT, /none of it is sent anywhere/i);
  const kept = privacyT.slice(privacyT.indexOf('3. What’s kept in your browser'), privacyT.indexOf('4. Other companies'));
  assert.match(kept, /promoter who referred you[^.]*promoter service/);
  assert.match(kept, /transfers between networks[^.]*Circle/);
  assert.match(kept, /email sign-in[^.]*sign-in service/);
});

// The mainnet pages describe the mainnet build: the services it calls (the sign-in and picture API, the RPC, the explorer, the check, Arc's
// public RPC), the creator's tax as the only fee with a tenth of each payout to the platform wallet, no card purchases, no promoters,
// no faucet, no outside audit claimed; and the operator's name, contact and governing law are visible placeholders until filled in.
test('the mainnet terms and privacy pages say what the mainnet build does, and leave the operator’s details as visible placeholders', () => {
  for (const [name, t] of [['terms', terms], ['privacy', privacy]]) {
    assert.doesNotMatch(t, /test network|test USDC|test tokens|testnet|draft for|no monetary value|faucet|Transak|card checkout/i, `${name}: no test-network or retired-feature wording`);
    if (name === 'privacy') assert.doesNotMatch(t, /promoter/i, 'the privacy page: no promoter service on mainnet');
    assert.doesNotMatch(t, /\baudited\b|trustless|layer.?2|10% of every (?:trade|buy|sale)|1% of (?:each|every) (?:buy|trade)|platform fee of/i, `${name}: no wording the project doesn’t use`);
    assert.match(t, /Effective [A-Z][a-z]+ \d{1,2}, 2026/, `${name}: dated`);
    assert.match(t, /VYRE Mainnet/, `${name}: names the network`);
    assert.match(t, /real money/i, `${name}: says the money is real`);
  }
  assert.match(terms, /\[OPERATOR NAME[^\]]*\]/);
  assert.match(terms, /\[CONTACT ADDRESS[^\]]*\]/);
  assert.match(terms, /\[GOVERNING LAW[^\]]*\]/);
  assert.match(privacy, /\[CONTACT ADDRESS[^\]]*\]/);
  assert.match(terms, /1% to 10% on each side/, 'the tax range');
  assert.match(terms, /one tenth of the amount goes to the platform’s treasury address[^.]*and the rest to the creator’s tax wallets/);
  assert.match(terms, /no separate platform fee, no fee of MINTA’s own and no promoter share/i);
  assert.match(terms, /has not had an outside security audit/);
  assert.match(terms, /takes about a day/);
  assert.match(terms, /Circle; MINTA is not affiliated with or endorsed by Circle|issued by Circle/);
  // the hosts the mainnet build calls are the mainnet ones
  assert.match(privacy, /rpc\.vyrechain\.com/);
  assert.doesNotMatch(privacy, /testnet-/);
  assert.match(privacy, /api\.vyrechain\.com/);
  assert.match(privacy, /explorer\.vyrechain\.com/);
  assert.match(privacy, /rpc\.mainnet\.arc\.io/, 'Arc’s public RPC, which the Wallet page reads');
  // the test network keeps its own pages, linked from the footer of a test-network build
  assert.match(read('src/App.tsx'), /NETWORK\.testnet \? '\/terms-testnet\/' : '\/terms\/'/);
  assert.match(read('src/App.tsx'), /NETWORK\.testnet \? '\/privacy-testnet\/' : '\/privacy\/'/);
});

// The handover notes' section on the network is the checklist for it: it names the places the network is chosen, and every file
// whose words or features belong to the test network (each must keep them behind the network setting).
const section = (md, n) => { const from = md.indexOf(`\n## ${n}. `); assert.ok(from >= 0, `section ${n}`); const to = md.indexOf('\n## ', from + 1); return md.slice(from, to < 0 ? undefined : to); };
test('the handover notes’ network section names where the network is chosen and every file tied to the test network', () => {
  const s4 = section(handoff, 4);
  assert.match(s4, /The network/);
  assert.match(s4, /`src\/lib\/network\.ts`/, 'the build setting is read there');
  assert.match(s4, /VITE_NETWORK/);
  assert.match(s4, /`VYRE_CHAIN`/, 'the one place the network is chosen');
  assert.match(s4, /`ARC_CHAIN`/, 'and the network USDC is moved to and from');
  assert.match(read('src/lib/chain.ts'), /^export const VYRE_CHAIN = /m, 'chain.ts chooses the network');
  assert.match(read('src/lib/chain.ts'), /^export const ARC_CHAIN = /m);
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => /^src\/.+\.tsx?$/.test(f) || f === 'index.html' || /^public\/.+\.(html|webmanifest)$/.test(f));
  // words and features of the test network, outside comments
  const tied = /test USDC|real money|testnet|test network|\b7357\b|faucet|requestTestUsdc|CCTP_SOURCES/i;
  const comment = /^\s*(?:\/\/|\*|\/\*|\{\/\*)/;
  const missing = files.filter((f) => read(f).split('\n').some((l) => !comment.test(l) && tied.test(l)) && !s4.includes('`' + f + '`'));
  assert.deepEqual(missing, [], 'files tied to the test network that the checklist doesn’t name');
  for (const step of [/stored in the browser/i, /card checkout/i, /faucet/i, /milestone/i, /\$3,000/]) assert.match(s4, step);
});

// The faucet, like the app API, answers a browser only from the pages it knows: a new domain needs it too.
test('the handover notes list the faucet among the services a new domain must be allowed by, and walk through getting test USDC', () => {
  const s1 = section(handoff, 1);
  assert.match(s1, /faucet[^.]*only[^.]*(?:pages|addresses) it knows|faucet[^.]*answers[^.]*pages it knows/i, 'the faucet answers only pages it knows');
  assert.match(s1, /Get test USDC/, 'the walk-through presses Get test USDC');
});

// The network's services (its RPC, explorer and app API, each on a host under vyrechain.com) are reached at the addresses the SDK
// and the build settings give, chosen in src/lib/chain.ts and src/lib/api.ts. A host written out anywhere else in the pages would
// stay behind if those services moved to other names, and send a test-network build's visitors to whatever took the old ones.
test('no page names a service host of the network outside src/lib/network.ts, src/lib/chain.ts and src/lib/api.ts', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => (/^src\/.+\.tsx?$/.test(f) || f === 'index.html') && f !== 'src/lib/chain.ts' && f !== 'src/lib/api.ts' && f !== 'src/lib/network.ts');
  const comment = /^\s*(?:\/\/|\*|\/\*|\{\/\*)/;
  const host = /\b[a-z0-9-]+\.vyrechain\.com\b/i;
  const found = [];
  for (const f of files) read(f).split('\n').forEach((l, i) => { if (!comment.test(l) && host.test(l)) found.push(`${f}:${i + 1} (${l.match(host)[0]})`); });
  assert.deepEqual(found, []);
});

// If the network's services move to other host names while MINTA stays on the test network, the handover notes say what follows the
// SDK and what must be changed by hand, before the old names go to anything else.
test('the handover notes say what to do when the network’s services move to other host names', () => {
  const s2 = section(handoff, 2);
  assert.match(s2, /other host names/, 'the case is named');
  assert.match(s2, /SDK release[^.]*new names[^.]*before/i, 'the SDK release with the new names comes first');
  for (const f of ['src/lib/api.ts', 'public/terms/index.html', 'public/privacy/index.html']) assert.ok(s2.includes('`' + f + '`'), `names ${f}`);
  assert.match(s2, /VITE_PROMOTERS_URL/, 'and the promoter service’s address');
});
