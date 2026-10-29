// The Android wrapper (android/, a Trusted Web Activity): what it says must match what docs/ANDROID.md tells the owner, the
// web side must carry what the wrapper needs (manifest, Digital Asset Links file and its header), the workflows must keep to
// pinned actions and read the key only from secrets, and nothing secret-like may sit in android/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const androidFiles = tracked.filter((f) => f.startsWith('android/'));
const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const docs = read('docs/ANDROID.md');
const PACKAGE = 'com.vyrechain.minta';
const SITE = 'https://minta.vyrechain.com';

test('the package name is the same in the build file, the manifest, the shortcuts, the workflows and the docs', () => {
  assert.match(gradle, /namespace 'com\.vyrechain\.minta'/);
  assert.match(gradle, /applicationId 'com\.vyrechain\.minta'/);
  assert.ok(manifest.includes(`${PACKAGE}.fileprovider`));
  assert.ok(read('android/app/src/main/res/xml/shortcuts.xml').includes(`targetPackage="${PACKAGE}"`));
  assert.ok(read('android/scripts/emulator-check.sh').includes(PACKAGE));
  assert.ok(docs.includes(PACKAGE));
});

test('targetSdk, minSdk and the first versionCode are what the docs say', () => {
  const target = Number(/targetSdk (\d+)/.exec(gradle)[1]);
  const compile = Number(/compileSdk (\d+)/.exec(gradle)[1]);
  const min = Number(/minSdk (\d+)/.exec(gradle)[1]);
  assert.ok(target >= 36, 'Google Play needs API 36 or higher for new apps from 31 August 2026');
  assert.ok(compile >= target);
  assert.ok(docs.includes(`target API ${target}`), 'docs name the target API level');
  assert.ok(docs.includes(`minimum API ${min}`), 'docs name the minimum API level');
  assert.match(gradle, /hasProperty\('mintaVersionCode'\) \? project\.property\('mintaVersionCode'\) : '1'/);
  assert.match(gradle, /hasProperty\('mintaVersionName'\) \? project\.property\('mintaVersionName'\) : '1\.0\.0'/);
  assert.ok(docs.includes('versionCode 1') && docs.includes('1.0.0'));
});

test('the app opens the live site, verifies its links, and asks for no permissions', () => {
  assert.ok(manifest.includes(`android:value="${SITE}/?app=1"`));
  assert.ok(manifest.includes('android:autoVerify="true"') && manifest.includes('android:host="minta.vyrechain.com"'));
  assert.ok(read('android/app/src/main/res/values/strings.xml').includes(`\\"site\\": \\"${SITE}\\"`));
  assert.equal(/<uses-permission/.test(manifest), false);
  assert.ok(gradle.includes('minifyEnabled false'));
  assert.equal(/ndk|externalNativeBuild|jniLibs/.test(gradle), false, 'no native code');
});

test('the web side carries what the wrapper needs: manifest icons, the links file and its header', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  const links = JSON.parse(read('public/.well-known/assetlinks.json'));
  assert.ok(Array.isArray(links));
  for (const l of links) {
    assert.deepEqual(l.relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(l.target.namespace, 'android_app');
    assert.equal(l.target.package_name, PACKAGE);
    assert.ok(l.target.sha256_cert_fingerprints.length >= 1);
    for (const f of l.target.sha256_cert_fingerprints) assert.match(f, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
  const vercel = JSON.parse(read('vercel.json'));
  const rule = vercel.headers.find((h) => h.source === '/.well-known/assetlinks.json');
  assert.ok(rule && rule.headers.some((h) => h.key === 'Content-Type' && h.value === 'application/json'));
});

test('nothing secret-like is in android/ (no key files, no stored passwords, no private key text)', () => {
  const bad = androidFiles.filter((f) => /\.(jks|keystore|p12|pem|key|properties)$/i.test(f) && !/gradle-wrapper\.properties$|gradle\.properties$/.test(f));
  assert.deepEqual(bad, []);
  const hits = [];
  for (const f of androidFiles.filter((f) => !/\.(png|jar)$/.test(f))) {
    const t = read(f);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) hits.push(`${f}: private key`);
    if (/(storePassword|keyPassword)\s+['"][^'"]+['"]/.test(t)) hits.push(`${f}: literal password`);
    if (/(password|secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{8,}['"]/i.test(t)) hits.push(`${f}: secret-like value`);
  }
  assert.deepEqual(hits, []);
  assert.match(gradle, /System\.getenv\('MINTA_KEYSTORE_PASSWORD'\)/);
});

test('the workflows pin every action to a full commit, use only the allowed ones, and read the key only from secrets', () => {
  const allowed = new Set(['gradle/actions/wrapper-validation', 'actions/checkout', 'actions/setup-java', 'actions/setup-node', 'actions/upload-artifact', 'android-actions/setup-android', 'reactivecircus/android-emulator-runner']);
  for (const f of ['android-release.yml', 'android-debug.yml', 'android-emulator.yml']) {
    const t = read(`.github/workflows/${f}`);
    const uses = [...t.matchAll(/uses:\s*(\S+)@(\S+)/g)];
    assert.ok(uses.length >= 2, f);
    for (const [, name, ref] of uses) {
      assert.ok(allowed.has(name), `${f}: ${name} is not an allowed action`);
      assert.match(ref, /^[0-9a-f]{40}$/, `${f}: ${name} is not pinned by commit`);
    }
    assert.match(t, /permissions:\s*\n\s+contents: read/);
    assert.equal(/secrets\.[A-Z0-9_]+/.test(t) && f !== 'android-release.yml', false, `${f} must not use secrets`);
  }
  const rel = read('.github/workflows/android-release.yml');
  assert.match(rel, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.equal(/\n\s+(push|pull_request):/.test(rel), false, 'the release runs by hand only');
  const names = [...rel.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']);
  assert.equal(/echo[^\n]*(KEYSTORE_BASE64|PASSWORD|KEY_PASSWORD)/.test(rel), false, 'no step prints a secret');
  assert.equal(/set -x|xtrace/.test(rel), false);
  for (const s of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) assert.ok(docs.includes(s), `docs name ${s}`);
});

test('the store listing text fits Play\'s limits and keeps to the wording rules', () => {
  const short = read('store/android/short-description.txt').trim();
  const full = read('store/android/full-description.txt').trim();
  assert.ok(short.length > 0 && short.length <= 80, `short description is ${short.length}`);
  assert.ok(full.length > 0 && full.length <= 4000, `full description is ${full.length}`);
  const all = `${short}\n${full}`;
  for (const w of [/layer ?2/i, /\bon Arc\b/i, /trustless/i, /\baudited\b/i, /instant withdraw/i, /cheapest/i, /airdrop/i, /guaranteed/i, /\bfree\b/i, /\bbest\b/i, /#1/, /\btop\b/i]) assert.equal(w.test(all), false, `banned wording ${w}`);
  assert.match(full, /not affiliated with or endorsed by Circle/);
  assert.match(full, /fall to zero|lose (all|everything)|can lose/i);
});

test('the Gradle wrapper is pinned by checksum and every workflow validates it', () => {
  const props = read('android/gradle/wrapper/gradle-wrapper.properties');
  assert.match(props, /distributionSha256Sum=[0-9a-f]{64}/);
  assert.ok(props.includes('gradle-8.14.3-bin.zip'));
  for (const f of ['android-release.yml', 'android-debug.yml', 'android-emulator.yml']) assert.match(read(`.github/workflows/${f}`), /gradle\/actions\/wrapper-validation@[0-9a-f]{40}/, f);
});

test('the release runs in the android-release environment, and refuses to build unless the site names the Play key (RELEASE_CHECK=1)', () => {
  const rel = read('.github/workflows/android-release.yml');
  assert.match(rel, /environment: android-release/);
  assert.match(rel, /RELEASE_CHECK=1 node --test test\/android\.test\.mjs/);
  assert.match(rel, /first_upload/);
  assert.ok(docs.includes('android-release') && docs.includes('first_upload'));
});

// Run with RELEASE_CHECK=1 (the release workflow does): the links file must carry the Play app-signing fingerprint
test('RELEASE_CHECK: assetlinks.json names com.vyrechain.minta with at least one SHA-256 fingerprint', { skip: !process.env.RELEASE_CHECK && 'only with RELEASE_CHECK=1' }, () => {
  const links = JSON.parse(read('public/.well-known/assetlinks.json'));
  assert.ok(links.length >= 1, 'public/.well-known/assetlinks.json is empty: paste the Play app signing key fingerprint first (docs/ANDROID.md step 9), or tick first_upload for the very first upload');
  for (const l of links) {
    assert.equal(l.target.package_name, PACKAGE);
    assert.ok(l.target.sha256_cert_fingerprints.length >= 1);
  }
});

test('the listing says first, plainly, what the app does and does not do, and lists only what works in it', () => {
  const full = read('store/android/full-description.txt');
  assert.ok(full.startsWith("In this app you can browse, read and report. To launch or trade, open minta.vyrechain.com in your wallet app's browser."));
  assert.match(read('store/android/short-description.txt'), /wallet/);
  assert.match(full, /nothing can remove[^.]*\./i);
  assert.match(full, /may buy part of the supply/);
  assert.match(full, /not a safety guarantee/);
  const bullets = full.slice(full.indexOf('WHAT YOU CAN DO IN THIS APP'), full.indexOf("WHAT YOU DO IN YOUR WALLET APP'S BROWSER"));
  assert.equal(/\b(launch a token|trade|buy|sell|connect)\b/i.test(bullets), false, 'the in-app list names nothing that needs a wallet');
  assert.match(full, /This app cannot connect a wallet/);
  // screenshots: only unmodified screens or clips of them that work in the app; no style injected to hide anything
  const vp = read('store/android/viewports.mjs');
  const names = [...vp.matchAll(/name: '([a-z-]+)'/g)].map((m) => m[1]);
  assert.equal(names.filter((n) => /^(launch|wallet|explore|token|create|portfolio)$/.test(n)).length, 0, 'no wizard, wallet, token-list or token-picture screen');
  const mk = read('store/android/make-screenshots.mjs');
  assert.equal(/addStyleTag|display: none|hideTrade/.test(mk + vp.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'no style is injected');
  assert.match(mk, /clip/);
  assert.equal(/Launch and explore/.test(mk), false, 'the feature graphic does not say the app launches');
  // at least four pictures in every set (Play: 4 or more for large screens)
  for (const set of ['phone', 'tablet7', 'tablet10', 'desktop']) {
    const n = [...vp.matchAll(/\{ name: '[a-z-]+'[^}]*\}/g)].filter((m) => { const sets = /sets: \[([^\]]*)\]/.exec(m[0]); return !sets || sets[1].includes(`'${set}'`); }).length;
    assert.ok(n >= 4, `${set} has ${n} pictures`);
  }
});

test('the docs carry no business notes beyond MINTA\'s own facts', () => {
  assert.equal(/STAGR|your other app|your account has|older organi[sz]ation|Only One|VYRE team/i.test(docs), false);
});

test('the release workflow warns visibly when the links check is skipped, really fails on a bad bundle, and always removes the decoded key', () => {
  const rel = read('.github/workflows/android-release.yml');
  assert.match(rel, /::warning title=Digital Asset Links check skipped::/);
  assert.match(rel, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.equal(/jarsigner[^\n]*\|\s*head/.test(rel), false, 'the signature check is not piped to head');
  assert.match(rel, /grep -q "jar verified"/);
  assert.match(rel, /name: Remove the decoded key file\n\s+if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/upload\.keystore"/);
  assert.equal((rel.match(/rm -f/g) || []).length, 1, 'one removal, in the always() step');
  assert.ok(docs.includes('`main` only') && docs.includes('Merge `android` into `main`'), 'the docs restrict the environment to main and say to merge first');
});

test('the shortcuts are named for what the app does (no "Launch" label) and the docs list the exported components', () => {
  const strings = read('android/app/src/main/res/values/strings.xml');
  assert.equal(/Launch a token/.test(strings + docs), false);
  assert.match(strings, /Explore tokens/);
  for (const c of ['LauncherActivity', 'ShortcutTrampolineActivity', 'ProfileInstallReceiver']) assert.ok(docs.includes(c), `docs list ${c}`);
});

// ---- the store files: sizes, ratios, descriptions, alt text ----
function imageSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kind: 'png', colorType: b[25] };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), kind: 'jpeg', components: b[i + 9] };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`no size in ${file}`);
}
const storeImages = tracked.filter((f) => /^store\/android\/.+\.(jpg|png)$/.test(f) && fs.existsSync(path.join(ROOT, f)));

test('the store pictures meet Play\'s size rules: sets of at least four, ratios up to 2:1, large screens 1,080-7,680 px and exactly 16:9 or 9:16, JPEG without alpha, under 8 MB', () => {
  for (const f of storeImages) {
    assert.ok(fs.statSync(path.join(ROOT, f)).size < 8 * 1024 * 1024, `${f} is under 8 MB`);
  }
  const icon = imageSize('store/android/icon-512.png');
  assert.deepEqual([icon.w, icon.h, icon.colorType], [512, 512, 6], 'icon: 512 x 512, 32-bit with alpha');
  assert.ok(fs.statSync(path.join(ROOT, 'store/android/icon-512.png')).size < 1024 * 1024);
  const fg = imageSize('store/android/feature-graphic.jpg');
  assert.deepEqual([fg.w, fg.h, fg.kind, fg.components], [1024, 500, 'jpeg', 3], 'feature graphic: 1024 x 500 JPEG, no alpha');
  const sets = { phone: [], 'tablet-7in': [], 'tablet-10in': [], desktop: [] };
  for (const f of storeImages) { const d = f.split('/')[2]; if (sets[d]) sets[d].push(f); }
  for (const [d, files] of Object.entries(sets)) {
    assert.ok(files.length >= 4 && files.length <= 8, `${d} has ${files.length} pictures (4 to 8)`);
    for (const f of files) {
      const s = imageSize(f);
      assert.equal(s.kind, 'jpeg'); assert.equal(s.components, 3, `${f}: no alpha`);
      const long = Math.max(s.w, s.h), short = Math.min(s.w, s.h);
      assert.ok(long <= 2 * short + 1, `${f}: ${s.w}x${s.h} is longer than 2:1`);
      assert.ok(long <= (d === 'phone' ? 3840 : 7680) && short >= (d === 'phone' ? 320 : 1080), `${f}: ${s.w}x${s.h} outside Play's pixel limits`);
      if (d === 'tablet-10in' || d === 'desktop') assert.ok(Math.abs(s.w * 9 - s.h * 16) <= 16, `${f}: ${s.w}x${s.h} is not 16:9`);
      if (d === 'tablet-7in') assert.ok(s.h >= s.w, `${f}: portrait`);
    }
  }
  for (const f of sets['tablet-7in'].concat(sets.phone).filter((f) => /agents|terms/.test(f))) { const s = imageSize(f); if (/tablet-7in/.test(f)) assert.ok(Math.abs(s.w * 16 - s.h * 9) <= 16 * 2, `${f}: 9:16`); }
});

test('the short description is at most 80 bytes with no trailing newline; every graphic has alt text', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'store/android/short-description.txt'));
  assert.ok(buf.length > 0 && buf.length <= 80, `short description is ${buf.length} bytes`);
  assert.notEqual(buf[buf.length - 1], 10, 'no trailing newline');
  assert.equal(buf.every((c) => c < 128), true, 'plain ASCII, so characters equal bytes');
  const alt = read('store/android/alt-text.txt').split('\n').filter((l) => l && !l.startsWith('#'));
  const described = new Set(alt.map((l) => l.slice(0, l.indexOf(':'))));
  for (const f of storeImages) assert.ok(described.has(f.replace('store/android/', '')), `alt text for ${f}`);
  for (const l of alt) assert.ok(l.length > 40 && l.length < 500, l.slice(0, 40));
});

test('key files of any spelling stay out of git (.gitignore), and the description says what the network services see', () => {
  for (const name of ['upload.jks', 'minta-upload.keystore', 'x.keystore.bak', 'key.p12', 'key.pfx']) {
    let ignored = true;
    try { execFileSync('git', ['check-ignore', '-q', name], { cwd: ROOT }); } catch { ignored = false; }
    assert.ok(ignored, `${name} is ignored`);
  }
  assert.match(read('store/android/full-description.txt'), /see your IP address when it loads data/);
  assert.equal(/no tracking\b(?! cookies)/i.test(read('store/android/full-description.txt')), false, 'no bare "no tracking"');
});
