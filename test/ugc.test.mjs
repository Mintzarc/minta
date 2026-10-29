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

test('hidden tokens are left out of Explore, the top list and the search; a hidden list that is empty changes nothing', () => {
  const { withoutHidden } = load('src/lib/hidden.ts');
  const rows = [{ token: A }, { token: B }, { token: C }];
  assert.equal(withoutHidden(rows, []), rows, 'the same list when nothing is hidden');
  assert.deepEqual(withoutHidden(rows, [B.toLowerCase()]), [{ token: A }, { token: C }]);
  assert.match(read('src/pages/Explore.tsx'), /withoutHidden\(all, hidden\)/);
  assert.match(read('src/components/Search.tsx'), /withoutHidden\(list, hidden\)/);
  assert.match(read('src/pages/Explore.tsx'), /className="linkish small hide-card" onClick=\{\(\) => hide\(l\.token\)\}/);
  assert.match(read('src/pages/Token.tsx'), /<HideToken token=\{launch\.token\} \/>/);
  assert.match(read('src/pages/Wallet.tsx'), /<HiddenNote \/>/);
  assert.match(read('src/pages/Explore.tsx'), /<HiddenNote \/>/);
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
