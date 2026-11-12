// Checks kept from a review of the app: how a typed amount is read, when a sent transaction may be given up on, a tax wallet that
// is a contract, tokens whose names read as USDC, MINTA or VYRE, a hidden creator's tokens after a handover, the page's headers,
// and the words of the Wallet and Manage pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { amountProblem, exact, lookalikeNote, parse, plainLook, readAs, tickerText, tokenText } from '../src/lib/format.ts';
import { START_OVER_AFTER_MS, mayStartOver, receiptNotFound } from '../src/lib/held.ts';
import { codeKey, taxWalletsWithCode } from '../src/lib/taxsplit.ts';
import { NO_BLOCKS, isHidden, setFirstCreators, visibleFeed, visibleLaunches } from '../src/lib/hidden.ts';
import { TransactionReceiptNotFoundError } from 'viem';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ---- a typed amount ----
test('"0,125" is never read as 125: a grouped number can’t start with a group of 0, and the page says to use a point', () => {
  for (const s of ['0,125', '00,125', '0,125.5', '000,125', '0,000']) {
    assert.equal(parse(s), null, s);
    assert.ok(amountProblem(s), s);
  }
  assert.match(amountProblem('0,125'), /Use a point for decimals, like 0\.125\./);
  // what was read before still is
  assert.equal(exact(parse('1,000.5')), '1,000.5');
  assert.equal(exact(parse('12,345,678')), '12,345,678');
  assert.equal(exact(parse('0.125')), '0.125');
  assert.equal(exact(parse('125')), '125');
  for (const s of ['1,5', '1,00', ',125', '1,0000', '1,000,5']) assert.equal(parse(s), null, s);
});

test('when a comma was typed, the box says how the amount was read; without one (or unread) it says nothing', () => {
  assert.equal(readAs('1,000.5'), 'read as 1,000.5');
  assert.equal(readAs(' 12,345 '), 'read as 12,345');
  assert.equal(readAs('1,000.000000000000000001'), 'read as 1,000.000000000000000001');
  for (const s of ['', '1000.5', '0,125', '1,5', 'abc', '12.5']) assert.equal(readAs(s), '', s);
});

test('every amount box shows it: buy and sell, send, deposit, withdraw, send back, and the dev buy', () => {
  const wallet = read('src/pages/Wallet.tsx');
  // each USDC amount box on the Wallet page is followed by its "read as" line, for the same value
  const boxes = [...wallet.matchAll(/<input[^\n]*inputMode="decimal" value=\{(amountIn|shown)\}[^\n]*<\/label>\n\s*<ReadAs input=\{(\w+)\} \/>/g)];
  assert.equal(boxes.length, 6, 'move to VYRE, from another chain, send back, move to Arc, send, send to Arc');
  for (const b of boxes) assert.equal(b[1], b[2]);
  assert.equal((wallet.match(/inputMode="decimal" value=\{(amountIn|shown)\}/g) || []).length, 6, 'no USDC amount box without it');
  assert.match(read('src/pages/Token.tsx'), /<ReadAs input=\{input\} \/>/, 'the trade panel (buy and sell share the box)');
  assert.match(read('src/pages/Launch.tsx'), /<ReadAs input=\{firstBuy\} \/>/, 'the dev buy');
  assert.match(read('src/components/ui.tsx'), /export function ReadAs\(\{ input \}[^\n]*\n\s*const r = readAs\(input\);\n\s*return r \? <p className="small muted read-as">\{r\}<\/p> : null;/);
});

// ---- a sent transaction whose result couldn't be read ----
test('"start over" only when the chain answered "no such transaction", and only minutes after the send', () => {
  const sent = 1_000_000;
  const late = sent + START_OVER_AFTER_MS;
  assert.ok(START_OVER_AFTER_MS >= 3 * 60_000, 'some minutes');
  assert.equal(mayStartOver({ at: sent, notFound: true }, late), true);
  assert.equal(mayStartOver({ at: sent, notFound: true }, late - 1), false, 'too soon');
  assert.equal(mayStartOver({ at: sent, notFound: false }, late * 10), false, 'the read failed for another reason');
  assert.equal(mayStartOver({ at: sent }, late * 10), false, 'never read');
  assert.equal(mayStartOver({ notFound: true }, late * 10), false, 'no send time');
  assert.equal(mayStartOver({ at: NaN, notFound: true }, late), false);
  assert.equal(mayStartOver(null, late), false);
});

test('only viem’s "receipt not found" counts as not found: a busy, rate-limited or failed read does not', () => {
  const nf = new TransactionReceiptNotFoundError({ hash: '0x' + 'ab'.repeat(32) });
  assert.equal(receiptNotFound(nf), true);
  assert.equal(receiptNotFound(Object.assign(new Error('wrapped'), { cause: nf })), true);
  for (const e of [new Error('HTTP request failed. Status: 429'), Object.assign(new Error('busy'), { name: 'HttpRequestError', status: 503 }), Object.assign(new Error('x'), { name: 'TimeoutError' }),
    new Error('Transaction receipt with hash could not be found'), Object.assign(new Error('limit'), { code: -32005 }), null, undefined, 'TransactionReceiptNotFoundError', {}]) {
    assert.equal(receiptNotFound(e), false, String(e?.message ?? e));
  }
});

test('the button keeps the send time and what the last read said, and offers "start over" only through that rule', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /setHeld\(\{ hash: e\.hash, chainId: e\.chainId, looked: false, at: Date\.now\(\),/, 'the send time is kept');
  assert.match(ui, /catch \(e\) \{\n\s*const notFound = receiptNotFound\(e\);\n\s*setHeld\(\{ \.\.\.h, looked: true, notFound \}\);/, 'the read’s answer is kept');
  assert.match(ui, /: mayStartOver\(held, Date\.now\(\)\)\n\s*\? <p className="small muted start-over">/);
  assert.equal((ui.match(/start over<\/button>/g) || []).length, 2, 'offered there, and for a deposit that went through on Arc');
  assert.match(ui, /\{held\?\.looked && st\.kind === 'err' && \(held\.deposit && held\.confirmed\n/, 'a deposit’s own line only once its receipt on Arc was read');
  assert.match(ui, /setHeld\(\{ \.\.\.h, looked: true, notFound: false, confirmed: true \}\);/);
  assert.doesNotMatch(ui, /Not on the explorer after a few minutes\? It never reached the chain/);
  assert.match(ui, /Couldn’t read it just now/, 'a failed read is said as that, not as "not confirmed"');
});

// ---- a tax wallet that is a contract ----
test('tax wallets with code on the chain are found before a split is saved; a read that fails stops the save', async () => {
  const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', SAFE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', B = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
  const code = { [SAFE]: '0x6080604052', [A]: '0x', [B]: undefined };
  const asked = [];
  const codeOf = async (a) => { asked.push(a); return code[a]; };
  assert.deepEqual(await taxWalletsWithCode(codeOf, [A, SAFE, B]), [SAFE]);
  assert.deepEqual(asked, [A, SAFE, B], 'every wallet is read');
  assert.deepEqual(await taxWalletsWithCode(codeOf, [A, B]), []);
  assert.deepEqual(await taxWalletsWithCode(async () => null, [A]), []);
  assert.deepEqual(await taxWalletsWithCode(async () => '0xef0100' + '11'.repeat(20), [A]), [A], 'a wallet that runs a contract’s code counts');
  await assert.rejects(taxWalletsWithCode(async () => { throw new Error('busy'); }, [A]));
  assert.equal(codeKey([SAFE, A]), codeKey([A.toLowerCase(), SAFE.toUpperCase().replace('0X', '0x'), A]));
  assert.notEqual(codeKey([SAFE]), codeKey([SAFE, A]));
});

test('the Manage page reads the code before saving and asks once more (a tick, then save again): never a refusal, never a silent save', () => {
  const m = read('src/pages/Manage.tsx');
  const save = m.slice(m.indexOf('label={problem ? \'Save the split\''), m.indexOf('function Metadata'));
  const at = (re) => { const i = save.search(re); assert.ok(i >= 0, String(re)); return i; };
  const readAt = at(/found = await taxWalletsWithCode\(\(a\) => vyre\.getCode\(\{ address: a as Address \}\), rows\.map\(\(r\) => r\.addr\)\)/);
  const stopAt = at(/if \(found\.length && yes !== codeKey\(found\)\) throw new Error\(/);
  const sendAt = at(/return run\(\{ functionName: 'setTaxWallets'/);
  assert.ok(readAt < stopAt && stopAt < sendAt, 'read, then ask, then send');
  assert.match(save, /catch \{ throw new Error\('Couldn’t check the wallets on VYRE just now, so nothing was sent/);
  assert.match(m, /<input type="checkbox" checked=\{yes === codeKey\(asking\)\}/);
  assert.match(m, /A multi-signature wallet such as a Safe is fine/);
});

// ---- names that read as USDC, MINTA or VYRE ----
// MINTA's own token on mainnet, as the build names it
const REAL = read('src/lib/network.ts').match(/mainnet: \{[\s\S]*?mintaToken: '(0x[0-9a-fA-F]{40})'/)[1];
const OTHER = '0x1111111111111111111111111111111111111111';
test('a ticker or name that reads as USDC, WUSDC, MINTA or VYRE gets a plain note, whatever letters it is written in', () => {
  const usdc = ['USDC', 'usdc', ' USDC ', 'ＵＳＤＣ', 'UЅDС', 'USDС', 'ՍSDC', 'U.S.D.C', 'U S D C', 'U5DC', 'USD​C', 'ÚŞĎÇ', 'Ｕ𝐒ᴰC'.normalize('NFKC'), '𝐔𝐒𝐃𝐂', 'ⓊⓈⒹⒸ', 'WUSDC', 'ԜUSDC', 'wUSDC', 'USD Coin', 'Wrapped USDC', '$USDC', 'U̶S̶D̶C̶'];
  for (const s of usdc) {
    assert.equal(lookalikeNote({ symbol: s, name: 'x', token: OTHER }, REAL), 'Not USDC', `ticker ${JSON.stringify(s)} (${plainLook(s)})`);
    assert.equal(lookalikeNote({ symbol: 'x', name: s, token: OTHER }, REAL), 'Not USDC', `name ${JSON.stringify(s)}`);
  }
  for (const s of ['MINTA', 'minta', 'МІNТА', 'ΜΙΝΤΑ', 'M1NTA', 'ＭＩＮＴＡ', 'M-I-N-T-A', 'MINTА']) assert.equal(lookalikeNote({ symbol: s, name: 'x', token: OTHER }, REAL), 'Not MINTA’s token', s);
  for (const s of ['VYRE', 'vyre', 'VΥRΕ', 'VУRЕ', 'VYR3', 'ＶＹＲＥ']) assert.equal(lookalikeNote({ symbol: s, name: 'x', token: OTHER }, REAL), 'Not VYRE’s token', s);
  // USDC is never the real one on the launchpad, even at the MINTA token's address
  assert.equal(lookalikeNote({ symbol: 'USDC', name: 'MINTA', token: REAL }, REAL), 'Not USDC');
});

test('MINTA’s own token (by address) carries no note; other names carry none either', () => {
  assert.equal(lookalikeNote({ symbol: 'MINTA', name: 'MINTA', token: REAL }, REAL), '');
  assert.equal(lookalikeNote({ symbol: 'MINTA', name: 'MINTA', token: REAL.toLowerCase() }, REAL), '');
  assert.equal(lookalikeNote({ symbol: 'MINTA', name: 'MINTA', token: REAL }, null), 'Not MINTA’s token', 'a network with no MINTA token');
  assert.equal(lookalikeNote({ symbol: 'MINTA', name: 'MINTA' }, REAL), 'Not MINTA’s token', 'no address, no exception');
  for (const s of ['TEST', 'MINTAX', 'USDCAT', 'XUSDC', 'VYRES', 'DOGE', 'MINT', 'USD', '', 'МОСКВА', '日本'] ) assert.equal(lookalikeNote({ symbol: s, name: s, token: OTHER }, REAL), '', s);
  assert.match(read('src/lib/network.ts'), /testnet: \{[\s\S]*?mintaToken: null,[\s\S]*?mainnet: \{/, 'no MINTA token on the test network');
});

test('an empty ticker shows the token’s short address, and stacked marks are cut to two a character', () => {
  assert.equal(tickerText('', OTHER), '0x1111…1111');
  assert.equal(tickerText('​‍ ', OTHER), '0x1111…1111', 'only hidden characters');
  assert.equal(tickerText('DOGE', OTHER), 'DOGE');
  assert.equal(tickerText('', null), '—');
  const stacked = 'Z' + '̀'.repeat(40) + 'A' + '́̂' + 'L̃';
  assert.equal(tokenText(stacked), 'Z̀̀Á̂L̃');
  assert.equal(tokenText('é'), 'é');
  assert.equal(tokenText('é'), 'é');
});

test('the note and the ticker are drawn on the cards, the lists, the search, the token page and its trade panel', () => {
  assert.match(read('src/components/TokenCard.tsx'), /\{tickerText\(l\.symbol, l\.token\)\}<\/bdi> <NotThat l=\{l\} \/>/);
  assert.match(read('src/pages/Explore.tsx'), /\{tickerText\(l\.symbol, l\.token\)\}<\/bdi><\/b>[^\n]*<NotThat l=\{l\} \/>/);
  assert.match(read('src/components/Search.tsx'), /\{tickerText\(l\.symbol, l\.token\)\}[^\n]*<NotThat l=\{l\} \/>/);
  assert.match(read('src/components/TopTokens.tsx'), /\{tickerText\(t\.symbol, t\.token\)\}[^\n]*<NotThat l=\{t\} \/>/);
  const page = read('src/pages/Token.tsx');
  assert.match(page, /const sym = tickerText\(launch\.symbol, launch\.token\);/);
  assert.match(page, /<h1 className="token-title">[^\n]*<NotThat l=\{launch\} \/><\/h1>/);
  assert.match(page, /<div className="trade-card">\n\s*<NotThat l=\{launch\} className="block" \/>/);
  assert.match(read('src/components/ui.tsx'), /const note = lookalikeNote\(l, NETWORK\.mintaToken\);/);
});

// ---- a hidden creator's tokens after a handover ----
test('a blocked or hidden creator’s tokens stay hidden after the launch is handed to another wallet', () => {
  const BAD = '0x' + 'ba'.repeat(20), NEW = '0x' + 'c1'.repeat(20), T1 = '0x' + '11'.repeat(20), T2 = '0x' + '22'.repeat(20), T3 = '0x' + '33'.repeat(20);
  const rows = [{ token: T1, creator: NEW }, { token: T2, creator: NEW }, { token: T3, creator: BAD }];
  const block = { tokens: [], creators: [BAD] };
  try {
    // before who launched what is known: only the current creator can be matched
    setFirstCreators(new Map());
    assert.deepEqual(visibleLaunches(rows, [], [], block).map((r) => r.token), [T1, T2]);
    // T1 was launched by BAD and handed to NEW; T2 was NEW's from the start
    setFirstCreators(new Map([[T1, BAD], [T2, NEW], [T3, BAD]]));
    assert.deepEqual(visibleLaunches(rows, [], [], block).map((r) => r.token), [T2]);
    assert.equal(isHidden({ token: T1.toUpperCase().replace('0X', '0x'), creator: NEW }, [], [], block), true, 'whatever the letter case');
    assert.equal(isHidden({ token: T2, creator: NEW }, [], [], block), false);
    // the visitor's own "hide everything from this creator" works the same way
    assert.deepEqual(visibleLaunches(rows, [], [BAD], NO_BLOCKS).map((r) => r.token), [T2]);
    assert.equal(isHidden({ token: T1, creator: NEW }, [], [BAD], NO_BLOCKS), true);
    // and so does the ticker
    const feed = [{ kind: 'trade', token: T1 }, { kind: 'trade', token: T2 }, { kind: 'stat' }];
    assert.deepEqual(visibleFeed(feed, () => NEW, [], [], block).map((f) => f.token), [T2, undefined]);
    // nobody hidden: nothing changes
    assert.deepEqual(visibleLaunches(rows, [], [], NO_BLOCKS), rows);
  } finally { setFirstCreators(new Map()); }
});

test('who launched each token is read from the launch events when any creator is hidden or blocked, and the pages that wait for the list wait for it', () => {
  const h = read('src/components/Hidden.tsx');
  assert.match(h, /if \(!\(block\?\.creators\.length \|\| loadHidden\(store\(\), KEY_CREATORS\)\.length\)\) return;/, 'not read while no creator is hidden');
  assert.match(h, /blocklist \?\?= readBlocklist\(\)\.then\(async \(b\) => \{\n\s*await Promise\.race\(\[readFirstCreators\(b \?\? NO_BLOCKS\), new Promise\(\(r\) => setTimeout\(r, FIRST_CREATORS_WAIT_MS\)\)\]\);/);
  assert.match(h, /export const hideCreator = [^\n]*void readFirstCreators\(\);/);
  const f = read('src/lib/firstCreator.ts');
  assert.match(f, /vyre\.getLogs\(\{ address: a\.pad, event: launchCreated, fromBlock: lo, toBlock: hi \}\)/);
  assert.match(f, /known\.set\(l\.args\.token\.toLowerCase\(\), l\.args\.creator\.toLowerCase\(\)\)/);
});

// ---- the page's headers ----
test('every page is served with Cross-Origin-Opener-Policy: same-origin, and nothing in the app needs a window that opened it or that it opened', () => {
  const v = JSON.parse(read('vercel.json'));
  const all = v.headers.find((h) => h.source === '/(.*)').headers;
  assert.deepEqual(all.filter((h) => h.key === 'Cross-Origin-Opener-Policy').map((h) => h.value), ['same-origin']);
  // the one window the app opens (the card checkout) is cut loose before it is pointed anywhere, and never read afterwards
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /if \(win\) \{ win\.opener = null; win\.location\.href = url; \} else window\.location\.href = url;/);
  const src = fs.readdirSync(new URL('../src', import.meta.url), { recursive: true }).filter((f) => /\.tsx?$/.test(String(f))).map((f) => [String(f), read(`src/${f}`)]);
  for (const [f, t] of src) {
    assert.doesNotMatch(t, /window\.opener|\.postMessage\(/, `${f} talks to no opener`);
    if (!f.endsWith('Wallet.tsx')) assert.doesNotMatch(t, /window\.open\(/, `${f} opens no window`);
  }
});

// ---- the Wallet page's words ----
test('the promoter card is drawn only where the network has a promoter program (not on mainnet)', () => {
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /\{account && NETWORK\.promoters && <Promoter account=\{account\} \/>\}/);
  assert.equal((wallet.match(/<Promoter /g) || []).length, 1);
  assert.match(read('src/lib/network.ts'), /mainnet: \{[\s\S]*?promoters: null,/);
});

test('how long a withdrawal takes comes from the network’s own words, never the test network’s sentence written into the page', () => {
  const wallet = read('src/pages/Wallet.tsx');
  assert.doesNotMatch(wallet, /half an hour/);
  assert.equal((wallet.match(/\(\{NETWORK\.withdrawal\}\)/g) || []).length, 2, 'both cards that move USDC to Arc');
  assert.match(read('src/lib/network.ts'), /withdrawal: 'a withdrawal takes about a day'/);
});

test('someone connected through WalletConnect is told before starting a withdrawal that the claim needs a browser wallet with the same account, and is shown no claim button that can’t work', () => {
  const wallet = read('src/pages/Wallet.tsx');
  const card = wallet.slice(wallet.indexOf('function CashOut'), wallet.indexOf('function addressProblem'));
  assert.match(card, /const viaWc = isWcProvider\(provider\);/);
  const noteAt = card.indexOf('{viaWc && <p className="note small wc-claim-note">{WC_CLAIM_NOTE}</p>}');
  const startAt = card.indexOf('<TxButton label={value ? `Move ');
  assert.ok(noteAt > 0 && noteAt < startAt, 'the note is above the button that starts the move');
  assert.match(card, /\{w\.state === 'ready' && !isEmail && viaWc && <span className="small wc-claim-here">\{WC_CLAIM_HERE\}<\/span>\}/);
  assert.match(card, /\{w\.state === 'ready' && !isEmail && !viaWc && \(\n\s*<TxButton className="btn btn-accent btn-sm" label="Claim on Arc"/);
  const words = read('src/lib/wcstate.ts');
  assert.match(words, /WC_CLAIM_NOTE = '[^']*the claim on Arc, needs a browser wallet with this same account[^']*before you start\.'/);
  assert.match(words, /WC_CLAIM_HERE = '[^']*connect a browser wallet with this same account\.'/);
});

// ---- one account's balances never under another ----
test('balances are cleared when the account changes and an answer for the last account is dropped (token page, portfolio, wallet page, wrapped USDC)', () => {
  const token = read('src/pages/Token.tsx');
  assert.match(token, /if \(balFor\.current !== who\) \{ balFor\.current = who; setBal\(null\); \}\n\s*const \[usdc, tokens\] = await Promise\.all\(\[usdcBalance\(account\), tokenBalance\(token, account\)\]\);\n\s*if \(balFor\.current === who\) setBal\(\{ usdc, tokens \}\);/);
  const pf = read('src/pages/Portfolio.tsx');
  assert.match(pf, /setUsdc\(null\); setRaw\(null\); setFailed\(''\);\n\s*if \(!account \|\| !ready\) return;\n\s*let live = true;/);
  assert.match(pf, /const held = await usdcBalance\(account\);\n\s*if \(!live\) return;\n\s*setUsdc\(held\);/);
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /if \(shownFor\.current !== who\) \{ shownFor\.current = who; setUsdc\(null\); setOnArc\(null\); \}/);
  assert.match(wallet, /usdcBalance\(account\)\.then\(mine\(setUsdc\)\)/);
  assert.match(wallet, /arc\.getBalance\(\{ address: account \}\)\.then\(mine\(setOnArc\)\)/);
  assert.match(read('src/components/Wrapped.tsx'), /if \(shownFor\.current === who && v !== null\) setHeld\(v\);/);
});

// ---- collected tax arrives as wrapped USDC ----
test('the pages say the tax is paid out as wrapped USDC, show the wallet’s wrapped USDC, and unwrap exactly what the button names through the simulated send', () => {
  const manage = read('src/pages/Manage.tsx');
  assert.doesNotMatch(manage, /Sends the tax collected so far, in USDC/);
  assert.match(manage, /It arrives as wrapped USDC \(WUSDC\), a token that holds USDC one for one: whoever receives it can unwrap it to USDC here or on the Wallet page\./);
  assert.match(manage, /\{account && <WrappedUsdc account=\{account\} again=\{reads\} \/>\}/);
  assert.match(read('src/pages/Wallet.tsx'), /\{account && <WrappedUsdc account=\{account\} again=\{reads\} onDone=\{load\} \/>\}/);
  assert.match(read('src/lib/fees.ts'), /TAX_GOES = main \? 'paid out as wrapped USDC \(WUSDC\); a tenth goes to the platform wallet/);
  assert.match(read('src/lib/fees.ts'), /It arrives as wrapped USDC \(WUSDC\), which the Wallet page unwraps to USDC one for one\./);
  assert.match(read('src/pages/Token.tsx'), /the creator’s tax wallets above, as wrapped USDC \(WUSDC\), which unwraps to USDC one for one\./);
  const lib = read('src/lib/wrapped.ts');
  assert.match(lib, /'function withdraw\(uint256 wad\)'/);
  assert.match(lib, /return sendCall\(wallet, client, \{ address: wrappedAddress\(\), abi: wusdcAbi, functionName: 'withdraw', args: \[amount\] \}\);/);
  assert.match(lib, /wrappedAddress = \(\): Address => getAddresses\(NETWORK\.vyre\.id\)\.wusdc;/);
  const card = read('src/components/Wrapped.tsx');
  assert.match(card, /if \(!held\) return null;/, 'nothing is drawn for a wallet with none');
  assert.match(card, /label=\{`Unwrap \$\{exact\(held\)\} WUSDC to USDC`\}/);
  assert.match(card, /const now = await wrappedBalance\(account\);\n\s*if \(now !== held\) \{ setHeld\(now\); throw new Error\(/, 'a balance that moved since it was read stops the send');
  assert.match(card, /const r = await unwrap\(w, vyre, held\);/);
  // the mainnet wrapped-USDC token is the one the launchpad pays the tax in
  assert.match(read('src/lib/pad.ts'), /wusdc: v2\.PAD_V2\.wusdc,/, 'the SDK is told the launchpad’s own');
});
