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
  assert.match(terms, /card and Apple Pay purchases of USDC, where offered/, 'the terms name the card provider only where it is offered');
  assert.match(privacy, /Buy USDC with a card or Apple Pay \(where offered\)/, 'and so does the privacy page');
  assert.match(privacy, /Transak : card and Apple Pay purchases of USDC, where offered/, 'in its list of companies too');
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
  assert.match(wallet, /cardTopupOffered\(import\.meta\.env\.VITE_CARD_TOPUP, vyre\.chain\?\.testnet === true\)/, 'the Wallet page asks with the build setting and the app’s own network');
  assert.match(read('README.md'), /VITE_CARD_TOPUP/, 'the setting is documented');
});
