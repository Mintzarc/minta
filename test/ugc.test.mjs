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
  const tok = read('src/pages/Token.tsx');
  assert.match(tok, /\{mail && <>/);
});
