// What Google Play asks of an app that shows content made by its users (Play policy "User Generated Content"): terms accepted
// before creating, a report way on each item, and a way to stop seeing one. MINTA's token names, pictures and descriptions are
// made by whoever launches a token. What it must get right: the launch wizard cannot go to the review before the Terms are
// accepted; a token can be hidden on the device and shown again, and hidden tokens leave every list; the report panel carries
// the message and the ways to send it, the email one only once an address is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function load(p) {
  const js = ts.transpileModule(read(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(() => { throw new Error('no imports'); }, module, module.exports);
  return module.exports;
}
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
const A = `0x${'a'.repeat(40)}`, B = `0x${'B'.repeat(40)}`, C = `0x${'c'.repeat(40)}`;
const K = 'minta.hidden:3045';

test('the final step has a Terms checkbox, unchecked at first, and the review button is disabled until it is checked', () => {
  const src = read('src/pages/Launch.tsx');
  assert.match(src, /const \[accepted, setAccepted\] = useState\(false\)/);
  assert.match(src, /<input type="checkbox" checked=\{accepted\} onChange=\{\(e\) => setAccepted\(e\.target\.checked\)\} \/>/);
  assert.match(src, /href="\/terms\/"/);
  assert.match(src, /type="submit" disabled=\{\(!sent && waiting\) \|\| \(!sent && !recent && !asideState && !accepted\)\}/);
  // and the form's own submit refuses too (Enter in a field, a script): before anything goes to the review
  const submit = src.slice(src.indexOf('const submit ='), src.indexOf('const showProblem'));
  assert.ok(submit.indexOf('if (!accepted)') > submit.indexOf('if (recent || asideState)') && submit.indexOf('if (!accepted)') < submit.lastIndexOf('setReviewing(account)'));
  // the checkbox sits above the wallet button on the same step
  assert.ok(src.indexOf('accept-terms') < src.indexOf('{!account ? <ConnectButton />'));
});

test('hiding a token keeps its address on the device, once, lowercased; showing and "show all" take it off', () => {
  const { hideToken, showToken, showAllTokens, loadHidden, parseHidden, withoutHidden, MAX_HIDDEN } = load('src/lib/hidden.ts');
  const s = memory();
  assert.deepEqual(loadHidden(s, K), []);
  hideToken(s, K, A); hideToken(s, K, B); hideToken(s, K, A.toUpperCase().replace('0X', '0x'));
  assert.deepEqual(loadHidden(s, K), [A, B.toLowerCase()]);
  assert.deepEqual(showToken(s, K, B), [A]);
  assert.deepEqual(showAllTokens(s, K), []);
  assert.equal(s.m.size, 0);
  assert.deepEqual(hideToken(s, K, 'not an address'), []);
  assert.deepEqual(parseHidden('{"a":1}'), []);
  assert.deepEqual(parseHidden('not json'), []);
  assert.deepEqual(parseHidden(JSON.stringify([A, 5, 'x', A])), [A]);
  assert.ok(MAX_HIDDEN > 0 && parseHidden(JSON.stringify(Array.from({ length: MAX_HIDDEN + 50 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`))).length === MAX_HIDDEN);
  const blocked = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.deepEqual(loadHidden(blocked, K), []);
  assert.deepEqual(hideToken(blocked, K, A), [A], 'blocked storage does not throw');
  assert.deepEqual(loadHidden(null, K), []);
});

test('hidden tokens and creators, and the team\'s list, are left out of Explore, the top list and the search; with nothing hidden nothing changes', () => {
  const { visibleLaunches, isHidden, NO_BLOCKS } = load('src/lib/hidden.ts');
  const rows = [{ token: A, creator: C }, { token: B, creator: C }, { token: C, creator: A }];
  assert.equal(visibleLaunches(rows, [], [], NO_BLOCKS), rows, 'the same list when nothing is hidden');
  assert.deepEqual(visibleLaunches(rows, [B.toLowerCase()], [], NO_BLOCKS), [rows[0], rows[2]]);
  assert.deepEqual(visibleLaunches(rows, [], [C.toLowerCase()], NO_BLOCKS), [rows[2]], 'everything from a creator goes');
  assert.deepEqual(visibleLaunches(rows, [], [], { tokens: [A.toLowerCase()], creators: [] }), [rows[1], rows[2]]);
  assert.deepEqual(visibleLaunches(rows, [], [], { tokens: [], creators: [A.toLowerCase()] }), [rows[0], rows[1]]);
  assert.equal(isHidden(rows[0], [], [], NO_BLOCKS), false);
  assert.equal(isHidden(rows[0], [], [], { tokens: [A.toLowerCase()], creators: [] }), true);
  assert.match(read('src/pages/Explore.tsx'), /visibleLaunches\(all, hidden, hiddenCreators, block\)/);
  assert.match(read('src/components/Search.tsx'), /visibleLaunches\(list, hidden, hiddenCreators, block\)/);
  assert.match(read('src/pages/Explore.tsx'), /<HideToken token=\{l\.token\} creator=\{l\.creator\} card \/>/);
  assert.match(read('src/pages/Token.tsx'), /<HideToken token=\{launch\.token\} creator=\{launch\.creator\} \/>/);
  assert.match(read('src/pages/Wallet.tsx'), /<HiddenNote \/>/);
  assert.match(read('src/pages/Explore.tsx'), /<HiddenNote \/>/);
  const hid = read('src/components/Hidden.tsx');
  assert.match(hid, /Hide everything from this creator/);
  assert.match(hid, /Show all/);
});

test('public/blocklist.json has the documented schema (version 1, token and creator addresses), starts empty, and is read from this site only', () => {
  const { parseBlocklist, NO_BLOCKS, MAX_BLOCKLIST } = load('src/lib/hidden.ts');
  const file = JSON.parse(read('public/blocklist.json'));
  assert.deepEqual(Object.keys(file).sort(), ['creators', 'tokens', 'version']);
  assert.equal(file.version, 1);
  for (const k of ['tokens', 'creators']) {
    assert.ok(Array.isArray(file[k]));
    for (const a of file[k]) assert.match(a, /^0x[0-9a-fA-F]{40}$/, `${k}: ${a}`);
    assert.equal(new Set(file[k].map((a) => a.toLowerCase())).size, file[k].length, `${k}: no duplicates`);
  }
  assert.deepEqual(file.tokens, [], 'starts empty');
  assert.deepEqual(file.creators, []);
  // what the app takes from a file
  assert.deepEqual(parseBlocklist({ version: 1, tokens: [A, 'x', A.toUpperCase().replace('0X', '0x'), 7], creators: [B] }), { tokens: [A], creators: [B.toLowerCase()] });
  for (const bad of [null, 'text', [], { version: 2, tokens: [A] }, {}, { tokens: [A] }]) assert.deepEqual(parseBlocklist(bad), NO_BLOCKS);
  assert.deepEqual(parseBlocklist({ version: 1, tokens: 'nope', creators: { a: 1 } }), NO_BLOCKS);
  assert.ok(parseBlocklist({ version: 1, tokens: Array.from({ length: MAX_BLOCKLIST + 10 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`), creators: [] }).tokens.length === MAX_BLOCKLIST);
  const hid = read('src/components/Hidden.tsx');
  assert.match(hid, /fetch\('\/blocklist\.json'/);
  assert.equal(/https?:\/\//.test(hid.replace(/\/\/.*$/gm, '')), false, 'no other host is asked');
  // a blocked token's page says why and gives a way back
  assert.match(hid, /MINTA hides this token because it was reported\./);
  assert.match(hid, /Back to all tokens/);
  assert.match(read('src/pages/Token.tsx'), /if \(isHidden\(launch, \[\], \[\], block\)\) return <BlockedToken \/>;/);
});

test('a stored hidden list is read in bounded time: a 50,000-address value is cut at the limit, an oversized one is dropped unread', () => {
  const { parseHidden, MAX_HIDDEN } = load('src/lib/hidden.ts');
  const big = JSON.stringify(Array.from({ length: 2000 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`));
  assert.equal(parseHidden(big).length, MAX_HIDDEN);
  const huge = JSON.stringify(Array.from({ length: 50000 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`));
  const t0 = performance.now();
  assert.deepEqual(parseHidden(huge), []);
  assert.ok(performance.now() - t0 < 100, 'under 100 ms');
  const junk = JSON.stringify(Array.from({ length: 2400 }, (_, i) => (i % 2 ? 'x' : `0x${i.toString(16).padStart(40, '0')}`)));
  const t1 = performance.now();
  assert.ok(parseHidden(junk).length <= MAX_HIDDEN);
  assert.ok(performance.now() - t1 < 100);
});

test('saving a launch\'s picture, description or links in Manage needs the Terms accepted too', () => {
  const src = read('src/pages/Manage.tsx');
  assert.match(src, /const \[accepted, setAccepted\] = useState\(false\)/);
  assert.match(src, /<input type="checkbox" checked=\{accepted\}/);
  assert.match(src, /label="Save" disabled=\{!!problem \|\| !touched \|\| !accepted\}/);
  assert.match(src, /href="\/terms\/"/);
});

test('the report message names the ticker and address; the email link exists only with a valid address and is prefilled', () => {
  const { reportText, reportMailto, REPORT_EMAIL, REPORT_TELEGRAM, REPORT_X } = load('src/lib/contact.ts');
  assert.equal(reportText('ABC', A), `Report token $ABC ${A} on MINTA: `);
  assert.equal(reportMailto('', 'ABC', A), null);
  assert.equal(reportMailto('not an email', 'ABC', A), null);
  const m = reportMailto('someone@example.com', 'AB C&', A);
  assert.match(m, /^mailto:someone@example\.com\?subject=Report%3A%20%24AB%20C%26%20on%20MINTA&body=/);
  assert.ok(decodeURIComponent(m).includes(A));
  assert.equal(REPORT_EMAIL === '' || /@/.test(REPORT_EMAIL), true);
  assert.equal(REPORT_TELEGRAM, 'https://t.me/+HDa2YpR0piA3ZWE0');
  assert.equal(REPORT_X, 'https://x.com/MintaLaunchpad');
  assert.match(read('src/lib/contact.ts'), /REPORT_EMAIL = ''; \/\/ OWNER TO CONFIRM/);
  // one definition of the address in the code
  const defs = fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => /\.tsx?$/.test(f) && /REPORT_EMAIL\s*=/.test(read(`src/${f}`)));
  assert.deepEqual(defs.map((f) => f.replace(/\\/g, '/')), ['lib/contact.ts']);
  const tok = read('src/components/ReportToken.tsx');
  assert.match(tok, /\{mail && <>/);
  assert.match(read('src/pages/Token.tsx'), /<ReportToken token=\{launch\.token\} sym=\{sym\} \/>/);
});

test('the Report panel renders an Email link only when an address is set: subject and message prefilled and escaped; with none, nothing', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const js = ts.transpileModule(read('src/components/ReportToken.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const contact = load('src/lib/contact.ts');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'React', js)((id) => (id === 'react' ? React : id === '../lib/contact' ? contact : (() => { throw new Error(id); })()), module, module.exports, React);
  const { ReportToken } = module.exports;
  const render = (email) => renderToStaticMarkup(React.createElement(ReportToken, { token: A, sym: 'A&B', email, defaultOpen: true }));
  const withMail = render('team@example.com');
  const href = /href="(mailto:[^"]+)"/.exec(withMail)?.[1];
  assert.ok(href, 'an Email link is there');
  const u = new URL(href.replace(/&amp;/g, '&'));
  assert.equal(u.pathname, 'team@example.com');
  assert.equal(u.searchParams.get('subject'), 'Report: $A&B on MINTA');
  assert.ok(u.searchParams.get('body').startsWith(`Report token $A&B ${A} on MINTA: `), 'the body carries the ticker and the token address');
  assert.equal(/subject=[^&]* /.test(href), false, 'no raw spaces in the link');
  assert.match(withMail, /on Telegram, on X or by email/);
  for (const none of ['', 'not an address']) {
    const m = render(none);
    assert.equal(/mailto:/.test(m), false);
    assert.equal(/>Email</.test(m), false);
    assert.match(m, /on Telegram or X/);
    assert.match(m, /Telegram/);
  }
  assert.equal(contact.REPORT_EMAIL, '', 'the address stays empty until the owner confirms it');
});

test('hidden and blocked tokens are out of the ticker (by token and by creator), the totals stay, and the first paint waits for the team\'s list at most 1.5 s', () => {
  const { visibleFeed, hidesByCreator, NO_BLOCKS, BLOCKLIST_WAIT_MS } = load('src/lib/hidden.ts');
  const items = [
    { kind: 'stat', id: 's' },
    { kind: 'launch', id: 'l1', token: A }, { kind: 'trade', id: 't1', token: B }, { kind: 'trade', id: 't2', token: C },
  ];
  const creators = { [A]: C, [B]: A, [C]: A };
  const creatorOf = (t) => creators[t] ?? creators[Object.keys(creators).find((k) => k.toLowerCase() === t.toLowerCase())];
  assert.equal(visibleFeed(items, creatorOf, [], [], NO_BLOCKS).length, 4);
  assert.equal(visibleFeed(items, () => undefined, [], [], NO_BLOCKS).length, 4, 'with no creator hidden, unknown creators matter nothing');
  assert.deepEqual(visibleFeed(items, creatorOf, [], [], { tokens: [A.toLowerCase()], creators: [] }).map((i) => i.id), ['s', 't1', 't2']);
  assert.deepEqual(visibleFeed(items, creatorOf, [B.toLowerCase()], [], NO_BLOCKS).map((i) => i.id), ['s', 'l1', 't2']);
  assert.deepEqual(visibleFeed(items, creatorOf, [], [], { tokens: [], creators: [A.toLowerCase()] }).map((i) => i.id), ['s', 'l1'], 'everything of a creator goes (B and C are A\'s)');
  assert.deepEqual(visibleFeed(items, creatorOf, [], [C.toLowerCase()], NO_BLOCKS).map((i) => i.id), ['s', 't1', 't2'], 'a hidden creator\'s launch goes');
  assert.equal(hidesByCreator([], NO_BLOCKS), false);
  assert.equal(hidesByCreator([A], NO_BLOCKS), true);
  assert.equal(BLOCKLIST_WAIT_MS, 1500);
  // wiring: every place that lists tokens uses the lists, and waits for the first reading
  const ticker = read('src/components/Ticker.tsx');
  assert.match(ticker, /visibleFeed\(all, creatorKnown, hiddenTokens, hiddenCreators, block\)/);
  assert.match(ticker, /ready \? visibleFeed/);
  assert.match(read('src/pages/Explore.tsx'), /all && ready \? visibleLaunches/);
  assert.match(read('src/pages/Token.tsx'), /launch === undefined \|\| !ready/);
  assert.match(read('src/pages/Portfolio.tsx'), /pairVisible\(raw\.list, raw\.balances, block\)/);
  assert.match(read('src/components/Search.tsx'), /visibleLaunches\(list, hidden, hiddenCreators, block\)/);
  const hid = read('src/components/Hidden.tsx');
  assert.match(hid, /strict \? undefined : setTimeout\(\(\) => \{ if \(live\) setS\(\(p\) => \(p\.ready \? p : \{ \.\.\.p, ready: true \}\)\); \}, BLOCKLIST_WAIT_MS\)/);
  // a token's own page and the manage page wait for the file to load or fail (a reading is given up after 10 s), never for 1.5 s only
  assert.match(hid, /useBlocklistState\(true\)/, 'the gate (manage page, launch notices) is strict');
  assert.match(read('src/pages/Token.tsx'), /useBlocklistState\(true\)/, 'the token page is strict');
  assert.match(hid, /AbortSignal\.timeout\(READ_TIMEOUT_MS\)/);
  assert.match(hid, /READ_TIMEOUT_MS = 10_000/);
});

test('the hidden list holds 2,000 and the UI says when it is full', () => {
  const { MAX_HIDDEN } = load('src/lib/hidden.ts');
  assert.equal(MAX_HIDDEN, 2000);
  assert.match(read('src/components/Hidden.tsx'), /hiding more drops the oldest/);
});

test('?app=1 is never an authority: it only decides whether the wallet note is shown', () => {
  for (const f of fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => /\.tsx?$/.test(f))) {
    const src = read(`src/${f}`);
    if (/lib[\\/]twa\.ts$/.test(f)) continue;
    const uses = src.match(/IS_TWA/g) || [];
    if (uses.length) assert.ok(/components[\\/]ui\.tsx$/.test(f), `${f} uses IS_TWA: only ui.tsx (the wallet note) may`);
  }
  const ui = read('src/components/ui.tsx');
  for (const m of ui.matchAll(/IS_TWA[^\n]*/g)) assert.match(m[0], /TwaNote|lib\/twa|available/, 'IS_TWA only picks the wallet note');
});

test('each balance stays with its own token when a blocked token sits in the middle of the list (Portfolio)', () => {
  const { pairVisible, NO_BLOCKS } = load('src/lib/hidden.ts');
  const list = [{ token: A, creator: A }, { token: B, creator: B }, { token: C, creator: C }, { token: `0x${'d'.repeat(40)}`, creator: A }];
  const balances = [10n, 20n, 30n, 40n];
  assert.deepEqual(pairVisible(list, balances, NO_BLOCKS).map((r) => [r.launch.token, r.balance]), list.map((l, i) => [l.token, balances[i]]));
  const mid = pairVisible(list, balances, { tokens: [B.toLowerCase()], creators: [] });
  assert.deepEqual(mid.map((r) => [r.launch.token, r.balance]), [[A, 10n], [C, 30n], [list[3].token, 40n]], 'C keeps 30, not 20');
  const byCreator = pairVisible(list, balances, { tokens: [], creators: [A.toLowerCase()] });
  assert.deepEqual(byCreator.map((r) => [r.launch.token, r.balance]), [[B, 20n], [C, 30n]]);
});

test('the ticker holds back an item whose creator is unknown while a creator is blocked, and shows the 33rd newest token\'s creator block once it is looked up', () => {
  const { visibleFeed } = load('src/lib/hidden.ts');
  const tok = (i) => `0x${(i + 1).toString(16).padStart(40, '0')}`;
  const launches = Array.from({ length: 40 }, (_, i) => ({ token: tok(i), creator: i === 32 ? C : A })); // the 33rd newest is the blocked creator's
  const first30 = launches.slice(0, 30);
  const known = (list, extra = new Map()) => (t) => extra.get(t.toLowerCase()) ?? list.find((l) => l.token.toLowerCase() === t.toLowerCase())?.creator.toLowerCase();
  const items = launches.map((l, i) => ({ kind: 'trade', id: `t${i}`, token: l.token }));
  const block = { tokens: [], creators: [C.toLowerCase()] };
  // before lookup: everything beyond the first 30 is held back (fail closed), including the blocked creator's
  const before = visibleFeed(items, known(first30), [], [], block).map((i) => i.id);
  assert.equal(before.includes('t32'), false);
  assert.equal(before.includes('t35'), false, 'unknown creators are held back, not shown');
  assert.equal(before.length, 30 - 0, 'the first 30 (none of them the blocked creator) show');
  // after the lookup resolved the creators of the rest
  const extra = new Map(launches.slice(30).map((l) => [l.token.toLowerCase(), l.creator.toLowerCase()]));
  const after = visibleFeed(items, known(first30, extra), [], [], block).map((i) => i.id);
  assert.equal(after.includes('t32'), false, 'the blocked creator\'s 33rd token stays out');
  assert.equal(after.includes('t35'), true, 'an allowed token shows once its creator is known');
  assert.equal(after.length, 39);
  // wiring: the line looks tokens up one by one and re-reads when it changes
  const ticker = read('src/components/Ticker.tsx');
  assert.match(ticker, /getLaunch\(vyre, t as Address\)/);
  assert.match(ticker, /\[all, byCreator\]/);
});

test('every page that shows a token by its address goes through the gate (token page, manage page, a launch just made, lists)', () => {
  const pages = fs.readdirSync(new URL('../src/pages/', import.meta.url)).filter((f) => /\.tsx$/.test(f));
  const renders = /TokenPic|TokenImage|page: 'token'|page: 'manage'|\.symbol\b/;
  const gated = /useTokenGate|useBlocklistState/;
  const missing = pages.filter((f) => { const src = read(`src/pages/${f}`); return renders.test(src) && !gated.test(src); });
  assert.deepEqual(missing, [], 'pages that render a token without the blocklist gate');
  for (const f of ['Token.tsx', 'Manage.tsx', 'Launch.tsx', 'Explore.tsx', 'Portfolio.tsx']) assert.match(read(`src/pages/${f}`), gated, f);
  // the manage page: nothing of the token before the gate, then the same notice
  const man = read('src/pages/Manage.tsx');
  assert.match(man, /launch === undefined \|\| !gate\.ready/);
  assert.match(man, /if \(gate\.blocked\(launch\)\) return <BlockedToken \/>;/);
  assert.ok(man.indexOf('gate.blocked(launch)') < man.indexOf('<TokenPic'), 'the picture comes after the gate');
  // a launch just made: no link, no symbol when blocked
  const la = read('src/pages/Launch.tsx');
  assert.match(la, /hidden by MINTA because it was reported/);
  assert.match(la, /gate\.blocked\(\{ token: done\.token, creator: account \?\? '' \}\)/);
});

test('the team\'s list is read again when the app returns to the foreground and every 30 minutes; a bad first file shows everything; the search waits for it', () => {
  const hid = read('src/components/Hidden.tsx');
  assert.match(hid, /visibilitychange/);
  assert.match(hid, /REFRESH_EVERY_MS = 30 \* 60 \* 1000/);
  assert.match(hid, /MIN_GAP_MS = 60 \* 1000/);
  assert.match(hid, /loaded = b \?\? NO_BLOCKS/, 'a first file that fails shows everything');
  assert.match(hid, /if \(b && JSON\.stringify\(b\) !== JSON\.stringify\(loaded\)\)/, 'a later failure keeps the last good list');
  assert.match(read('src/components/Search.tsx'), /ready \? visibleLaunches\(list, hidden, hiddenCreators, block\)\.filter/);
});

test('blocklist.json is served uncached; the release checks the live file; the checker accepts only the right shape', async () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find((h) => h.source === '/blocklist.json');
  assert.ok(rule && rule.headers.some((h) => h.key === 'Cache-Control' && h.value === 'no-cache, must-revalidate'));
  const rel = read('.github/workflows/android-release.yml');
  assert.match(rel, /curl -fsS --max-time 30 https:\/\/minta\.vyrechain\.com\/blocklist\.json/);
  assert.match(rel, /node android\/scripts\/check-blocklist\.mjs/);
  assert.match(rel, /name: Check the live blocklist file is valid\n\s+if: \$\{\{ !inputs\.first_upload \}\}/);
  const { problems } = await import('../android/scripts/check-blocklist.mjs');
  assert.deepEqual(problems(JSON.parse(read('public/blocklist.json'))), []);
  for (const bad of [null, [], 'x', { version: 2, tokens: [], creators: [] }, { version: 1, tokens: 'a', creators: [] }, { version: 1, tokens: ['0x1'], creators: [] }, { version: 1, tokens: [A, A], creators: [] }, { version: 1, tokens: [] }]) assert.ok(problems(bad).length > 0, JSON.stringify(bad));
  assert.ok(docs.includes('shows everything') && docs.includes('blocklist.json'), 'the docs say what a missing or invalid file does');
});

const docs = read('docs/ANDROID.md');

test('the notices after a launch hold back the token, its links and the redirect until the team\'s list has been read', () => {
  const la = read('src/pages/Launch.tsx');
  assert.match(la, /!gate\.ready\n\s+\? <p className="note small" role="status">Your launch went through\. One moment…<\/p>/, 'the "You launched" note');
  assert.match(la, /if \(!pageReady \|\| !gate\.ready \|\| stay \|\| !done \|\| doneBlocked\) return;/, 'the redirect');
  assert.match(la, /\[pageReady, gate\.ready, doneBlocked, stay, secs, done\]/);
  assert.match(la, /\{!gate\.ready\n\s+\? <p>Your token was made\. One moment…<\/p>/, 'the done panel');
  // no link to the token or its manage page sits before the gate in either place
  const from = la.indexOf('Your token was made. One moment');
  const done = la.slice(from, la.indexOf('See the transaction', from));
  assert.ok(done.indexOf('One moment') < done.indexOf("page: 'token'") && done.indexOf('hides it because') < done.indexOf("page: 'token'"));
});
