// Detecting MINTA's Android app (src/lib/twa.ts) and the note it shows where a wallet would be connected.
// What it must get right: the app is recognised by its referrer or by ?app=1 and remembered for the visit; anywhere else
// nothing is detected and nothing changes; the note says what the app cannot do, offers the one wallet link whose form is
// documented (Trust Wallet's) and no other wallet's deep link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function twa() {
  const js = ts.transpileModule(read('src/lib/twa.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', js)(() => { throw new Error('no imports'); }, module, module.exports, undefined, undefined);
  return module.exports;
}
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const { detectTwa, TRUST_WALLET_LINK, TWA_NOTE, SITE_URL } = twa();

test('the app is recognised by its referrer, or by ?app=1 on its start address, and remembered for the visit', () => {
  const a = memory();
  assert.equal(detectTwa('android-app://com.vyrechain.minta', '', a), true);
  assert.equal(a.m.get('minta.twa'), '1');
  assert.equal(detectTwa('', '', a), true, 'later pages have no referrer: the visit is remembered');
  const b = memory();
  assert.equal(detectTwa('', '?app=1', b), true);
  assert.equal(detectTwa('android-app://com.vyrechain.minta/', '', memory()), true);
});

test('nothing is detected anywhere else: a website, another app, another value, no storage', () => {
  for (const [ref, search] of [['', ''], ['https://www.google.com/', ''], ['android-app://com.example.other', ''], ['', '?app=0'], ['', '?app=true'], ['', '?x=app=1'], ['android-app://com.vyrechain.mintax', ''], ['android-app://com.vyrechain.minta.evil', '']]) {
    const s = memory();
    const r = detectTwa(ref, search, s);
    assert.equal(r, false, `${ref} ${search}`);
    assert.equal(s.m.size, 0, 'nothing is stored when nothing is detected');
  }
  assert.equal(detectTwa('', '', null), false);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(detectTwa('', '', broken), false);
  assert.equal(detectTwa('', '?app=1', broken), true, 'blocked storage does not stop detection');
});

test('the note says the app cannot connect wallets, and the only wallet link is Trust Wallet’s documented form', () => {
  assert.equal(TWA_NOTE, 'This app can’t connect wallets. Open minta.vyrechain.com in your wallet app’s browser.');
  assert.equal(TRUST_WALLET_LINK, 'https://link.trustwallet.com/open_url?coin_id=60&url=https://minta.vyrechain.com');
  assert.equal(SITE_URL, 'https://minta.vyrechain.com');
  const src = read('src/components/ui.tsx');
  assert.equal(/metamask\.app\.link|link\.metamask\.io|go\.cb-w\.com|rabby\.io\/dapp|wc:/i.test(src), false, 'no other wallet deep link');
  assert.match(src, /Copy link/);
  assert.match(src, /Open in Trust Wallet/);
});

test('the note appears only inside the app: in the connect menu, and under the button on the Launch, Token and other pages', () => {
  const src = read('src/components/ui.tsx');
  assert.match(src, /\{IS_TWA && available\.length === 0 && <TwaNote \/>\}/);
  assert.match(src, /\{IS_TWA && !header && available\.length === 0 && <TwaNote \/>\}/);
  assert.match(src, /\{!IS_TWA && available\.length === 0 && !FACE_ID_OFFERED && \(/, 'outside the app the old note is unchanged');
  for (const f of ['src/pages/Launch.tsx', 'src/pages/Token.tsx']) assert.match(read(f), /<ConnectButton \/>/, `${f} uses the connect button that carries the note`);
});

test('the Android app opens the site with ?app=1 so detection does not rest on the referrer', () => {
  const m = read('android/app/src/main/AndroidManifest.xml');
  assert.match(m, /DEFAULT_URL"\s+android:value="https:\/\/minta\.vyrechain\.com\/\?app=1"/);
  const sc = read('android/app/src/main/res/xml/shortcuts.xml');
  for (const d of sc.match(/android:data="[^"]+"/g)) assert.match(d, /\?app=1/);
});
