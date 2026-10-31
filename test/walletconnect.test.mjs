// WalletConnect (src/lib/wcstate.ts, wc.ts): the connection's states, the guards before anything is signed, the plain words, the one
// wallet link whose form is documented, the packages it installs (pinned, no install scripts, no modal, no telemetry), the content
// policy hosts, and the privacy wording. The flow in a browser is test/walletconnect.browser.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function load(file) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(() => { throw new Error('no imports'); }, module, module.exports);
  return module.exports;
}
const W = load('src/lib/wcstate.ts');
const URI = `wc:${'ab'.repeat(32)}@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
// the address the library really produced when it was run against the relay from this machine
const REAL = 'wc:cc5b33718ac5fd1b92b23e29e27dc2dbf55e94a794bd7444acfbcf424a318e84@2?expiryTimestamp=1793462181&relay-protocol=irn&symKey=3a99c818e65d9471699fb3702396ffc495180295f33651f6d12ea92c0b7685da';
const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

test('the project ID is the public one by default; a build setting is used only if it is 32 hex characters', () => {
  assert.equal(W.WC_PROJECT_ID_DEFAULT, '89d7a1882c0fa9a5bbe0a58accafc100');
  assert.equal(W.wcProjectId(undefined), W.WC_PROJECT_ID_DEFAULT);
  assert.equal(W.wcProjectId(''), W.WC_PROJECT_ID_DEFAULT);
  assert.equal(W.wcProjectId('0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef');
  for (const odd of ['xyz', '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcde', 'a'.repeat(33), 5, null, '89d7a1882c0fa9a5bbe0a58accafc100/../']) assert.equal(W.wcProjectId(odd), W.WC_PROJECT_ID_DEFAULT, String(odd));
  assert.match(read('src/lib/wc.ts'), /wcProjectId\(import\.meta\.env\.VITE_WALLETCONNECT_PROJECT_ID\)/);
});

test('only a real pairing address is drawn or put in a link', () => {
  assert.equal(W.isWcUri(URI), true);
  assert.equal(W.isWcUri(REAL), true, 'the form the library produces');
  for (const bad of ['', 'https://evil.example/?x=wc:', `javascript:alert(1)`, `wc:${'ab'.repeat(31)}@2?x=1`, `wc:${'ab'.repeat(32)}@1?x=1`, `${URI}"onload="x`, `${URI} `, `${URI}<`, `wc:${'ab'.repeat(32)}@2?` + 'a'.repeat(2000), null, undefined, 5, {}]) assert.equal(W.isWcUri(bad), false, String(bad).slice(0, 40));
  assert.equal(W.trustWalletWcLink(URI), `https://link.trustwallet.com/wc?uri=${encodeURIComponent(URI)}`);
  assert.equal(W.trustWalletWcLink('https://evil.example'), null);
  assert.equal(W.trustWalletWcLink(`${URI}#frag`), null, 'a fragment is not part of a pairing address');
});

test('the connection’s states: a second tap changes nothing, a late answer after cancelling is dropped, a failure can be retried', () => {
  const s0 = { kind: 'idle' };
  const s1 = W.wcNext(s0, { type: 'start' });
  assert.equal(s1.kind, 'starting');
  assert.equal(W.wcNext(s1, { type: 'start' }), s1, 'a double tap while starting');
  const s2 = W.wcNext(s1, { type: 'uri', uri: URI });
  assert.deepEqual(s2, { kind: 'waiting', uri: URI });
  assert.equal(W.wcNext(s2, { type: 'start' }), s2, 'a tap while waiting');
  assert.equal(W.wcNext(s1, { type: 'uri', uri: 'https://evil.example' }), s1, 'an address that is not a pairing address is not shown');
  assert.equal(W.wcNext(s0, { type: 'uri', uri: URI }), s0, 'an address after cancelling is dropped');
  assert.equal(W.wcNext(s0, { type: 'approved', account: ME }).kind, 'idle', 'an approval with nothing under way (cancelled) connects nothing');
  assert.equal(W.wcNext(s2, { type: 'cancel' }).kind, 'idle');
  assert.equal(W.wcNext(s1, { type: 'cancel' }).kind, 'idle');
  const c = W.wcNext(s2, { type: 'approved', account: ME });
  assert.deepEqual(c, { kind: 'connected', account: ME });
  assert.equal(W.wcNext(c, { type: 'cancel' }), c, 'cancelling never ends a live connection');
  assert.equal(W.wcNext(c, { type: 'start' }), c, 'a tap while connected');
  assert.equal(W.wcNext(c, { type: 'disconnect' }).kind, 'idle');
  const f = W.wcNext(s2, { type: 'fail', why: 'rejected' });
  assert.equal(f.kind, 'failed');
  assert.equal(f.message, W.wcMessage('rejected'));
  assert.equal(W.wcNext(f, { type: 'start' }).kind, 'starting', 'Try again');
  assert.equal(W.wcNext(f, { type: 'cancel' }).kind, 'idle', 'Close');
  assert.equal(W.wcNext(s0, { type: 'fail', why: 'relay' }), s0, 'a failure after cancelling is dropped');
});

test('errors from the library and wallets are sorted into plain failures', () => {
  const k = (e) => W.classifyWcError(e);
  assert.equal(k(Object.assign(new Error('User rejected.'), { code: 5000 })), 'rejected');
  assert.equal(k({ code: 4001, message: 'x' }), 'rejected');
  assert.equal(k(new Error('User denied transaction signature')), 'rejected');
  assert.equal(k(new Error('Proposal expired')), 'expired');
  assert.equal(k(new Error('Non conforming namespaces. approve() namespaces chains')), 'chain');
  assert.equal(k({ code: 5100, message: 'Unsupported chains' }), 'chain');
  assert.equal(k(new Error('Unrecognized chain ID "0xbe5". Try adding the chain')), 'chain');
  assert.equal(k(new Error('WebSocket connection failed for URL: wss://relay.walletconnect.org')), 'relay');
  assert.equal(k(new Error('Socket stalled when trying to connect to wss://relay.walletconnect.org')), 'relay');
  assert.equal(k(new Error('Failed to fetch')), 'relay');
  assert.equal(k(new Error('request timed out')), 'timeout');
  assert.equal(k({ message: 'x', cause: { message: 'User rejected the request', code: 4001 } }), 'rejected', 'a cause is read too');
  assert.equal(k(new Error('something odd')), 'other');
  assert.equal(k(undefined), 'other');
  assert.equal(k('boom'), 'other');
  for (const why of ['rejected', 'relay', 'timeout', 'chain', 'expired', 'closed', 'other']) assert.ok(W.wcMessage(why).length > 20, why);
  assert.match(W.wcMessage('chain'), /https:\/\/vyrechain\.com\/add\//);
  assert.match(W.wcMessage('relay'), /minta\.vyrechain\.com in your wallet app’s own browser/);
});

test('before a signature: on VYRE’s chain, the account still listed, not expired; any other state refuses', () => {
  const now = 1_800_000_000_000;
  const good = { wantChain: 3045, chainId: '0xbe5', account: ME, accounts: [ME], now };
  assert.equal(W.wcLiveCheck(good).ok, true);
  assert.equal(W.wcLiveCheck({ ...good, chainId: 3045 }).ok, true, 'a number');
  assert.equal(W.wcLiveCheck({ ...good, chainId: '3045' }).ok, true, 'decimal text');
  assert.equal(W.wcLiveCheck({ ...good, accounts: [ME.toLowerCase()] }).ok, true, 'case of the address does not matter');
  assert.equal(W.wcLiveCheck({ ...good, expiry: now / 1000 + 5 }).ok, true);
  const refused = (f, why) => { const r = W.wcLiveCheck(f); assert.equal(r.ok, false); assert.equal(r.why, why); assert.ok(r.message.length > 20); return r; };
  assert.match(refused({ ...good, chainId: '0x1' }, 'chain').message, /vyrechain\.com\/add/);
  refused({ ...good, chainId: '0x7357' }, 'chain');
  refused({ ...good, chainId: null }, 'chain');
  refused({ ...good, chainId: 'garbage' }, 'chain');
  refused({ ...good, chainId: 3045.5 }, 'chain');
  refused({ ...good, accounts: ['0x90F79bf6EB2c4f870365E785982E1f101E93b906'] }, 'other');
  refused({ ...good, accounts: [ME] , account: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' }, 'other');
  refused({ ...good, accounts: [] }, 'other');
  refused({ ...good, accounts: null }, 'other');
  refused({ ...good, accounts: [5, {}] }, 'other');
  refused({ ...good, expiry: now / 1000 - 1 }, 'expired');
  refused({ ...good, expiry: now / 1000 }, 'expired');
});

test('a saved session is restored only if it lists an account on VYRE and has not ended', () => {
  const now = 1_800_000_000_000, later = now / 1000 + 1000;
  assert.equal(W.sessionHasAccount([`eip155:3045:${ME}`], 3045, later, now), ME);
  assert.equal(W.sessionHasAccount([`eip155:1:${ME}`, `eip155:3045:${ME}`], 3045, later, now), ME);
  assert.equal(W.sessionHasAccount([`eip155:1:${ME}`], 3045, later, now), null, 'another chain only');
  assert.equal(W.sessionHasAccount([`eip155:3045:${ME}`], 3045, now / 1000 - 1, now), null, 'ended');
  assert.equal(W.sessionHasAccount([`eip155:3045:${ME}`], 3045, undefined, now), null, 'no end time');
  assert.equal(W.sessionHasAccount([`eip155:30450:${ME}`, `eip155:3045:0x123`, 'junk', 5], 3045, later, now), null);
  assert.equal(W.sessionHasAccount(undefined, 3045, later, now), null);
  assert.equal(W.sessionHasAccount('eip155:3045:' + ME, 3045, later, now), null);
});

test('the library is the universal provider, pinned exactly, with no install script, no modal and no usage reporting', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['@walletconnect/universal-provider'], '2.26.0');
  assert.equal(pkg.dependencies['qrcode-generator'], '2.0.4');
  for (const [n, v] of Object.entries(pkg.dependencies)) assert.match(v, /^(\d+\.\d+\.\d+|file:vendor\/[\w.-]+\.tgz)$/, `${n} is pinned exactly`);
  const lock = JSON.parse(read('package-lock.json'));
  const pk = lock.packages;
  assert.equal(pk['node_modules/@walletconnect/universal-provider'].version, '2.26.0');
  assert.equal(pk['node_modules/qrcode-generator'].version, '2.0.4');
  const wcPackages = Object.keys(pk).filter((k) => /node_modules\/(@walletconnect|@reown)\//.test(k));
  assert.ok(wcPackages.length > 10);
  assert.equal(wcPackages.some((k) => /@reown\/appkit|ethereum-provider|web3modal|walletconnect\/modal|walletkit|walletconnect\/web3wallet/.test(k)), false, 'no modal and no wallet-side packages');
  for (const [k, v] of Object.entries(pk)) {
    if (!k) continue;
    if (/node_modules\/(@walletconnect|@reown|qrcode-generator)/.test(k) || (v.resolved && !k.includes('@vyrechain'))) {
      if (k.startsWith('node_modules/@vyrechain')) continue;
      assert.match(v.integrity || '', /^sha512-/, `${k} has an integrity hash`);
    }
  }
  const scripted = Object.entries(pk).filter(([k, v]) => v.hasInstallScript && /@walletconnect|@reown|qrcode-generator|\/(pino|ws|h3|ofetch|unstorage|es-toolkit)\b/.test(k)).map(([k]) => k);
  assert.deepEqual(scripted, [], 'none of the connection’s packages runs an install script');
  // the library is started with its usage reporting off, only when someone picks WalletConnect, and with MINTA's own relay address
  const wc = read('src/lib/wc.ts');
  assert.match(wc, /telemetryEnabled: false/);
  assert.match(wc, /await import\('@walletconnect\/universal-provider'\)/, 'loaded on demand');
  assert.equal(/^import .*@walletconnect/m.test(wc + read('src/lib/wallet.tsx') + read('src/components/WalletConnectSheet.tsx')), false, 'never imported at the top of a file');
  assert.match(wc, /relayUrl: WC_RELAY_URL/);
  assert.equal(/pulse\.walletconnect|echo\.walletconnect|verify\.walletconnect|rpc\.walletconnect/.test(read('src/lib/wc.ts') + read('src/lib/wcstate.ts')), false, 'no other WalletConnect host is named in MINTA’s code');
  assert.equal(/walletconnect\.(?:com|org)\/(?:modal|api|explorer)|explorer-api\.walletconnect/.test(wc), false, 'no wallet list is fetched');
  assert.equal(/^(?!.*\/\/).*\bwindow\.ethereum\b/m.test(wc), false);
});

test('the content policy allows the relay’s secure WebSocket and nothing broader', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  const dir = (name) => (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name} `)) || '').split(/\s+/).slice(1);
  assert.deepEqual(dir('connect-src'), ["'self'", 'https:', 'wss://relay.walletconnect.org']);
  assert.equal(csp.includes('wss:'.concat(' ')) || /wss:(?!\/\/)/.test(csp), false, 'no bare wss:');
  assert.equal(/\*/.test(csp), false, 'no wildcard');
  assert.deepEqual(dir('frame-src'), ['https://pw-auth.circle.com', 'https://verify.walletconnect.org'], 'one frame host for WalletConnect: the library opens its verification frame for every connect and sign request (read from its code and seen in a browser)');
  assert.deepEqual(dir('img-src'), ["'self'", 'https:', 'data:'], 'unchanged: the sheet draws its code itself');
  assert.deepEqual(dir('script-src'), ["'self'"]);
  assert.equal(csp.includes("'unsafe-eval'"), false);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  const w = read('src/lib/wcstate.ts');
  assert.match(w, /WC_RELAY_URL = `wss:\/\/\$\{WC_RELAY_HOST\}`/);
  assert.match(w, /WC_RELAY_HOST = 'relay\.walletconnect\.org'/);
});

test('only Trust Wallet has a deep link, in its documented form; no other wallet’s scheme is used', () => {
  const src = ['src/lib/wc.ts', 'src/lib/wcstate.ts', 'src/components/WalletConnectSheet.tsx', 'src/components/ui.tsx', 'src/lib/wallet.tsx'].map(read).join('\n');
  assert.equal(/metamask\.app\.link|link\.metamask\.io|metamask:\/\/|rainbow:\/\/|rnbwapp\.com|go\.cb-w\.com|cbwallet:\/\/|rabby\.io\/dapp|zerion|ledgerlive|phantom\.app|okx:\/\/|trust:\/\//i.test(src), false);
  assert.match(read('src/lib/wcstate.ts'), /https:\/\/link\.trustwallet\.com\/wc\?uri=\$\{encodeURIComponent\(uri\)\}/);
  assert.match(read('src/components/WalletConnectSheet.tsx'), /Another wallet app: copy the link/);
});

test('the connection is for VYRE alone: one chain asked for, a session without an account on it refused, other chains refused', () => {
  const wc = read('src/lib/wc.ts');
  assert.match(wc, /const CHAIN_ID = VYRE_CHAIN\.id/);
  assert.match(wc, /chains: \[CAIP\]/);
  assert.equal((wc.match(/chains:/g) || []).length, 1, 'one chain list');
  assert.match(wc, /if \(!vyreAccount\(p\)\) \{ await p\.disconnect\?\.\(\)\.catch\(\(\) => \{\}\); throw new WcError\('chain'\); \}/);
  assert.match(wc, /wallet_switchEthereumChain/);
  assert.match(wc, /\(raw\.request as .*\)\(args, CAIP\)/, 'a request names the chain it is for');
  assert.match(read('src/lib/chain.ts'), /isMintaWalletConnect === true && chain\.id !== VYRE_CHAIN\.id/);
  const chain = read('src/lib/wallet.tsx');
  assert.match(chain, /assertWcLive\(current\.provider\)/);
});

test('wording: the privacy page, terms and listing say what WalletConnect sees, and no page says there is no tracking', () => {
  const priv = read('public/privacy/index.html');
  assert.match(priv, /relay\.walletconnect\.org/);
  assert.match(priv, /sees your IP address, MINTA’s WalletConnect project ID and the pairing/);
  assert.match(priv, /Portions &copy; 2025 Reown, Inc\. All Rights Reserved/);
  assert.match(priv, /href="\/licenses\/walletconnect\.txt"/);
  assert.match(priv, /verify\.walletconnect\.org/);
  assert.match(priv, /MINTA turns off the library’s usage reporting/);
  assert.match(priv, /Nothing is sent to WalletConnect if you don’t pick it/);
  assert.match(priv, /and so does the WalletConnect service if you connect a wallet with it/);
  assert.equal(/no tracking\b(?! cookies)/i.test(priv), false, 'no bare "no tracking"');
  assert.match(priv, /There are no accounts, no ads, no analytics and no tracking cookies/);
  const lic = read('public/licenses/walletconnect.txt');
  assert.ok(lic.startsWith('Portions © 2025 Reown, Inc. All Rights Reserved'));
  assert.match(lic, /WALLETCONNECT COMMUNITY LICENSE AGREEMENT/);
  assert.match(read('public/terms/index.html'), /A wallet app connected with WalletConnect/);
  const store = read('docs/ANDROID.md');
  assert.match(store, /WalletConnect relay \(relay\.walletconnect\.org\) and verification service \(verify\.walletconnect\.org/);
  assert.match(store, /Not tested: a real wallet app/);
  // nothing in the pages promises what a wallet app will do
  const all = [priv, read('public/terms/index.html'), read('store/android/full-description.txt'), read('src/components/WalletConnectSheet.tsx'), read('src/lib/wcstate.ts')].join('\n');
  for (const w of [/layer ?2/i, /trustless/i, /\baudited\b/i, /instant withdraw/i, /cheapest/i, /decentrali[sz]ed/i, /airdrop/i]) assert.equal(w.test(all), false, String(w));
});

test('the testnet privacy page stays true: no bare “no tracking”, no Google Fonts claim, and WalletConnect is named', () => {
  // the same app code (WalletConnect, self-hosted fonts) ships in a testnet build; its privacy page must not contradict that
  const priv = read('public/privacy-testnet/index.html');
  assert.equal(/no tracking\b(?! cookies)/i.test(priv), false, 'no bare "no tracking"');
  assert.equal(/Google Fonts/i.test(priv), false, 'fonts are served from this site, not Google');
  assert.match(priv, /fonts are served from this site|from this same site/i);
  assert.match(priv, /relay\.walletconnect\.org/);
  assert.match(priv, /verify\.walletconnect\.org/);
  assert.match(priv, /WalletConnect/);
});

test('privacy and the Play data-safety text name the IPFS gateway the pages actually ask', () => {
  // src/lib/market.ts turns ipfs:// into https://ipfs.io/ipfs/… before fetch; that host must be disclosed
  assert.match(read('src/lib/market.ts'), /https:\/\/ipfs\.io\/ipfs\//);
  assert.match(read('public/privacy/index.html'), /ipfs\.io/);
  assert.match(read('docs/ANDROID.md'), /ipfs\.io/);
});

test('the connect sheet and the buttons: the sheet names no remote picture, the code is drawn as one path, the menu offers WalletConnect', () => {
  const sheet = read('src/components/WalletConnectSheet.tsx');
  assert.equal(/<img|dangerouslySetInnerHTML|innerHTML/.test(sheet), false);
  assert.match(sheet, /<path d=\{d\}/);
  assert.match(sheet, /isWcUri|trustWalletWcLink\(uri\)/);
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /onClick=\{\(\) => \{ setOpen\(false\); connectWalletConnect\(\); \}\}>WalletConnect/);
  assert.match(read('src/App.tsx'), /<WalletConnectSheet \/>/);
});
