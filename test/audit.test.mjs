// Checks kept from a review of the app: how a typed amount is read, when a sent transaction may be given up on, a tax wallet that
// is a contract, tokens whose names read as USDC, MINTA or VYRE, a hidden creator's tokens after a handover, the page's headers,
// and the words of the Wallet and Manage pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { amountProblem, exact, lookalikeNote, parse, plainLook, readAs, tickerText, tokenText } from '../src/lib/format.ts';
import { START_OVER_AFTER_MS, mayStartOver, receiptNotFound } from '../src/lib/held.ts';
import { codeKey, taxWalletsWithCode } from '../src/lib/taxsplit.ts';
import { usd } from '../src/lib/format.ts';
import { carryStates, listWithdrawals, settleWithdrawals, SPENT_READS_PER_CALL, WITHDRAWALS_SHOWN } from '../src/lib/moves.ts';
import { parseUnsure, unsureStore } from '../src/lib/unsure.ts';
import { PLATFORM_WALLET_UNREAD, platformWalletShown } from '../src/lib/platformShown.ts';
import { SOURCE_ON_EXPLORER, sourceSentence, unpublished } from '../src/lib/verified.ts';
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
  // written without commas: "1,125" (one and an eighth, to someone who writes decimals with a comma) visibly reads as 1125
  assert.equal(readAs('1,125'), 'read as 1125');
  assert.equal(readAs('1,000.5'), 'read as 1000.5');
  assert.equal(readAs(' 12,345 '), 'read as 12345');
  assert.equal(readAs('1,000.000000000000000001'), 'read as 1000.000000000000000001');
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
  assert.equal(START_OVER_AFTER_MS, 5 * 60_000, 'five minutes');
  // the answer "not found" must itself have come five minutes after the send
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: late }, late), true);
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: late }, late + 60_000), true);
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: late - 1 }, late * 10), false, 'an answer from before the five minutes, however much later it is looked at');
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: sent + 10_000 }, sent + 10 * 60_000), false, 'a check ten seconds after the send, read again ten minutes later (a reload, a redraw): not offered');
  assert.equal(mayStartOver({ at: sent, notFound: true }, late * 10), false, 'no time kept for the answer');
  assert.equal(mayStartOver({ at: sent, notFound: false, notFoundAt: late }, late * 10), false, 'the read failed for another reason');
  assert.equal(mayStartOver({ at: sent, notFoundAt: late }, late * 10), false, 'never read');
  assert.equal(mayStartOver({ notFound: true, notFoundAt: late }, late * 10), false, 'no send time');
  assert.equal(mayStartOver({ at: NaN, notFound: true, notFoundAt: late }, late), false);
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: NaN }, late), false);
  assert.equal(mayStartOver({ at: sent, notFound: true, notFoundAt: late + 5 }, late), false, 'an answer dated after now');
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
  assert.match(ui, /: mayStartOver\(held, Date\.now\(\)\)\n\s*\? <p className="small muted start-over">/);
  assert.equal((ui.match(/start over<\/button>/g) || []).length, 2, 'offered there, and for a deposit that went through on Arc');
  assert.match(ui, /setHeld\(\{ \.\.\.rest, looked: true, notFound, \.\.\.\(notFound \? \{ notFoundAt: Date\.now\(\) \} : \{\}\) \}\);/, 'when the chain answered is kept, and dropped by a read that failed');
  assert.match(ui, /onClick=\{\(\) => startOver\(held\)\}>start over<\/button>/, 'pressing it reads the chain once more first');
  assert.match(ui, /if \(receiptNotFound\(e\)\) \{ setHeld\(null\); setSt\(\{ kind: 'idle' \}\); return; \}/);
  assert.match(ui, /\{held\?\.looked && st\.kind === 'err' && \(held\.deposit && held\.confirmed\n/, 'a deposit’s own line only once its receipt on Arc was read');
  assert.match(ui, /setHeld\(\{ \.\.\.h, looked: true, notFound: false, notFoundAt: undefined, confirmed: true \}\);/);
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
  assert.match(read('src/components/ui.tsx'), /const note = lookalikeNote\(l, NETWORK\.mintaToken, NETWORK\.vyreToken\);/);
  // and wherever else a ticker is shown: the portfolio's holdings and launches, the ticker strip, the Manage title
  const pf = read('src/pages/Portfolio.tsx');
  assert.match(pf, /\$<bdi>\{tickerText\(h\.launch\.symbol, h\.launch\.token\)\}<\/bdi><\/b> <NotThat l=\{h\.launch\} \/>/);
  assert.match(pf, /\$<bdi>\{tickerText\(l\.symbol, l\.token\)\}<\/bdi><\/b>[^\n]*<NotThat l=\{l\} \/>/);
  const strip = read('src/components/Ticker.tsx');
  assert.equal((strip.match(/\{tickerText\(it\.symbol, it\.token\)\}<\/bdi><\/b> <NotThat l=\{\{ symbol: it\.symbol, name: (?:it\.name|''), token: it\.token \}\} \/>/g) || []).length, 2, 'a new launch and a trade');
  assert.match(read('src/pages/Manage.tsx'), /\$<bdi>\{tickerText\(launch\.symbol, launch\.token\)\}<\/bdi><\/span> <NotThat l=\{launch\} \/><\/h1>/);
  // no page shows a ticker through tokenText alone any more
  for (const f of ['src/pages/Portfolio.tsx', 'src/components/Ticker.tsx', 'src/pages/Manage.tsx', 'src/components/TokenCard.tsx', 'src/pages/Explore.tsx', 'src/components/Search.tsx', 'src/components/TopTokens.tsx']) {
    assert.doesNotMatch(read(f), /<bdi>\{tokenText\([a-z.]*symbol\)\}<\/bdi>/, `${f} shows a ticker without the empty-ticker fallback`);
  }
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
  const all = v.headers.filter((h) => h.source === '/(.*)' && !h.has && !h.missing).flatMap((h) => h.headers); // (the rule with no condition: every host)
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
  assert.match(card, /\{w\.state === 'ready' && !isEmail && !viaWc && \(\n\s*<TxButton key=\{`claim:\$\{w\.position\}:\$\{account\.toLowerCase\(\)\}`\} keepAs=\{`claim:\$\{w\.position\}:\$\{account\.toLowerCase\(\)\}`\} className="btn btn-accent btn-sm" label="Claim on Arc"/);
  const words = read('src/lib/wcstate.ts');
  assert.match(words, /WC_CLAIM_NOTE = '[^']*the claim on Arc, needs a browser wallet with this same account[^']*before you start\.'/);
  assert.match(words, /WC_CLAIM_HERE = '[^']*connect a browser wallet with this same account\.'/);
});

// ---- one account's balances never under another ----
test('balances are cleared when the account changes and an answer for the last account is dropped (token page, portfolio, wallet page, wrapped USDC)', () => {
  const token = read('src/pages/Token.tsx');
  assert.match(token, /if \(balFor\.current !== who\) \{ balFor\.current = who; setBal\(null\); \}\n\s*const \[usdc, tokens\] = await Promise\.all\(\[usdcBalance\(mine\), tokenBalance\(token, mine\)\]\);\n\s*if \(balFor\.current === who\) setBal\(\{ usdc, tokens \}\);/);
  // a trade's "after" (and a button's onDone) belongs to the render it was pressed in: the account is read from a ref, never from that closure
  assert.match(token, /const accountNow = useRef\(account\);\n\s*accountNow\.current = account;\n\s*const refreshBalances = useCallback\(async \(\) => \{\n\s*const mine = accountNow\.current;/);
  const pf = read('src/pages/Portfolio.tsx');
  assert.match(pf, /setUsdc\(null\); setRaw\(null\); setFailed\(''\);\n\s*if \(!account \|\| !ready\) return;\n\s*let live = true;/);
  assert.match(pf, /const held = await usdcBalance\(account\);\n\s*if \(!live\) return;\n\s*setUsdc\(held\);/);
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /if \(shownFor\.current !== who\) \{ shownFor\.current = who; setUsdc\(null\); setOnArc\(null\); \}/);
  assert.match(wallet, /const now = accountNow\.current;\n\s*const who = now \? now\.toLowerCase\(\) : null;/, 'the Wallet page’s reload reads the account connected now, not the one of the render a button was pressed in');
  assert.match(wallet, /usdcBalance\(now\)\.then\(mine\(setUsdc\)\)/);
  assert.match(wallet, /arc\.getBalance\(\{ address: now \}\)\.then\(mine\(setOnArc\)\)/);
  assert.match(wallet, /if \(accountNow\.current !== account\) return;\n\s*if \(onArcNow !== null\) setOnArc\(onArcNow\);/, 'a transfer that lands after the account changed fills nothing in');
  // the withdrawals card and the promoter card drop a late answer too
  assert.match(wallet, /const live = \(\) => cardFor\.current === mine && loadNo\.current === no;/);
  assert.equal((wallet.slice(wallet.indexOf('function CashOut'), wallet.indexOf('function addressProblem')).match(/if \(!live\(\)\) return;/g) || []).length, 2);
  assert.match(wallet, /getPromoter\(vyre, account\)\.then\(\(v\) => \{ if \(live\) setMine\(v\); \}\)/);
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
  assert.match(card, /if \(!held\) \{\n\s*return last \? \(/, 'for a wallet with none: nothing, or the result of the unwrap just made from here');
  assert.match(card, /<p className="status ok" role="status">\{last\.text\} This wallet holds no wrapped USDC now\.\{last\.hash && <> <a href=\{txUrl\(last\.hash\)\}/);
  assert.match(card, /onDone=\{\(\) => \{ setLast\(\(l\) => l \?\? \{ text: 'Your unwrap went through\.', hash: '' \}\); read\(\); onDone\?\.\(\); \}\}/, 'a result confirmed later by Check it keeps a line too');
  assert.match(card, /label=\{`Unwrap \$\{exact\(held\)\} WUSDC to USDC`\}/);
  assert.match(card, /const now = await wrappedBalance\(account\);\n\s*if \(now !== held\) \{ setHeld\(now\); throw new Error\(/, 'a balance that moved since it was read stops the send');
  assert.match(card, /const r = await unwrap\(w, vyre, held\);/);
  // the mainnet wrapped-USDC token is the one the launchpad pays the tax in
  assert.match(read('src/lib/pad.ts'), /wusdc: v2\.PAD_V2\.wusdc,/, 'the SDK is told the launchpad’s own');
});

// ---- a second review: figures, lists and words ----
test('a dollar figure is cut, never rounded up, and never printed as an exponent', () => {
  for (const [n, text] of [[1995.01, '$1.99K'], [9995, '$9.99K'], [9999.99, '$9.99K'], [999.996, '$999.99'], [1e-7, '<$0.000001'], [5e-7, '<$0.000001'], [1234, '$1.23K'], [1.15, '$1.15'], [0.07, '$0.0700'],
    [0.0123456, '$0.0123'], [0.001234, '$0.00123'], [0.00009999, '$0.0000999'], [1e6, '$1M'], [2500000, '$2.5M'], [1234567890, '$1.23B'], [12.345, '$12.34'], [3000, '$3K'], [1000, '$1K'], [0.0000015, '$0.00000150'], [0, '$0'], [-5.129, '-$5.12']]) {
    assert.equal(usd(n), text, String(n));
  }
  assert.equal(usd(Infinity), '—');
  assert.equal(usd(NaN), '—');
});

test('a small token amount is never shown as 0: the quote, the minimum, the balance, the result and the trades table use the short form that keeps it', () => {
  const token = read('src/pages/Token.tsx');
  for (const piece of ['{shortAmount(t.usdc, 4)}', '{shortAmount(t.tokens, 0)}', '`${shortAmount(bal.usdc, 4)} USDC` : `${shortAmount(bal.tokens, 2)} ${sym}`', "{shortAmount(shown.out, side === 'buy' ? 2 : 6)}",
    "At least {shortAmount(min, side === 'buy' ? 2 : 6)}", '`Bought ${shortAmount(r.tokensOut, 2)} ${sym}.`', '`Sold for ${shortAmount(r.usdcOut, 4)} USDC.`']) assert.ok(token.includes(piece), piece);
  const pf = read('src/pages/Portfolio.tsx');
  assert.ok(pf.includes('{shortAmount(h.balance, 2)}') && pf.includes("'…' : shortAmount(usdc, 4)}"));
});

test('the chart starts "All" at the launch’s opening price when every trade is there, and says so when only the latest were read', () => {
  const chart = read('src/components/PriceChart.tsx');
  assert.match(chart, /if \(open && open\.price > 0 && !cut && !recentOnly && \(!all\.length \|\| open\.time <= all\[0\]\.t\)\) all\.unshift\(\{ t: open\.time, p: open\.price, start: true \}\);/);
  assert.match(chart, /\{cut \? <p className="muted small chart-cut">Latest \{cut\} trades<\/p> : recentOnly \? <p className="muted small chart-cut">Recent trades only<\/p> : null\}/);
  assert.match(read('src/lib/market.ts'), /out\.windowed = began === null \|\| began > launch\.createdAt;/, 'a read that began after the launch says so');
  const token = read('src/pages/Token.tsx');
  assert.match(token, /open=\{stats\?\.openPrice \? \{ price: stats\.openPrice, time: launch\.createdAt \} : undefined\} cut=\{trades && trades\.length >= MAX_TRADES \? MAX_TRADES : undefined\}/);
  assert.match(read('src/lib/stats.ts'), /openPrice: openPrice\.get\(k\),/);
});

test('the withdrawals list shows every one not paid out yet before the paid-out ones, and a row keeps its state while it is read again', () => {
  const row = (n, state) => ({ hash: `0x${n}`, position: BigInt(n), state });
  const many = [...Array.from({ length: 12 }, (_, i) => row(100 - i, 'claimed')), row(5, 'ready'), row(4, 'waiting'), row(3, undefined)];
  const shown = listWithdrawals(many);
  assert.deepEqual(shown.slice(0, 3).map((r) => r.position), [5n, 4n, 3n], 'the unclaimed ones first, however old');
  assert.equal(shown.length, WITHDRAWALS_SHOWN);
  assert.ok(shown.slice(3).every((r) => r.state === 'claimed'));
  const open = Array.from({ length: 14 }, (_, i) => row(i, 'waiting'));
  assert.equal(listWithdrawals([...open, row(99, 'claimed')]).length, 14, 'every unclaimed one is listed, past the usual length');
  const key = (r) => `${r.hash}-${r.position}`;
  const fresh = [row(5, undefined), row(6, undefined)];
  assert.deepEqual(carryStates(fresh, [row(5, 'ready')], key).map((r) => r.state), ['ready', undefined]);
  assert.deepEqual(carryStates(fresh, null, key).map((r) => r.state), [undefined, undefined]);
  const wallet = read('src/pages/Wallet.tsx');
  const card = wallet.slice(wallet.indexOf('function CashOut'), wallet.indexOf('function addressProblem'));
  assert.match(card, /limit: WITHDRAWALS_READ, fromBlock: head > back \? head - back : 0n/);
  assert.match(card, /setRows\(\(before\) => listWithdrawals\(carryStates\(list, before, keyOf\)\)\);/);
  assert.match(card, /catch \{ if \(live\(\)\) \{ setReadErr\(true\); setRows\(\(r\) => r \?\? \[\]\); \} \}/);
  assert.match(card, /\{readErr && <p className="err small withdrawals-unread" role="alert">Couldn’t read your withdrawals just now/);
  assert.match(card, /onClick=\{\(\) => setBack\(\(b\) => b \* 4n\)\}>Look further back<\/button>/);
});

test('a button’s run belongs to the action it was pressed for: after the account changes, its result is kept under its own name and shown under no other', () => {
  const ui = read('src/components/ui.tsx');
  assert.match(ui, /const mine = \(\) => nowAs\.current === keepAs;\n\s*const setSt = \(s: Status\) => \{ if \(mine\(\)\) putSt\(s\); \};\n\s*const setHeld = \(h: Held \| null\) => \{ writeHeld\(keepAs, h\); if \(mine\(\)\) keepHeld\(h\); \};/);
  assert.match(ui, /const done = \(\) => \{ if \(!mine\(\)\) return; try \{ onDone\?\.\(\); \}/);
});

test('the platform wallet shown is the chain’s answer; the app’s own record only while reading, or with a note when the chain can’t be read', () => {
  const REC = '0x' + '11'.repeat(20), CHAIN = '0x' + '22'.repeat(20);
  assert.deepEqual(platformWalletShown('reading', REC), { address: REC, note: '' });
  assert.deepEqual(platformWalletShown(CHAIN, REC), { address: CHAIN, note: '' }, 'the chain wins when it differs');
  assert.deepEqual(platformWalletShown(REC, REC), { address: REC, note: '' });
  for (const bad of ['failed', '0x', '0x' + '00'.repeat(20), '0x123']) assert.deepEqual(platformWalletShown(bad, REC), { address: REC, note: PLATFORM_WALLET_UNREAD }, bad);
  assert.match(read('src/lib/platform.ts'), /vyre\.readContract\(\{ address: PAD_V2\.pad, abi: padV2Abi, functionName: 'platformWallet' \}\)/);
  assert.doesNotMatch(read('src/pages/Token.tsx') + read('src/pages/Docs.tsx'), /PAD_V2\.platformWallet/, 'no page shows the constant by itself');
  assert.match(read('src/pages/Token.tsx'), /\(<PlatformWalletLink \/>\)/);
});

test('the docs say "read its source" only while every row of the contract table has its source on the explorer; the terms say no more than that', () => {
  assert.deepEqual(Object.keys(SOURCE_ON_EXPLORER), ['VyrePadV2', 'VyrePoolFactory', 'SwapRouter', 'QuoterV2', 'TickLens', 'WUSDC']);
  // the docs table's contract rows are exactly the listed ones
  const docs = read('src/pages/Docs.tsx');
  const main = docs.slice(docs.indexOf("] : [\n    ['VyrePadV2'"), docs.indexOf('return (', docs.indexOf("['VyrePadV2'")));
  assert.deepEqual([...main.matchAll(/^\s*\['([A-Za-z0-9]+)', a\./gm)].map((m) => m[1]), Object.keys(SOURCE_ON_EXPLORER));
  assert.match(docs, /\$\{sourceSentence\(\)\} \(Published source is a fact about the code, not a safety check\.\) A token or pool launched a moment ago may show there as unverified/);
  assert.equal(sourceSentence({ A: true, B: true }), 'Click an address to read its source on the explorer.');
  assert.equal(sourceSentence({ VyrePadV2: false, B: true }), 'Click an address to open it on the explorer. The source of VyrePadV2 is not published there yet.');
  assert.equal(sourceSentence({ A: false, B: false, C: true }), 'Click an address to open it on the explorer. The source of A and B is not published there yet.');
  const terms = read('public/terms/index.html');
  if (unpublished().length) {
    assert.doesNotMatch(terms, /anyone can read them/, 'a contract without published source: the terms don’t say anyone can read them');
    assert.match(terms, /anyone can see them, and who owns them, on the/);
  } else {
    assert.match(terms, /anyone can read them, and see who owns them, on the|anyone can see them, and who owns them, on the/);
  }
  assert.doesNotMatch(docs + terms, /verified (?:and|means|so it is) safe|audited contracts/i);
});

test('a handover offer can be withdrawn on the page, and the page says it stays open until then', () => {
  const m = read('src/pages/Manage.tsx');
  assert.match(m, /An offer does not run out: it stays open until they accept it or you withdraw it\./);
  assert.match(m, /<TxButton className="btn btn-line btn-sm" label="Withdraw the offer" run=\{run\(\{ functionName: 'offerCreator', args: \[launch\.token, zeroAddress\] \}, 'The offer is withdrawn\.'\)\} \/>/);
  assert.match(m, /Offered now to <AddressLink address=\{pending\} label=\{pending\} \/>/, 'the whole address');
  assert.match(m, /&& to\.toLowerCase\(\) !== zeroAddress;/, 'the form itself never offers to the zero address');
});

test('the opening market cap is "about $3,000" wherever it is stated', () => {
  const launch = read('src/pages/Launch.tsx');
  const stated = launch.split('\n').filter((l) => /usd\(Number\(OPENING_MARKET_CAP \/ E18\)\)/.test(l));
  assert.equal(stated.length, 5);
  for (const l of stated) assert.match(l, /about \{usd\(Number\(OPENING_MARKET_CAP|about \$\{usd\(Number\(OPENING_MARKET_CAP/, l.trim().slice(0, 90));
  assert.match(read('src/pages/Docs.tsx'), /opens at about the same market cap, <b>about \$3,000<\/b>/);
});

test('the developer docs name the vendored SDK release, say it is on npm and that it knows this launchpad', () => {
  const docs = read('src/pages/Docs.tsx');
  const file = JSON.parse(read('package.json')).dependencies['@vyrechain/sdk'].replace('file:vendor/', '');
  assert.match(file, /^vyrechain-sdk-0\.(?:[7-9]|\d\d)\.\d+\.tgz$/, 'a release that knows the new launchpad');
  assert.ok(docs.includes(`const SDK_FILE = 'https://vyrechain.com/sdk/${file}';`));
  assert.doesNotMatch(docs, /isn’t on npm yet|is being prepared|written for the first launchpad/);
  assert.match(docs, /It is on npm as <code>@vyrechain\/sdk<\/code>/);
  assert.match(docs, /<code>getAddresses\(3045\)\.padVersion<\/code> is 2/);
  for (const f of ['public/llms.txt', 'public/llms-full.txt', 'public/agents/index.html']) {
    assert.ok(read(f).includes(file), `${f} names it`);
    assert.doesNotMatch(read(f), /older launchpad entries/);
  }
});

test('words that were the test network’s, or wider than the facts, are gone from the mainnet pages and the store text', () => {
  assert.match(read('store/android/full-description.txt'), /^- The network fee is paid in USDC: about a twentieth of a cent for a trade, about two cents for a launch\.$/m);
  assert.match(read('index.html'), /"browserRequirements": "Requires JavaScript and a wallet \(a browser wallet, or a wallet app through WalletConnect\)"/);
  const terms = read('public/terms/index.html');
  assert.doesNotMatch(terms, /email/i, 'the mainnet terms describe no email sign-in (it is not offered there)');
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /\{IS_TESTNET \? 'It arrives in about 3 seconds\.' : 'It arrives in a few seconds\.'\}/);
  assert.match(read('public/privacy/index.html'), /A token’s picture, description and links load from the app’s picture service \(api\.vyrechain\.com\), which receives the tokens shown and your IP address\./);
  for (const [f, real] of [['public/terms-testnet/index.html', '/terms/'], ['public/privacy-testnet/index.html', '/privacy/']]) {
    const t = read(f);
    assert.match(t, /<meta name="robots" content="noindex">/, `${f} is kept out of search`);
    assert.match(t, /<title>[^<]*\(test network\) · MINTA<\/title>/);
    assert.ok(/<b>(?:This is|These are) the test network’s/.test(t) && t.includes(`<a href="${real}">${real}</a>`), `${f} points to the mainnet page`);
  }
  assert.match(read('SECURITY.md'), /VYRE Mainnet \(chain 3045\), where the USDC is real/);
  assert.doesNotMatch(read('SECURITY.md'), /treat the test network as the place to\nfind problems/);
  assert.doesNotMatch(JSON.parse(read('package.json')).description, /\(testnet\)/);
});

// ---- a third review ----
test('look-alikes: one word for each row of the table, a lower-case L, small capitals, and a protected word inside a longer name', () => {
  const note = (symbol, name = 'x') => lookalikeNote({ symbol, name, token: OTHER }, REAL, null);
  // Cyrillic, Greek, Armenian, Cherokee, Lisu, marked Latin and signs, a lower-case L and a bar, small capitals, digits
  for (const [s, want] of [['МІNТА', 'Not MINTA’s token'], ['UЅDС', 'Not USDC'], ['VУRЕ', 'Not VYRE’s token'], ['ΜΙΝΤΑ', 'Not MINTA’s token'], ['VΥRΕ', 'Not VYRE’s token'], ['ՍSDC', 'Not USDC'],
    ['ᏌᏚᎠᏟ'.replace('Ꮜ', 'U'), 'Not USDC'], ['ᎷᏆNᎢᎪ'.replace('Ꮖ', 'I'), 'Not MINTA’s token'], ['ꓴꓢꓓꓚ', 'Not USDC'], ['ꓦꓬꓣꓰ', 'Not VYRE’s token'], ['U$ÐC', 'Not USDC'], ['V¥R€', 'Not VYRE’s token'], ['M@NTA'.replace('@', 'I').replace('A', '@'), 'Not MINTA’s token'],
    ['MlNTA', 'Not MINTA’s token'], ['M|NTA', 'Not MINTA’s token'], ['ᴜsᴅᴄ', 'Not USDC'], ['ᴠʏʀᴇ', 'Not VYRE’s token'], ['ᴍɪɴᴛᴀ', 'Not MINTA’s token'], ['ᴡᴜꜱᴅᴄ', 'Not USDC'],
    ['U5DC', 'Not USDC'], ['M1NT4', 'Not MINTA’s token'], ['VYR3', 'Not VYRE’s token'], ['M1N7A', 'Not MINTA’s token'], ['U5DC0IN'.replace('0IN', ''), 'Not USDC']]) {
    assert.equal(note(s), want, `${JSON.stringify(s)} (${plainLook(s)})`);
  }
  // a protected word as one of the words of a ticker or name
  for (const s of ['USDC.e', 'USDC Token', 'Real USDC', 'usdc-v2', 'The USDC']) assert.equal(note(s), 'Not USDC', s);
  for (const s of ['MINTA Official', 'official minta', 'MINTA-2']) { assert.equal(note(s), 'Not MINTA’s token', s); assert.equal(note('X', s), 'Not MINTA’s token', `as a name: ${s}`); }
  assert.equal(note('VYRE Chain'), 'Not VYRE’s token');
  // but not as part of a longer word
  for (const s of ['USDCAT', 'XUSDC', 'MINTAX', 'VYRES', 'MINTAGE', 'Silly', 'ALL IN', 'DOGE']) assert.equal(note(s), '', s);
  // the network's own tokens, by address
  assert.equal(lookalikeNote({ symbol: 'VYRE', name: 'VYRE', token: OTHER }, REAL, OTHER), '');
  assert.equal(lookalikeNote({ symbol: 'VYRE', name: 'VYRE', token: REAL }, REAL, OTHER), 'Not VYRE’s token');
  assert.match(read('src/lib/network.ts'), /mainnet: \{[\s\S]*?vyreToken: null,/);
});

test('a dollar figure a hair under the next unit stays in its own unit', () => {
  assert.equal(usd(999999999999.999), '$999.99B');
  assert.equal(usd(999999.9999999999), '$999.99K');
  assert.equal(usd(999.999999999999), '$999.99');
  assert.equal(usd(999999999.99999), '$999.99M');
  assert.equal(usd(1e15), '$1,000T');
  assert.equal(usd(1000), '$1K');
});

test('an unsettled launch is kept for the tab, per wallet, and what is read back is checked', () => {
  const kept = new Map();
  const store = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v), removeItem: (k) => kept.delete(k) };
  const A = '0x' + 'Aa'.repeat(20), B = '0x' + 'bb'.repeat(20);
  const one = unsureStore(() => store, 'k');
  assert.equal(one.has(A), false);
  one.set(A, 'Your wallet didn’t confirm this.');
  assert.equal(one.has(A.toLowerCase()), true, 'whatever the letter case');
  assert.equal(one.has(B), false, 'another wallet has none');
  // another page load (a reload) reads it back
  const two = unsureStore(() => store, 'k');
  assert.equal(two.get(A), 'Your wallet didn’t confirm this.');
  two.delete(A);
  assert.equal(kept.has('k'), false, 'cleared from the tab too');
  assert.equal(unsureStore(() => store, 'k').has(A), false);
  // storage that can't be used: kept in memory for the page
  const none = unsureStore(() => { throw new Error('blocked'); }, 'k');
  none.set(A, 'x'); assert.equal(none.has(A), true);
  // only wallet addresses with short words are read back
  const back = parseUnsure(JSON.stringify({ [A.toLowerCase()]: 'ok', notAnAddress: 'x', [B]: 5, ['0x' + 'cc'.repeat(20)]: 'y'.repeat(601), ['0x' + 'dd'.repeat(20)]: '' }));
  assert.deepEqual([...back.keys()], [A.toLowerCase()]);
  for (const raw of [null, '', 'nope', '[]', '"x"', '{"a":', 'x'.repeat(50_000)]) assert.equal(parseUnsure(raw).size, 0);
  const launch = read('src/pages/Launch.tsx');
  assert.match(launch, /const unsureLaunch = unsureStore\(\(\) => \{ try \{ return window\.sessionStorage; \} catch \{ return null; \} \}, scoped\('minta\.unsureLaunch'\)\);/);
  assert.match(launch, /const pausedUntil = new Map<string, number>\(\);/, 'the pause is kept outside the dialog too');
});

test('where the pages load no file from another site, "Your own file" is not offered and a launch never points at one', () => {
  const fields = read('src/components/LaunchFileFields.tsx');
  assert.match(fields, /const own = NETWORK\.outsideFiles && \(part === 'all' \|\| part === 'own'\);/);
  assert.match(fields, /useEffect\(\(\) => \{ if \(!NETWORK\.outsideFiles && value\.useOwn\) onChange\(\{ \.\.\.value, useOwn: false \}\); \}, \[value\.useOwn\]\);/);
  const launch = read('src/pages/Launch.tsx');
  assert.match(launch, /if \(meta\.useOwn && NETWORK\.outsideFiles\) metadataURI = meta\.own\.trim\(\) \|\| undefined;/);
  assert.match(launch, /const ownFile = NETWORK\.outsideFiles && meta\.useOwn;/);
  assert.match(read('src/lib/api.ts'), /\$\{NETWORK\.outsideFiles \? ', or paste your own link under “Your own file”' : ''\}/);
  assert.match(read('src/pages/Manage.tsx'), /useOwn: NETWORK\.outsideFiles \}\)/);
});

test('the withdrawals card: the timer reads as far back as the list shows, and a claimed row is marked at once', () => {
  const wallet = read('src/pages/Wallet.tsx');
  assert.match(wallet, /const t = setInterval\(\(\) => \{ if \(loading\.current === 0\) load\(\); \}, 60_000\); return \(\) => clearInterval\(t\); \}, \[waiting, account, back\]\);/, 'no new load from the timer while one is on its way');
  assert.match(wallet, /const no = \+\+loadNo\.current;\n\s*const back = backNow\.current;/, 'a load looks as far back as the list does now, whichever render it was called from');
  assert.match(wallet, /onDone=\{\(\) => \{ setRows\(\(rs\) => rs && rs\.map\(\(r\) => \(keyOf\(r\) === keyOf\(w\) \? \{ \.\.\.r, state: 'claimed' as const \} : r\)\)\); load\(\); onDone\(\); \}\}/);
});

test('the wrapped USDC card never says "0 WUSDC" for dust, says an email wallet can’t unwrap here, and that unwrapping needs a little USDC', () => {
  const card = read('src/components/Wrapped.tsx');
  assert.match(card, /This wallet holds <b className="break">\{shortAmount\(held, 4\)\} WUSDC<\/b>/);
  assert.match(card, /it needs a little USDC on VYRE for the network fee/);
  assert.match(card, /\{email && <p className="small muted wrapped-email">An email wallet can’t send transactions on VYRE yet, so it can’t unwrap here\.<\/p>\}/);
});

test('the privacy pages say what each network’s pages do: mainnet reaches only verify.walletconnect.org and loads no file from another site', () => {
  const main = read('public/privacy/index.html');
  assert.doesNotMatch(main, /which that policy does not block/);
  assert.match(main, /the app’s security policy lets the page load that frame from, and send requests to, verify\.walletconnect\.org only/);
  assert.match(main, /<b>A token whose details are kept on another site<\/b>/);
  assert.match(read('public/privacy-testnet/index.html'), /which that policy does not block/, 'the test network’s page keeps its own sentence');
  assert.match(read('scripts/csp.mjs'), /it does not close every way out/);
  assert.doesNotMatch(read('scripts/csp.mjs'), /could send nothing anywhere else/);
});

test('small things: the hand-off note names the SDK, a long host wraps, the opening is "within about 1%" for assistants too', () => {
  assert.match(read('docs/HANDOFF.md'), /The vendored SDK is 0\.7\.1, which knows the new pad; the app's mainnet calls are still made in `padv2\.ts`\./);
  assert.doesNotMatch(read('docs/HANDOFF.md'), /0\.6\.0/);
  assert.match(read('src/pages/Token.tsx'), /\(<bdi className="break">\{outsideFile\(launch\.metadataURI\)\}<\/bdi>\)/);
  assert.match(read('public/llms-full.txt'), /the pool opens within about 1% of that market cap/);
  assert.match(read('public/terms-testnet/index.html'), /The terms for MINTA on VYRE Mainnet \(minta\.vyrechain\.com\) are at/);
});

// ---- a fourth review ----
test('each withdrawal is settled from its own read: a read that failed leaves that row as it was and blanks no other', () => {
  const row = (n, state) => ({ hash: `0x${n}`, position: BigInt(n), state });
  const key = (r) => `${r.hash}-${r.position}`;
  const list = [row(9), row(8), row(7), row(6)];
  const before = [row(9, 'waiting'), row(8, 'ready'), row(7, 'claimed')];
  // confirmed up to position 8 (so 7 and 6 are confirmed, 8 and 9 are not)
  const out = settleWithdrawals(list, [false, null, true, false], 8n, before, key);
  assert.deepEqual(out.map((r) => r.state), ['waiting', 'ready', 'claimed', 'ready'], 'read: waiting; failed: kept as it was; read: claimed; read and confirmed: ready');
  assert.deepEqual(settleWithdrawals(list, [null, null, null, null], 8n, null, key).map((r) => r.state), [undefined, undefined, undefined, undefined], 'nothing known, nothing claimed');
  assert.deepEqual(settleWithdrawals([row(5)], [false], 5n, null, key).map((r) => r.state), ['waiting'], 'a position not below the confirmed count is still waiting');
  assert.ok(SPENT_READS_PER_CALL >= 5 && SPENT_READS_PER_CALL <= 50);
  const wallet = read('src/pages/Wallet.tsx');
  const card = wallet.slice(wallet.indexOf('function CashOut'), wallet.indexOf('function addressProblem'));
  assert.doesNotMatch(card, /list\.map\(\(w\) => arc\.readContract/, 'never one request per withdrawal, all at once');
  assert.match(card, /inPieces\(list, SPENT_READS_PER_CALL, \(piece\) => arc\.multicall\(\{\n\s*allowFailure: true,/);
  assert.match(card, /const live = \(\) => cardFor\.current === mine && loadNo\.current === no;/, 'only the newest load’s answers are used');
});

test('look-alikes with a mark hung on the end, or a bar at either end, are caught', () => {
  const note = (symbol, name = 'x') => lookalikeNote({ symbol, name, token: OTHER }, REAL, null);
  for (const s of ['USDC|', '|USDC', '|USDC|', 'USDC™', 'USDC®', 'USDC©', 'USDC²', 'USDC℠', 'ՍSDC™', 'USDC｜', 'ＵＳＤＣ｜', '｜USDC', 'USDCʰ', 'USDC|\u0336', 'USDCǁ', 'USDCǃ', '|\u0338USDC']) assert.equal(note(s), 'Not USDC', s);
  // a bar hung on one word of a longer name
  for (const s of ['USDC| Token', 'Real USDC| Token', '|USDC| Coin', 'The USDC™ Token', 'Real |USDC']) { assert.equal(note('X', s), 'Not USDC', `as a name: ${s}`); assert.equal(note(s), 'Not USDC', s); }
  for (const s of ['MINTA| Official', 'Official |MINTA|']) assert.equal(note('X', s), 'Not MINTA’s token', s);
  for (const s of ['MINTA™', 'MINTA|', '|MINTA', 'MINTA®']) { assert.equal(note(s), 'Not MINTA’s token', s); assert.equal(note('X', s), 'Not MINTA’s token', `as a name: ${s}`); }
  for (const s of ['VYRE™', 'VYRE|', 'VYRE®']) assert.equal(note(s), 'Not VYRE’s token', s);
  for (const s of ['USDCAT', 'MINT', 'VYRE2', 'MINTA2', 'xUSDC', 'TM', '|', '™']) assert.equal(note(s), '', s);
  assert.equal(lookalikeNote({ symbol: 'MINTA', name: 'MINTA', token: REAL }, REAL, null), '', 'the real one still carries none');
});

test('the holders figure leaves out the first deployment’s contracts too; the privacy sentence about the verification frame is one sentence', () => {
  assert.match(read('src/lib/stats.ts'), /\.\.\.Object\.values\(\(a as \{ legacy\?: Record<string, unknown> \}\)\.legacy \?\? \{\}\)\]\.filter\(/);
  const privacy = read('public/privacy/index.html');
  assert.match(privacy, /MINTA does not choose it, and the app’s security policy lets the page load that frame from, and send requests to, verify\.walletconnect\.org only\./);
  assert.doesNotMatch(privacy, /lets the frame load only from verify\.walletconnect\.org \(this page/);
});
