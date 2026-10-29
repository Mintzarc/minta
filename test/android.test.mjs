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
  const bullets = full.slice(full.indexOf('WHAT YOU CAN DO IN THIS APP'), full.indexOf("WHAT YOU DO IN YOUR WALLET APP'S BROWSER"));
  assert.equal(/\b(launch a token|trade|buy|sell|connect)\b/i.test(bullets), false, 'the in-app list names nothing that needs a wallet');
  assert.match(full, /This app cannot connect a wallet/);
  // screenshots: only screens that work in the app (no wizard, wallet page or trade panel), no NEW pill, no token picture first
  const vp = read('store/android/viewports.mjs');
  assert.equal(/name: 'launch'|name: 'wallet'/.test(vp), false);
  assert.match(vp, /name: 'docs'[\s\S]*name: 'explore'/, 'the docs front page comes before the token list');
  assert.match(read('store/android/make-screenshots.mjs'), /\.tk-tag \{ display: none/);
  assert.match(read('store/android/make-screenshots.mjs'), /\.trade-card \{ display: none/);
  assert.equal(/Launch and explore/.test(read('store/android/make-screenshots.mjs')), false, 'the feature graphic does not say the app launches');
});

test('the docs carry no business notes beyond MINTA\'s own facts', () => {
  assert.equal(/STAGR|your other app|your account has|older organi[sz]ation|Only One|VYRE team/i.test(docs), false);
});
