// A browser check of MINTA built for VYRE mainnet (no VITE_NETWORK set: a production build is mainnet), with every outside request
// cut off except the mainnet RPC, which a stand-in answers: the app says plainly it is on mainnet, nothing testnet-only shows (the
// faucet, test USDC, testnet words, promoter links), and the Create page says "Launches open soon" while the launchpad contract has
// launches closed (read on chain: launchesOpen) and runs the wizard, with taxes limited to 1 to 10% a side, once they are open.
//   node test/mainnet.browser.cjs   (npm run test:browser runs it after the testnet check)
// (needs Playwright with a Chromium: PLAYWRIGHT=<its directory> and CHROME=<a Chromium binary> override)
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT || 'playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const WEB = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'minta-main-'));
const env = { ...process.env };
delete env.VITE_NETWORK;
execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir'], { cwd: WEB, stdio: 'ignore', env });
const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', json: 'application/json', webmanifest: 'application/json', mp4: 'video/mp4', webp: 'image/webp' };
const srv = http.createServer((q, r) => {
  let f = path.join(OUT, q.url.split('?')[0]);
  if (f.endsWith('/')) f += 'index.html';
  // every answer carries the headers vercel.json sends on the mainnet site's own host: the narrow content policy as a header, and the rest
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404, SITE_HEADERS); return r.end(); } r.writeHead(200, { ...SITE_HEADERS, 'content-type': types[f.split('.').pop()] || 'text/plain' }); r.end(d); });
});
const SITE_HEADERS = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(WEB, 'vercel.json'), 'utf8')).headers
  .filter((h) => h.source === '/(.*)' && !h.missing).flatMap((h) => h.headers).map((h) => [h.key, h.value]));

let failed = 0;
/** waits (up to 60 s) until `cond()` is true: the page has really asked the stand-in, so a slow machine can't make an assertion run too early */
const until = async (cond, ms = 60000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 50)); return cond(); };
const ok = (cond, what) => { if (!cond) { failed++; console.error('FAIL', what); } else console.log('ok  ', what); };
/** words the mainnet pages must not carry (testnet-only things, and wording the project does not use) */
const BANNED = /testnet|test usdc|test money|faucet|\b7357\b|sepolia|instant(?:ly)? withdraw|layer ?2|layer-2|trustless|audited|decentralized|decentralised|cheapest|promoter|airdrop|guaranteed|platform fee|per trade/i;

(async () => {
  const viem = await import('viem');
  const sdk = await import('@vyrechain/sdk');
  // the launchpad on mainnet is the new pad (src/lib/padv2.ts); the old one's address in the SDK is not asked
  const v2 = await import('../src/lib/padv2.ts');
  const pad = v2.PAD_V2.pad.toLowerCase();
  const TOKEN = viem.getAddress('0x1111111111111111111111111111111111111111');
  const POOL = viem.getAddress('0x2222222222222222222222222222222222222222');
  const CREATOR = viem.getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  ok(sdk.getAddresses(3045).pad.toLowerCase() === pad && sdk.getAddresses(3045).legacy.pad.toLowerCase() !== pad, 'the vendored SDK names the same launchpad as the app (the first one is only in its legacy record)');
  const multicall = sdk.vyreMainnet.contracts.multicall3.address.toLowerCase();
  const m3 = viem.parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));

  /** `launchesOpen`: true, false, or 'unreadable' (the read fails). Returns the page, the hosts asked and the errors */
  const open = async (hash, launchesOpen, viewport = { width: 1440, height: 900 }, init = null) => {
    const ctx = await b.newContext({ viewport });
    if (init?.script) await ctx.addInitScript(init.script, init.arg);
    // the team's list of hidden tokens and creators, when the test gives one (else the built file: empty)
    if (init?.blocklist) await ctx.route('**/blocklist.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(init.blocklist) }));
    await ctx.addInitScript(() => { try { window.localStorage.setItem('minta.splash', String(Date.now())); } catch { /* none */ } });
    const hosts = new Set();
    // launchesReads: how many times the page has asked the stand-in whether launches are open; wrapped: the wrapped USDC every account
    // holds; mined: the transaction hashes the stand-in chain has a receipt for
    const probe = { launchesReads: 0, wrapped: 0n, wrappedOf: {}, mined: new Set(), symbol: 'FEE', code: {}, balances: {}, held: new Set(), waiting: [], launchCount: 0n, launchLogs: [], head: '0x31', heldWrapped: new Set(), waitingWrapped: [], failWithdrawals: false, poolOf: {}, codeFails: false, tokenBalances: {}, arc: null, withdrawLogs: [] }; // poolOf: pool (lower case) -> its launch token; tokenBalances: account -> launch tokens held // balances / wrappedOf: per account (lower case); held: accounts whose balance answer waits in `waiting`; launchLogs: what eth_getLogs answers for the pad // symbol: the stand-in token's ticker; code: address (lower case) -> its code
    const wusdc = viem.parseAbi(['function balanceOf(address) view returns (uint256)', 'function withdraw(uint256 wad)']);
    const answerCall = (to, data) => {
      if (to.toLowerCase() === multicall && data.startsWith('0x4d2301cc')) { // getEthBalance(address)
        const who = ('0x' + data.slice(-40)).toLowerCase();
        const value = viem.encodeAbiParameters([{ type: 'uint256' }], [who in probe.balances ? probe.balances[who] : init ? 100n * 10n ** 18n : 0n]);
        // an answer the test holds back (a slow read for that account) until it lets it go
        return probe.held.has(who) ? new Promise((r) => probe.waiting.push(() => r(value))) : value;
      }
      if (to.toLowerCase() === multicall) {
        const calls = viem.decodeFunctionData({ abi: m3, data }).args[0];
        const results = calls.map((c) => {
          try { return { success: true, returnData: answerCall(c.target, c.callData) }; } catch { return { success: false, returnData: '0x' }; }
        });
        // (an answer the test holds back holds the whole batch back, as a slow node would)
        if (results.some((r) => typeof r.returnData?.then === 'function')) {
          return Promise.all(results.map(async (r) => ({ success: r.success, returnData: await r.returnData }))).then((done) => viem.encodeFunctionResult({ abi: m3, functionName: 'aggregate3', result: done }));
        }
        return viem.encodeFunctionResult({ abi: m3, functionName: 'aggregate3', result: results });
      }
      if (to.toLowerCase() === pad) {
        const call = viem.decodeFunctionData({ abi: v2.padV2Abi, data });
        if (call.functionName === 'launchesOpen') {
          probe.launchesReads += 1;
          if (launchesOpen === 'unreadable') throw new Error('unreadable');
          return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'launchesOpen', result: launchesOpen });
        }
        if (call.functionName === 'launchCount') return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'launchCount', result: probe.launchCount });
        // the page's own simulation of a launch passes (whatever stops it after that is the wallet's doing)
        if (call.functionName === 'createLaunch') return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'createLaunch', result: [TOKEN, POOL, 0n] });
      }
      if (to.toLowerCase() === v2.PAD_V2.wusdc.toLowerCase()) {
        const call = viem.decodeFunctionData({ abi: wusdc, data });
        if (call.functionName === 'balanceOf') {
          const who = String(call.args[0]).toLowerCase();
          const value = viem.encodeFunctionResult({ abi: wusdc, functionName: 'balanceOf', result: probe.wrappedOf[who] ?? probe.wrapped });
          return probe.heldWrapped.has(who) ? new Promise((r) => probe.waitingWrapped.push(() => r(value))) : value;
        }
        // unwrapping passes only for no more than is held
        if (call.functionName === 'withdraw') { if (call.args[0] > probe.wrapped && !Object.values(probe.wrappedOf).some((v) => call.args[0] <= v)) throw new Error('more than held'); return '0x'; }
      }
      // the chain's own withdrawal contract: the page's simulation of a move to Arc passes
      if (/^0x0{38}64$/.test(to.toLowerCase())) return viem.encodeAbiParameters([{ type: 'uint256' }], [1n]);
      // a launch on the new pad, to show a token page and a Manage page
      const t = TOKEN.toLowerCase();
      if (to.toLowerCase() === pad) {
        const call = viem.decodeFunctionData({ abi: v2.padV2Abi, data });
        const out = (result) => viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: call.functionName, result });
        if (call.functionName === 'launches') return out(String(call.args[0]).toLowerCase() === t ? [POOL, 250, 500, -200, 887200, CREATOR, 1700000000n] : [viem.zeroAddress, 0, 0, 0, 0, viem.zeroAddress, 0n]);
        if (call.functionName === 'metadataOf') return out('');
        if (call.functionName === 'taxWalletsOf') return out([[], []]);
        if (call.functionName === 'pendingCreator') return out(viem.zeroAddress);
        if (call.functionName === 'tokenOfPool') return out(probe.poolOf[String(call.args[0]).toLowerCase()] ?? viem.zeroAddress);
        if (call.functionName === 'tokens') return out(TOKEN);
        if (call.functionName === 'setTaxWallets') return '0x'; // the page's own simulation of saving a split passes
      }
      if (to.toLowerCase() === t) {
        const call = viem.decodeFunctionData({ abi: sdk.vyreTokenAbi, data });
        const out = (result) => viem.encodeFunctionResult({ abi: sdk.vyreTokenAbi, functionName: call.functionName, result });
        if (call.functionName === 'name') return out('Fee Check');
        if (call.functionName === 'symbol') return out(probe.symbol);
        if (call.functionName === 'totalSupply') return out(1000000n * 10n ** 18n);
        if (call.functionName === 'balanceOf') return out(probe.tokenBalances[String(call.args[0]).toLowerCase()] ?? 0n);
      }
      if (to.toLowerCase() === POOL.toLowerCase()) {
        const pool = viem.parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)', 'function token0() view returns (address)']);
        const call = viem.decodeFunctionData({ abi: pool, data });
        if (call.functionName === 'token0') return viem.encodeFunctionResult({ abi: pool, functionName: 'token0', result: TOKEN });
        return viem.encodeFunctionResult({ abi: pool, functionName: 'slot0', result: [2n ** 96n, 0, 0, 1, 1, 0, true] });
      }
      throw new Error('not answered');
    };
    const answer = (req) => {
      const id = req.id;
      try {
        if (req.method === 'eth_chainId') return { jsonrpc: '2.0', id, result: '0xbe5' };
        if (req.method === 'eth_blockNumber') return { jsonrpc: '2.0', id, result: probe.head };
        // (the chain's withdrawal contract's events: the Wallet page's list of withdrawals; the test can make that read fail)
        if (req.method === 'eth_getLogs' && probe.failWithdrawals && /^0x0{38}64$/.test(String(req.params[0].address || '').toLowerCase())) return { jsonrpc: '2.0', id, error: { code: -32000, message: 'server busy' } };
        if (req.method === 'eth_getLogs' && /^0x0{38}64$/.test(String(req.params[0].address || '').toLowerCase())) return { jsonrpc: '2.0', id, result: probe.withdrawLogs };
        if (req.method === 'eth_getLogs') return { jsonrpc: '2.0', id, result: String(req.params[0].address || '').toLowerCase() === pad ? probe.launchLogs : [] };
        if (req.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id, result: { number: '0x31', hash: '0x' + '0b'.repeat(32), timestamp: '0x6000', transactions: [], gasLimit: '0x1c9c380', baseFeePerGas: '0x1' } };
        if (req.method === 'eth_getBalance') return { jsonrpc: '2.0', id, result: init ? '0x56bc75e2d63100000' : '0x0' };
        if (req.method === 'eth_estimateGas') return { jsonrpc: '2.0', id, result: '0x7a120' };
        if (req.method === 'eth_getTransactionCount') return { jsonrpc: '2.0', id, result: '0x1' };
        if (req.method === 'eth_gasPrice' || req.method === 'eth_maxPriorityFeePerGas') return { jsonrpc: '2.0', id, result: '0x1' };
        if (req.method === 'eth_getCode' && probe.codeFails) return { jsonrpc: '2.0', id, error: { code: -32000, message: 'server busy' } };
        if (req.method === 'eth_getCode') return { jsonrpc: '2.0', id, result: probe.code[String(req.params[0]).toLowerCase()] || '0x' };
        if (req.method === 'eth_getTransactionReceipt' && probe.mined.has(req.params[0]) && probe.whenMined) { probe.whenMined(); probe.whenMined = null; } // (what the transaction did, done by the time its receipt is read)
        if (req.method === 'eth_getTransactionReceipt') return { jsonrpc: '2.0', id, result: probe.mined.has(req.params[0]) ? { transactionHash: req.params[0], transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), blockNumber: '0x31', from: '0x' + '3c'.repeat(20), to: v2.PAD_V2.wusdc, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2' } : null };
        if (req.method === 'eth_call') { const result = answerCall(req.params[0].to, req.params[0].data || req.params[0].input); return typeof result?.then === 'function' ? result.then((v) => ({ jsonrpc: '2.0', id, result: v })) : { jsonrpc: '2.0', id, result }; }
      } catch { /* falls through to the error */ }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'not answered' } };
    };
    // nothing leaves the machine but the mainnet RPC, which is a stand-in; every host asked is kept
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), async (route) => {
      const u = new URL(route.request().url());
      hosts.add(u.host);
      if (u.host === 'rpc.vyrechain.com' && route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || 'null');
        const out = Array.isArray(body) ? await Promise.all(body.map(answer)) : await answer(body);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(out) });
      }
      // Arc's RPC, when the test stands in for it (probe.arc: a function from a request to its answer); otherwise unreachable, as before
      if (u.host === 'rpc.mainnet.arc.io' && probe.arc) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (route.request().method() !== 'POST') return route.fulfill({ status: 204, headers: cors });
        const body = JSON.parse(route.request().postData() || 'null');
        const one = (q) => { try { return { jsonrpc: '2.0', id: q.id, result: probe.arc(q) }; } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: String(e.message || e) } }; } };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
      }
      if (u.host === 'rpc.vyrechain.com') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      return route.abort();
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR|CORS/.test(m.text()) && errs.push(m.text()));
    await pg.goto(base + hash);
    await pg.waitForSelector('.top');
    return { pg, ctx, errs, hosts, probe };
  };
  const body = (pg) => pg.locator('body').innerText();
  /** A browser wallet for the page (announced the standard way, remembered as the one picked last time): it holds the account `who`,
   * is on VYRE mainnet, and answers a send with `window.__answer`: an error ({ code, message }) or a transaction hash ({ hash }). Every
   * transaction it was asked to send is kept in `window.__asked`. */
  const standInWallet = (who) => {
    try { localStorage.setItem('vyre.wallet.mainnet', 'rdns:test.wallet'); localStorage.setItem('vyre.wallet:3045', 'rdns:test.wallet'); } catch { /* none */ }
    window.__sends = 0;
    window.__asked = [];
    window.__answer = { code: -32603, message: 'Request timed out' };
    window.__account = who;
    const listeners = {};
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [window.__account];
        if (method === 'eth_chainId') return '0xbe5';
        if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
          window.__sends++; window.__asked.push(params && params[0]);
          if (window.__answer.hash) return window.__answer.hash;
          // held: the wallet has the request open until the test answers it (window.__release(hash))
          if (window.__answer.hold) return new Promise((r) => { window.__release = r; });
          throw Object.assign(new Error(window.__answer.message), { code: window.__answer.code });
        }
        return null;
      },
      on(e, f) { (listeners[e] ||= new Set()).add(f); }, removeListener(e, f) { listeners[e]?.delete(f); },
    };
    // the person picks another account in the wallet
    window.__switch = (to) => { window.__account = to; (listeners.accountsChanged || []).forEach((f) => f([to])); };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'w', name: 'Test wallet', icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>', rdns: 'test.wallet' }, provider } })));
  };

  // ---- the network, shown plainly, on every page
  {
    const { pg, ctx, errs, hosts } = await open('#/', true);
    ok(/VYRE Mainnet/.test(await pg.locator('.chain-pill').innerText()), 'the top bar says VYRE Mainnet');
    ok(/real USDC/.test(await pg.locator('.foot').innerText()), 'the footer says the USDC is real');
    await pg.click('.chain-pill');
    const menu = await pg.locator('.chain-menu').innerText();
    ok(/chain 3045/.test(menu) && /VYRE Mainnet/.test(menu), 'the network menu names chain 3045');
    ok(!/faucet/i.test(menu), 'and has no Faucet link');
    ok(!BANNED.test(await body(pg)), 'the home page has no testnet-only or unused wording');
    await pg.waitForSelector('.home-top .topcap', { timeout: 8000 }).catch(() => {});
    const home = await body(pg);
    ok(!/King of the Hill|Contenders|takes the hill/i.test(home) && await pg.locator('.koth, .contenders-box').count() === 0, 'the home page has no King of the Hill box');
    ok(await pg.locator('.home-top .topcap').count() === 1 && /Top by liquidity/i.test(home), 'it leads with the top list');
    ok(/Live/i.test(await pg.locator('.tk-live').innerText()) && /mainnet/i.test(await pg.locator('.tk-live').innerText()), 'the ticker says mainnet');
    await pg.waitForTimeout(800);
    ok([...hosts].every((h) => /^(?:rpc|api|explorer)\.vyrechain\.com$/.test(h)), `only mainnet hosts are asked (${[...hosts].join(', ') || 'none'})`);
    ok(errs.length === 0, 'nothing throws on the home page' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the Wallet page: no faucet, no testnet sources, no promoter link
  {
    const { pg, ctx, errs } = await open('#/wallet', true);
    await pg.waitForTimeout(500);
    const t = await body(pg);
    ok(!BANNED.test(t), 'the Wallet page has no faucet, test USDC, testnet or promoter wording' + (BANNED.test(t) ? ': ' + t.match(BANNED)[0] : ''));
    ok(await pg.locator('text=Get test USDC').count() === 0 && await pg.locator('text=The faucet').count() === 0, 'no Get test USDC button and no faucet card');
    ok(errs.length === 0, 'nothing throws on the Wallet page' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the Wallet page with a wallet connected: still no promoter card or wording; wrapped USDC is shown and unwrapped
  {
    const A = '0x' + '3c'.repeat(20);
    const { pg, ctx, errs, probe } = await open('#/wallet', true, { width: 1440, height: 900 }, { arg: A, script: standInWallet });
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 20000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    ok(await soon(async () => /On VYRE\s*100 USDC/i.test(await body(pg))), 'the stand-in wallet is connected and its balance shown: ' + (await body(pg)).replace(/\s+/g, ' ').slice(0, 300));
    await pg.waitForTimeout(500);
    let t = await body(pg);
    ok(!BANNED.test(t), 'connected: the Wallet page has no faucet, test USDC, testnet or promoter wording' + (BANNED.test(t) ? ': ' + t.match(BANNED)[0] : ''));
    ok(await pg.locator('text=Your promoter link').count() === 0 && !/30%|platform fee/i.test(t), 'no promoter card, no “30% of the 1% platform fee”');
    ok(/Move to Arc/.test(t) && /a withdrawal takes about a day/.test(t) && !/half an hour/.test(t), 'moving to Arc says a withdrawal takes about a day');
    ok(await pg.locator('.wrapped-usdc').count() === 0, 'a wallet with no wrapped USDC is shown no wrapped USDC card');
    // an amount typed with a comma says how it was read; "0,125" is refused
    const move = pg.locator('.card', { hasText: 'Move to Arc' });
    await move.locator('input').fill('1,000.5');
    ok((await move.locator('.read-as').innerText()).trim() === 'read as 1000.5', 'an amount typed with a comma says how it was read, without commas');
    await move.locator('input').fill('0,125');
    ok(await move.locator('.read-as').count() === 0 && /Use a point for decimals, like 0\.125/.test(await move.innerText()) && await move.locator('button', { hasText: /Start the move|Move / }).isDisabled(), '“0,125” is refused, with the point it should be typed with');
    await move.locator('input').fill('');
    // the wallet now holds wrapped USDC (as after a tax payout)
    probe.wrapped = 1234567890000000000n; // 1.23456789
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
    const card = pg.locator('.wrapped-usdc');
    ok(await soon(async () => (await card.count()) === 1), 'a wallet holding wrapped USDC is shown it');
    const words = await card.innerText();
    ok(/1\.2345 WUSDC/.test(words) && /tax is paid out as wrapped USDC \(WUSDC\)/.test(words) && /one for one/.test(words), `with the amount and what it is (${words.replace(/\s+/g, ' ').slice(0, 140)})`);
    ok(!BANNED.test(words) && !/earn|profit|reward|income|yield/i.test(words), 'in neutral words');
    const btn = card.locator('button');
    ok((await btn.innerText()).trim() === 'Unwrap 1.23456789 WUSDC to USDC', `the button names the exact amount (${await btn.innerText()})`);
    // the wallet does not confirm: the cautious words, and nothing is claimed
    await btn.click();
    ok(await soon(async () => /didn’t confirm this/.test(await card.innerText())), 'a send the wallet does not confirm reads the same as every other send');
    const first = await pg.evaluate(() => window.__asked[0]);
    const want = viem.encodeFunctionData({ abi: viem.parseAbi(['function withdraw(uint256 wad)']), functionName: 'withdraw', args: [1234567890000000000n] });
    ok(first && first.to.toLowerCase() === v2.PAD_V2.wusdc.toLowerCase() && first.data === want && (!first.value || BigInt(first.value) === 0n), 'the wallet was asked for withdraw(exactly the balance) on the wrapped USDC token, with no value');
    // the balance moves before the next press: nothing is sent, and the button shows the new amount
    probe.wrapped = 1000000000000000000n;
    await btn.click();
    ok(await soon(async () => /changed since this page read it, so nothing was sent/.test(await card.innerText())), 'a balance that moved since it was read stops the send');
    ok(await pg.evaluate(() => window.__sends) === 1, 'and the wallet was not asked');
    ok(await soon(async () => (await btn.innerText()).trim() === 'Unwrap 1 WUSDC to USDC'), 'the button shows the new amount');
    // the wallet sends it and the chain confirms it
    const HASH = '0x' + 'aa'.repeat(32);
    await pg.evaluate((h) => { window.__answer = { hash: h }; }, HASH);
    probe.mined.add(HASH);
    probe.whenMined = () => { probe.wrapped = 0n; };
    await btn.click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 2), 'a press asks the wallet');
    ok(await soon(async () => (await card.locator('button').count()) === 0 && /Unwrapped 1 WUSDC to USDC\. This wallet holds no wrapped USDC now\./.test(await card.innerText().catch(() => ''))), 'once unwrapped, the card stays with its result and no button');
    ok(await card.locator(`a[href$="/tx/${HASH}"]`).count() === 1, 'and the link to the transaction');
    const second = await pg.evaluate(() => window.__asked[1]);
    ok(second.data === viem.encodeFunctionData({ abi: viem.parseAbi(['function withdraw(uint256 wad)']), functionName: 'withdraw', args: [10n ** 18n] }), 'for exactly the amount on the button');
    // an unwrap whose result could not be read at first (the button is “Check it”), then found gone through: the card keeps a result line too
    const HELD = '0x' + 'dd'.repeat(32);
    probe.wrapped = 3n * 10n ** 18n;
    await pg.evaluate(([a, h]) => sessionStorage.setItem(`minta.held..mainnetunwrap:${a}`, JSON.stringify({ hash: h, chainId: 3045, looked: false, at: Date.now() })), [A, HELD]);
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
    ok(await soon(async () => /Check it/.test(await card.locator('button').innerText().catch(() => ''))), 'an unwrap sent earlier whose result was not read: the card’s button is Check it');
    probe.mined.add(HELD);
    probe.whenMined = () => { probe.wrapped = 0n; };
    await pg.evaluate(() => { window.__sends = 0; });
    await card.locator('button').click();
    ok(await soon(async () => (await card.locator('button').count()) === 0 && /Your unwrap went through\. This wallet holds no wrapped USDC now\./.test(await card.innerText().catch(() => ''))), 'found gone through by Check it: the card stays and says so (' + (await card.innerText().catch(() => 'no card')).replace(/\s+/g, ' ').slice(0, 90) + ')');
    ok(await pg.evaluate(() => window.__sends) === 0, 'and the wallet was not asked');
    // the Manage page: the collect card says what arrives, and shows the wallet's wrapped USDC too
    probe.wrapped = 2n * 10n ** 18n;
    await pg.goto('about:blank'); await pg.goto(base + `#/manage/${TOKEN}`);
    const collect = pg.locator('.card', { hasText: 'Collect the tax' });
    ok(await soon(async () => (await collect.count()) === 1), 'the Manage page opens');
    t = await collect.innerText();
    ok(/It arrives as wrapped USDC \(WUSDC\)/.test(t) && /unwrap it to USDC here or on the Wallet page/.test(t) && !/so far, in USDC/.test(t), 'the collect card says the tax arrives as wrapped USDC that can be unwrapped');
    ok(await soon(async () => (await pg.locator('.wrapped-usdc button').count()) === 1) && (await pg.locator('.wrapped-usdc button').innerText()).trim() === 'Unwrap 2 WUSDC to USDC', 'and the wallet’s wrapped USDC is shown there with its button');
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- a token whose ticker reads as USDC in other letters says so; a tax wallet that is a contract is asked about once more
  {
    const { pg, ctx, errs, probe } = await open('#/', true, { width: 1440, height: 900 }, { arg: CREATOR, script: standInWallet });
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 20000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    probe.symbol = 'ՍЅDС'; // Armenian and Cyrillic letters
    await pg.goto('about:blank'); await pg.goto(base + `#/token/${TOKEN}`);
    ok(await soon(async () => (await pg.locator('.token-title .not-that').count()) === 1) && (await pg.locator('.token-title .not-that').innerText()).trim() === 'Not USDC', 'a ticker that reads as USDC in look-alike letters carries “Not USDC” by its name');
    ok(await soon(async () => (await pg.locator('.trade-card .not-that').count()) === 1) && (await pg.locator('.trade-card .not-that').innerText()).trim() === 'Not USDC', 'and on its trade panel');
    probe.symbol = '';
    await pg.goto('about:blank'); await pg.goto(base + `#/token/${TOKEN}`);
    ok(await soon(async () => /^\$0x1111…1111/.test((await pg.locator('.token-title').innerText().catch(() => '')).trim())), 'a token with an empty ticker is shown by its short address');
    ok(await pg.locator('.not-that').count() === 0, 'and carries no note');
    probe.symbol = 'FEE';
    // the creator splits the tax with a wallet that is a contract
    const SAFE = '0x' + '5a'.repeat(20);
    probe.code[SAFE] = '0x6080604052';
    await pg.goto('about:blank'); await pg.goto(base + `#/manage/${TOKEN}`);
    const split = pg.locator('.card', { hasText: 'Split the tax' });
    ok(await soon(async () => (await split.locator('input[aria-label="Wallet 1"]').count()) === 1), 'the creator sees the split editor');
    await split.locator('input[aria-label="Wallet 1"]').fill(SAFE);
    const save = split.locator('button', { hasText: /^Save the split/ });
    await pg.evaluate(() => { window.__answer = { code: 4001, message: 'User rejected the request.' }; });
    await save.click();
    ok(await soon(async () => /One of these wallets is a contract\. Nothing was sent/.test(await split.innerText())), 'saving a split with a contract in it stops and says so');
    ok(await pg.evaluate(() => window.__sends) === 0, 'the wallet was not asked');
    const tick = split.locator('.code-wallets input[type=checkbox]');
    ok(await tick.count() === 1 && /0x5a5a…5a5a is a contract, not an ordinary wallet\. A multi-signature wallet such as a Safe is fine/.test(await split.locator('.code-wallets').innerText()), 'a tick box names the wallet and says a Safe is fine');
    await save.click();
    await pg.waitForTimeout(800);
    ok(await pg.evaluate(() => window.__sends) === 0, 'pressing again without the tick sends nothing');
    await tick.check();
    await save.click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 1), 'with the tick, saving asks the wallet');
    const asked = await pg.evaluate(() => window.__asked[0]);
    const call = viem.decodeFunctionData({ abi: v2.padV2Abi, data: asked.data });
    ok(asked.to.toLowerCase() === pad && call.functionName === 'setTaxWallets' && call.args[1].length === 1 && call.args[1][0].toLowerCase() === SAFE && Number(call.args[2][0]) === 10000, 'for that split');
    // the launchpad's own contracts, of this deployment and of the first one, are refused as tax wallets before anything is asked
    await pg.goto('about:blank'); await pg.goto(base + `#/manage/${TOKEN}`);
    await soon(async () => (await split.locator('input[aria-label="Wallet 1"]').count()) === 1);
    await pg.evaluate(() => { window.__sends = 0; });
    for (const [name, addr] of [['the SwapRouter', v2.PAD_V2.swapRouter], ['the launchpad', v2.PAD_V2.pad], ['the first deployment’s launchpad', sdk.getAddresses(3045).legacy.pad], ['the first deployment’s fee splitter', sdk.getAddresses(3045).legacy.feeSplitter], ['this launch’s pool', POOL]]) {
      await split.locator('input[aria-label="Wallet 1"]').fill(addr);
      ok(/one of the chain’s or the launchpad’s own contracts/.test(await split.innerText()) && await split.locator('button', { hasText: /^Save the split/ }).isDisabled(), `${name} as a tax wallet: refused, and Save is off`);
    }
    // another launch's pool (the launchpad says so when asked): stopped at the press, nothing sent
    const OTHER_POOL = '0x' + '7e'.repeat(20);
    probe.poolOf[OTHER_POOL] = TOKEN;
    await split.locator('input[aria-label="Wallet 1"]').fill(OTHER_POOL);
    await split.locator('button', { hasText: /^Save the split/ }).click();
    ok(await soon(async () => /That’s a launch’s pool or token, not a wallet: tax sent there would be lost\. Nothing was sent/.test(await split.innerText())), 'another launch’s pool as a tax wallet is stopped at the press');
    // the wallets' code can't be read just now: nothing is saved unchecked
    probe.codeFails = true;
    await split.locator('input[aria-label="Wallet 1"]').fill('0x' + '6c'.repeat(20));
    await split.locator('button', { hasText: /^Save the split/ }).click();
    ok(await soon(async () => /Couldn’t check the wallets on VYRE just now, so nothing was sent/.test(await split.innerText())), 'when the wallets’ code can’t be read, the split is not saved');
    probe.codeFails = false;
    ok(await pg.evaluate(() => window.__sends) === 0, 'and in none of these cases was the wallet asked');
    // an ordinary wallet is not asked about
    await pg.goto('about:blank'); await pg.goto(base + `#/manage/${TOKEN}`);
    await soon(async () => (await split.locator('input[aria-label="Wallet 1"]').count()) === 1);
    await split.locator('input[aria-label="Wallet 1"]').fill('0x' + '6b'.repeat(20));
    await pg.evaluate(() => { window.__sends = 0; });
    await split.locator('button', { hasText: /^Save the split/ }).click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 1) && await split.locator('.code-wallets').count() === 0, 'a split of ordinary wallets is sent without a second question');
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the mainnet build carries its own narrower content policy: it reaches the hosts mainnet uses and no other
  {
    const { pg, ctx, errs } = await open('#/', true);
    const csp = await import('../scripts/csp.mjs');
    const meta = await pg.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content').catch(() => null);
    ok(meta === csp.mainnetPolicy(), 'the built page has the mainnet policy in its head');
    const tried = await pg.evaluate(async (urls) => {
      const blocked = [];
      document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
      for (const u of urls.fetch) await fetch(u, { method: 'POST', body: '{}' }).catch(() => {});
      for (const u of urls.img) await new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = u; setTimeout(r, 1500); });
      for (const u of urls.frame) { const f = document.createElement('iframe'); f.src = u; document.body.appendChild(f); await new Promise((r) => setTimeout(r, 300)); f.remove(); }
      try { const w = new WebSocket('wss://elsewhere.example/'); w.onerror = () => {}; } catch { /* refused */ }
      await new Promise((r) => setTimeout(r, 500));
      return blocked;
    }, {
      fetch: ['https://rpc.vyrechain.com/', 'https://api.vyrechain.com/x', 'https://explorer.vyrechain.com/api/v2/x', 'https://rpc.mainnet.arc.io/', 'https://elsewhere.example/steal', 'https://testnet-rpc.vyrechain.com/', 'https://pulse.walletconnect.org/e'],
      img: ['https://api.vyrechain.com/i/x.webp', 'https://elsewhere.example/p.png'],
      frame: ['https://verify.walletconnect.org/x', 'https://pw-auth.circle.com/', 'https://elsewhere.example/f'],
    });
    const hit = (dir, host) => tried.some((b) => b.startsWith(dir) && b.includes(host));
    ok(!hit('connect-src', '//rpc.vyrechain.com') && !hit('connect-src', '//api.vyrechain.com') && !hit('connect-src', '//explorer.vyrechain.com') && !hit('connect-src', '//rpc.mainnet.arc.io'), 'the chain, the app API, the explorer and Arc can be reached: ' + tried.join(' | '));
    ok(hit('connect-src', 'elsewhere.example/steal') && hit('connect-src', 'testnet-rpc.vyrechain.com') && hit('connect-src', 'pulse.walletconnect.org') && hit('connect-src', 'wss://elsewhere.example'), 'any other host, the test network’s and an unlisted WalletConnect one are refused, a WebSocket too');
    ok(!hit('img-src', 'api.vyrechain.com') && hit('img-src', 'elsewhere.example'), 'pictures load from the picture service only');
    ok(!hit('frame-src', 'verify.walletconnect.org') && hit('frame-src', 'pw-auth.circle.com') && hit('frame-src', 'elsewhere.example'), 'the only frame allowed is WalletConnect’s verification: not the email sign-in frame, which mainnet does not offer');
    ok(errs.filter((e) => !/elsewhere\.example|testnet-rpc|pulse\.walletconnect|pw-auth\.circle/.test(e)).length === 0, 'the page itself asks for nothing the policy refuses' + (errs.length ? ': ' + errs.join(' | ').slice(0, 300) : ''));
    // on the mainnet site's host the narrow policy is the HEADER: another document of the same origin (the terms, which have no tag of their own) is held to it too
    const head = await pg.evaluate(async () => (await fetch('/terms/')).headers.get('content-security-policy'));
    ok(head === csp.mainnetHeader() && SITE_HEADERS['Content-Security-Policy'] === csp.mainnetHeader(), 'the terms page is served with the narrow policy as its header');
    const other = await ctx.newPage();
    await other.goto(base + 'terms/');
    const viaTerms = await other.evaluate(async () => {
      const blocked = [];
      document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
      await fetch('https://elsewhere.example/steal', { method: 'POST', mode: 'no-cors', body: 'x' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      return blocked;
    });
    ok(viaTerms.some((b) => b.startsWith('connect-src') && b.includes('elsewhere.example')), 'a request from the terms page to another host is refused as well: ' + viaTerms.join(' | '));
    await other.close();
    await ctx.close();
  }

  // ---- the account changes in the wallet while a balance read and a transaction are on their way: nothing of the first account shows under the second
  {
    const A = '0x' + '3c'.repeat(20), B = '0x' + '4d'.repeat(20);
    const { pg, ctx, errs, probe } = await open('#/wallet', true, { width: 1440, height: 900 }, { arg: A, script: standInWallet });
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 20000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    probe.balances[A] = 100n * 10n ** 18n; probe.balances[B] = 7n * 10n ** 18n;
    probe.wrappedOf[A] = 10n ** 18n; probe.wrappedOf[B] = 2n * 10n ** 18n;
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet'); // (read again, now that the stand-in chain has these)
    const onVyre = async () => ((await pg.locator('.card.row-between .big').first().innerText().catch(() => '')).trim());
    ok(await soon(async () => (await onVyre()) === '100 USDC'), 'A is connected and its balance shown');
    const card = pg.locator('.wrapped-usdc');
    ok(await soon(async () => /Unwrap 1 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'with A’s wrapped USDC');
    // A presses Unwrap and the wallet keeps the request open; A's next balance read is slow
    await pg.evaluate(() => { window.__answer = { hold: true }; });
    await card.locator('button').click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 1), 'A’s unwrap is in the wallet');
    probe.held.add(A);
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
    ok(await soon(async () => probe.waiting.length > 0), 'A’s balance read is on its way');
    ok((await onVyre()) === '… USDC', 'and nothing is shown for it yet');
    // the wallet changes to B
    await pg.evaluate((b) => window.__switch(b), B);
    ok(await soon(async () => (await onVyre()) === '7 USDC'), 'after the change, B’s balance is shown');
    ok(await soon(async () => /Unwrap 2 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'and B’s wrapped USDC');
    // A's slow answer arrives now: it is dropped
    probe.held.clear(); for (const go of probe.waiting.splice(0)) go();
    await pg.waitForTimeout(800);
    ok((await onVyre()) === '7 USDC', 'A’s late balance is not shown under B');
    // the wallet changes to A, whose wrapped USDC is slow to read this time: B's amount is gone at once, not left standing under A
    probe.heldWrapped.add(A);
    await pg.evaluate((a) => window.__switch(a), A);
    ok(await soon(async () => probe.waitingWrapped.length > 0) && await soon(async () => (await card.count()) === 0), 'after a change, the last account’s wrapped USDC is not shown while the new one’s is being read');
    probe.heldWrapped.clear(); for (const go of probe.waitingWrapped.splice(0)) go();
    ok(await soon(async () => /Unwrap 1 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'then the new account’s own');
    await pg.evaluate((b) => window.__switch(b), B);
    ok(await soon(async () => /Unwrap 2 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'and back');
    // a run pressed as B that ends after the change back to A: its result is not shown or held under A
    await pg.evaluate(() => { window.__answer = { hold: true }; window.__sends = 0; });
    await card.locator('button').click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 1), 'B’s unwrap is in the wallet');
    ok(await soon(async () => /Working/.test(await card.locator('button').innerText().catch(() => ''))) && /Confirm in your wallet/.test(await card.innerText()), 'and B’s own button shows it (a run is shown under the account it was pressed for)');
    await pg.evaluate((a) => window.__switch(a), A);
    ok(await soon(async () => /Unwrap 1 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'the wallet changes back to A: A’s card');
    const HASH = '0x' + 'bb'.repeat(32);
    probe.mined.add(HASH);
    await pg.evaluate((h) => window.__release(h), HASH);
    await pg.waitForTimeout(1500);
    const text = await card.innerText();
    ok(!/Unwrapped 2 WUSDC|Working|Confirm in your wallet/.test(text) && /Unwrap 1 WUSDC to USDC/.test(await card.locator('button').innerText()) && await card.locator('button').isEnabled(), `B’s result is not shown under A, and A’s button is A’s own (${text.replace(/\s+/g, ' ').slice(-120)})`);
    ok(await pg.evaluate((a) => Object.keys(sessionStorage).filter((k) => k.startsWith('minta.held.') && k.includes(`unwrap:${a}`)).length, A) === 0, 'and nothing is held under A’s name');
    // a token page: the wallet changes while the first account's balances are slow: they are never shown under the second
    probe.tokenBalances[A] = 500n * 10n ** 18n; probe.tokenBalances[B] = 3n * 10n ** 18n;
    await pg.evaluate((a) => window.__switch(a), A);
    await pg.goto('about:blank'); await pg.goto(base + `#/token/${TOKEN}`);
    const balLine = async () => ((await pg.locator('.trade-card .field span.muted.small').first().innerText().catch(() => '')).trim());
    ok(await soon(async () => (await balLine()) === 'Balance: 100 USDC'), `A’s balance is on the token page (${await balLine()})`);
    probe.held.add(A);
    await pg.goto('about:blank'); await pg.goto(base + `#/token/${TOKEN}`);
    ok(await soon(async () => probe.waiting.length > 0), 'A’s balances are being read (slowly)');
    await pg.evaluate((b) => window.__switch(b), B);
    await pg.waitForTimeout(500);
    ok(!/100 USDC|500/.test(await balLine()), `nothing of A’s is shown after the change (${await balLine()})`);
    // A's slow answers arrive now, and B's own
    probe.held.clear(); for (const go of probe.waiting.splice(0)) go();
    ok(await soon(async () => (await balLine()) === 'Balance: 7 USDC'), `B’s balance is shown (${await balLine()})`);
    await pg.waitForTimeout(800);
    ok((await balLine()) === 'Balance: 7 USDC', `A’s late balances are not shown under B (${await balLine()})`);
    await pg.locator('.trade-card .seg button.sell').click();
    ok(await soon(async () => /^Balance: 3 \W?FEE\W?$/u.test(await balLine())), `nor A’s tokens (${await balLine()})`);
    await pg.evaluate((a) => window.__switch(a), A);
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
    ok(await soon(async () => /Unwrap 1 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), 'back on the Wallet page as A');
    // the same for a button that stays on the page through the change (Move to Arc): A starts a move, the wallet changes to B, then A's answer comes
    const moveCard = pg.locator('.card', { hasText: 'Move to Arc' });
    await moveCard.locator('input').fill('1');
    await pg.evaluate(() => { window.__answer = { hold: true }; window.__sends = 0; });
    await moveCard.locator('.tx > button').click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 1) && await soon(async () => /Working/.test(await moveCard.locator('.tx > button').innerText())), 'A’s move to Arc is in the wallet, and A’s button shows it');
    probe.failWithdrawals = true;
    await pg.evaluate((b) => window.__switch(b), B);
    ok(await soon(async () => /Move 1 USDC to Arc/.test(await moveCard.locator('.tx > button').innerText())), 'the wallet changes to B: the button is B’s, not busy');
    ok(await soon(async () => (await moveCard.locator('.withdrawals-unread').count()) === 1), 'B’s own list of withdrawals is read for B (here it fails, and says so)');
    probe.failWithdrawals = false;
    // B presses the same button while A's request is still open in the wallet: B's press is B's own, and asks the wallet
    const releaseA = await pg.evaluateHandle(() => window.__release);
    await pg.evaluate(() => { window.__answer = { code: 4001, message: 'User rejected the request.' }; });
    await moveCard.locator('.tx > button').click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 2), 'B’s press asks the wallet, although A’s request is still open there');
    ok(await soon(async () => /Cancelled in your wallet/.test(await moveCard.locator('.status').innerText().catch(() => ''))), 'and B’s own answer is shown under B');
    const HASH2 = '0x' + 'cc'.repeat(32);
    probe.mined.add(HASH2);
    await pg.evaluate(([release, h]) => release(h), [releaseA, HASH2]);
    await pg.waitForTimeout(2500);
    const underB = await moveCard.locator('.status').innerText().catch(() => 'no status');
    ok(/Cancelled in your wallet/.test(underB) && !/withdrawal|Started|went through|couldn’t be read/i.test(underB) && /Move 1 USDC to Arc/.test(await moveCard.locator('.tx > button').innerText()), 'A’s result (whatever it was) is not shown under B: ' + underB.slice(0, 120));
    await pg.evaluate((a) => window.__switch(a), A);
    await soon(async () => /Unwrap/.test(await card.locator('button').innerText().catch(() => '')));
    // a phone: the unwrap button's words fit, and the page does not scroll sideways
    probe.wrappedOf[A] = 12345678901234567890n; // 12.34567890123456789
    for (const width of [360, 320]) {
      await pg.setViewportSize({ width, height: 740 });
      await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
      ok(await soon(async () => /Unwrap 12\.34567890123456789 WUSDC to USDC/.test(await card.locator('button').innerText().catch(() => ''))), `at ${width} px the card shows the full amount`);
      const fit = await pg.evaluate(() => {
        const b = document.querySelector('.wrapped-usdc button'); const r = b.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect();
        return { inside: t.left >= r.left - 0.5 && t.right <= r.right + 0.5 && r.right <= window.innerWidth + 0.5, sideways: document.documentElement.scrollWidth - window.innerWidth, at: `button ${Math.round(r.left)}..${Math.round(r.right)}, words ${Math.round(t.left)}..${Math.round(t.right)}` };
      });
      ok(fit.inside && fit.sideways <= 1, `at ${width} px the unwrap button’s words stay inside it and the page does not scroll sideways (${fit.at}, ${fit.sideways} px over)`);
    }
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- a blocked creator's token stays hidden after it was handed to another wallet (who launched it is read from the launch events)
  {
    const BAD = '0x' + 'ba'.repeat(20);
    const ev = v2.padV2Abi.find((x) => x.type === 'event' && x.name === 'LaunchCreated');
    const plain = ev.inputs.filter((i) => !i.indexed);
    const value = (t) => (t === 'string' ? 'x' : t === 'address' ? viem.zeroAddress : /^u?int(8|16|24|32)$/.test(t) ? 1 : 1n);
    // the launch event names BAD as the creator; the launchpad now names CREATOR (the launch was handed over)
    const launchLog = {
      address: v2.PAD_V2.pad, topics: viem.encodeEventTopics({ abi: v2.padV2Abi, eventName: 'LaunchCreated', args: { token: TOKEN, creator: BAD, pool: POOL } }),
      data: viem.encodeAbiParameters(plain, plain.map((i) => value(i.type))), blockNumber: '0x80', blockHash: '0x' + '0b'.repeat(32), transactionHash: '0x' + 'c1'.repeat(32), transactionIndex: '0x0', logIndex: '0x0', removed: false,
    };
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 20000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    for (const [logs, hidden] of [[[launchLog], true], [[], false]]) {
      const { pg, ctx, errs, probe } = await open('#/docs', true, { width: 1440, height: 900 }, { blocklist: { version: 1, tokens: [], creators: [BAD] } });
      probe.launchCount = 1n; probe.launchLogs = logs; probe.head = '0x100'; // (past the launchpad's first block, so its events are read)
      await pg.goto('about:blank'); await pg.goto(base + `#/token/${TOKEN}`);
      if (hidden) {
        ok(await soon(async () => /MINTA hides this token because it was reported/.test(await body(pg))), 'a token launched by a blocked creator and handed to another wallet: its page shows the hidden notice');
        ok(!/FEE|Fee Check/.test(await body(pg)), 'and neither its ticker nor its name');
        await pg.goto('about:blank'); await pg.goto(base + '#/');
        await pg.waitForSelector('.top');
        await pg.waitForTimeout(3000);
        ok(await pg.locator(`a[href*="${TOKEN}"]`).count() === 0 && !/\$FEE/.test(await body(pg)), 'and it is not in the list of tokens');
      } else {
        // the same launch, same list, when no launch event names the blocked creator: shown (so the check above is the event's doing)
        ok(await soon(async () => (await pg.locator('.token-title').count()) === 1) && /\$FEE/.test(await pg.locator('.token-title').innerText()), 'the same token when the blocked creator did not launch it: shown');
        await pg.goto('about:blank'); await pg.goto(base + '#/');
        ok(await soon(async () => (await pg.locator(`a[href*="${TOKEN}"]`).count()) > 0), 'and listed');
      }
      ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }
  }

  // ---- the withdrawals list: each row is settled from its own answer in one call to Arc's Multicall3; a row whose read failed stays as it was
  {
    const A = '0x' + '3c'.repeat(20);
    const { pg, ctx, errs, probe } = await open('#/docs', true, { width: 1440, height: 900 }, { arg: A, script: standInWallet });
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 25000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    const rollup = sdk.getAddresses(3045).rollup;
    const dflt = (p) => {
      const arr = /^(.*)\[(\d*)\]$/.exec(p.type);
      if (arr) return arr[2] ? Array.from({ length: Number(arr[2]) }, () => dflt({ ...p, type: arr[1] })) : [];
      if (p.type === 'tuple') return Object.fromEntries(p.components.map((c) => [c.name, dflt(c)]));
      if (p.type === 'address') return viem.zeroAddress;
      if (p.type === 'bool') return false;
      if (p.type === 'string') return '';
      if (p.type === 'bytes') return '0x';
      if (p.type.startsWith('bytes')) return '0x' + '00'.repeat(Number(p.type.slice(5)));
      return /^u?int(8|16|24|32|48)$/.test(p.type) ? 0 : 0n;
    };
    // the rollup's latest confirmed assertion: one that confirms no withdrawal yet (its block hash is zero), so an unpaid withdrawal is "waiting"
    const assertionCreated = viem.parseAbiItem(/parseAbiItem\('(event AssertionCreated[^']+)'\)/.exec(fs.readFileSync(require.resolve('@vyrechain/sdk').replace(/index\.js$/, 'withdraw.js'), 'utf8'))[1]);
    const HASH = '0x' + '11'.repeat(32);
    const m3arc = viem.parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);
    const spent = {}; // position -> true | false | 'fail' (that entry of the multicall fails)
    let multicalls = 0, singles = 0;
    probe.arc = (q) => {
      if (q.method === 'eth_chainId') return '0x13b2';
      if (q.method === 'eth_blockNumber') return '0x10';
      if (q.method === 'eth_getBalance') return '0x0';
      if (q.method === 'eth_getLogs') {
        const plain = assertionCreated.inputs.filter((i) => !i.indexed);
        return [{ address: rollup.rollup, topics: viem.encodeEventTopics({ abi: [assertionCreated], eventName: 'AssertionCreated', args: { assertionHash: HASH, parentAssertionHash: viem.zeroHash } }), data: viem.encodeAbiParameters(plain, plain.map(dflt)), blockNumber: '0x1', blockHash: '0x' + '0b'.repeat(32), transactionHash: '0x' + 'a1'.repeat(32), transactionIndex: '0x0', logIndex: '0x0', removed: false }];
      }
      if (q.method === 'eth_call') {
        const to = String(q.params[0].to).toLowerCase(); const data = q.params[0].data || q.params[0].input;
        if (to === rollup.rollup.toLowerCase()) {
          const call = viem.decodeFunctionData({ abi: sdk.rollupAbi, data });
          if (call.functionName === 'latestConfirmed') return viem.encodeFunctionResult({ abi: sdk.rollupAbi, functionName: 'latestConfirmed', result: HASH });
          const out = sdk.rollupAbi.find((x) => x.name === 'getAssertion').outputs;
          return viem.encodeFunctionResult({ abi: sdk.rollupAbi, functionName: 'getAssertion', result: out.length === 1 ? { ...dflt(out[0]), createdAtBlock: 1n } : out.map(dflt) });
        }
        if (to === sdk.arcMainnet.contracts.multicall3.address.toLowerCase()) {
          multicalls++;
          const calls = viem.decodeFunctionData({ abi: m3arc, data }).args[0];
          return viem.encodeFunctionResult({ abi: m3arc, functionName: 'aggregate3', result: calls.map((c) => {
            const pos = String(viem.decodeFunctionData({ abi: sdk.outboxAbi, data: c.callData }).args[0]);
            return spent[pos] === 'fail' ? { success: false, returnData: '0x' } : { success: true, returnData: viem.encodeFunctionResult({ abi: sdk.outboxAbi, functionName: 'isSpent', result: spent[pos] === true }) };
          }) });
        }
        if (to === rollup.outbox.toLowerCase()) { singles++; throw new Error('one request for one withdrawal'); }
      }
      throw new Error('not answered');
    };
    // two withdrawals this wallet started, at positions 5 and 6
    const l2ToL1 = sdk.arbSysAbi.find((x) => x.type === 'event' && x.name === 'L2ToL1Tx');
    const plainW = l2ToL1.inputs.filter((i) => !i.indexed);
    const withdrawal = (position, usdc) => ({
      address: sdk.ARB_SYS, topics: viem.encodeEventTopics({ abi: sdk.arbSysAbi, eventName: 'L2ToL1Tx', args: { destination: A, hash: BigInt(position) + 1000n, position: BigInt(position) } }),
      data: viem.encodeAbiParameters(plainW, plainW.map((i) => (i.name === 'caller' ? A : i.name === 'callvalue' ? BigInt(usdc) * 10n ** 18n : i.name === 'timestamp' ? 1700000000n : dflt(i)))),
      blockNumber: '0x20', blockHash: '0x' + '0b'.repeat(32), transactionHash: '0x' + String(position).repeat(64).slice(0, 64), transactionIndex: '0x0', logIndex: `0x${position}`, removed: false,
    });
    probe.withdrawLogs = [withdrawal(5, 2), withdrawal(6, 3)];
    // first read: position 5 is read (not paid out: waiting), position 6's own read fails
    spent['5'] = false; spent['6'] = 'fail';
    await pg.clock.install();
    await pg.goto('about:blank'); await pg.goto(base + '#/wallet');
    const moveCard = pg.locator('.card', { hasText: 'Move to Arc' });
    const rowOf = (usdc) => moveCard.locator('.withdrawals li', { hasText: `${usdc} USDC` });
    ok(await soon(async () => (await moveCard.locator('.withdrawals li').count()) === 2), 'both withdrawals are listed');
    ok(await soon(async () => /Waiting to be confirmed on Arc/.test(await rowOf(2).innerText())), 'the one whose read answered is settled (waiting)');
    ok(/Checking…/.test(await rowOf(3).innerText()) && !/Waiting|Paid out|Claim/.test(await rowOf(3).innerText()), `the one whose own read failed is left as it was, not guessed (${(await rowOf(3).innerText()).replace(/\s+/g, ' ')})`);
    ok(await moveCard.locator('.withdrawals-unread').count() === 1, 'and the line above the list says some could not be read');
    ok(multicalls >= 1 && singles === 0, `the reads went to Arc as one call through its Multicall3, never one request per withdrawal (${multicalls} calls, ${singles} single reads)`);
    // a minute later (one is waiting, so the list reads again): 5 has been paid out; 6 is read this time
    spent['5'] = true; spent['6'] = false;
    const before = multicalls;
    await pg.clock.fastForward(61_000);
    ok(await soon(async () => /Paid out on Arc/.test(await rowOf(2).innerText())), 'a minute later the list reads again: the first is paid out');
    ok(await soon(async () => /Waiting to be confirmed on Arc/.test(await rowOf(3).innerText())), 'and the second, read this time, is waiting');
    ok(multicalls > before && await soon(async () => (await moveCard.locator('.withdrawals-unread').count()) === 0), 'with nothing unread any more');
    // a later read in which the paid-out one's own answer fails: it stays paid out, the other settles
    spent['5'] = 'fail'; spent['6'] = true;
    await pg.clock.fastForward(61_000);
    ok(await soon(async () => /Paid out on Arc/.test(await rowOf(3).innerText())) && /Paid out on Arc/.test(await rowOf(2).innerText()), 'a row whose read fails later keeps the state it had (paid out), and the other settles');
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the docs
  {
    const { pg, ctx, errs } = await open('#/docs', true);
    const t = await body(pg);
    ok(!BANNED.test(t), 'the docs have no testnet-only or unused wording' + (BANNED.test(t) ? ': ' + t.match(BANNED)[0] : ''));
    ok(errs.length === 0, 'nothing throws in the docs' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- a promoter link does nothing on mainnet
  {
    const { pg, ctx } = await open('?ref=0x70997970C51812dc3A010C7d01b50e0d17dc79C8#/', true);
    await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => window.localStorage.getItem('vyre.ref')) === null, 'a ?ref= link is ignored: nothing is stored');
    await ctx.close();
  }

  // ---- the Create page, launches closed
  {
    const { pg, ctx, errs, probe } = await open('#/launch', false);
    ok(await until(() => probe.launchesReads > 0), 'the Create page asks whether launches are open');
    await pg.waitForSelector('[data-launches=closed]', { timeout: 30000 }).catch(() => {});
    const closed = await pg.locator('[data-launches=closed]').count();
    ok(closed === 1, 'with launches closed on chain, the Create page says so');
    ok(/Launches open soon/i.test(await body(pg)), 'in the words “Launches open soon”');
    ok(await pg.locator('.wz').count() === 0, 'and the wizard is not offered');
    ok(await pg.locator('a:has-text("Explore launches")').count() === 1, 'with a way back to browsing');
    ok(!BANNED.test(await body(pg)), 'no testnet-only wording there either');
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the Create page, launches open: the wizard, with the fee in words
  {
    const { pg, ctx, errs, probe } = await open('#/launch', true);
    ok(await until(() => probe.launchesReads > 0), 'the Create page asks whether launches are open (open case)');
    await pg.waitForSelector('.wz', { timeout: 30000 });
    await pg.waitForTimeout(600);
    ok(await pg.locator('[data-launches=closed]').count() === 0, 'with launches open the Create page is the wizard');
    await pg.fill('.wz-step input[placeholder="My Token"]', 'My Token');
    await pg.fill('.wz-step input[placeholder="MYT"]', 'MYT');
    await pg.click('.wz-next');
    await pg.click('.wz-next');
    const tokenomics = await pg.locator('.wz-step').innerText();
    ok(/1 to 10%/.test(tokenomics), 'the tokenomics step says taxes are 1 to 10% a side');
    ok(await pg.locator('.setting-cards, .wz-step').locator('button:has-text("No tax")').count() === 0, 'and offers no “No tax” choice');
    ok(await pg.locator('.wz-step button:has-text("1% / 1%")').count() === 1, 'while the 1% / 1% choice is there');
    ok(!/platform fee|per trade|MINTA fee|10% of every/i.test(tokenomics), 'it states no platform or MINTA fee, and never “10% of every trade”');
    ok(/only fee a trader pays/.test(tokenomics) && /1 to 10% on each side/.test(tokenomics) && /a tenth of it goes to the platform wallet and the rest to your tax wallets/.test(tokenomics) && /in USDC/.test(tokenomics),
      'it says the creator’s tax is the only fee a trader pays, 1 to 10% a side in USDC, a tenth to the platform wallet and the rest to the tax wallets');
    await pg.click('.wz-step button:has-text("Custom")');
    await pg.fill('.wz-step input[placeholder="1 to 10"] >> nth=0', '0');
    await pg.click('.wz-next');
    ok(/Taxes can be 1 to 10%/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a buy tax of 0 is refused in words');
    await pg.fill('.wz-step input[placeholder="1 to 10"] >> nth=0', '11');
    await pg.click('.wz-next');
    ok(/Taxes can be 1 to 10%/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'and so is 11');
    await pg.fill('.wz-step input[placeholder="1 to 10"] >> nth=0', '1');
    await pg.fill('.wz-step input[placeholder="1 to 10"] >> nth=1', '10');
    await pg.click('.wz-next');
    await pg.click('.wz-next');
    const review = await pg.locator('.wz-step').innerText();
    ok(/1% \/ 10%/.test(review) && /a tenth goes to the platform wallet, the rest to the creator’s tax wallets/.test(review) && !/platform fee|per trade|MINTA fee|Trading fees|10% of every/i.test(review), 'the final review shows the tax, where it goes in words, and no fee sum');
    ok(!BANNED.test(await body(pg)), 'the wizard has no testnet-only wording' + (BANNED.test(await body(pg)) ? ': ' + (await body(pg)).match(BANNED)[0] : ''));
    ok(errs.length === 0, 'nothing throws in the wizard' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- a launch the wallet was asked to send and did not confirm: the launch button says to check the wallet first and sends nothing;
  // a separate button says it isn't there; closing and reopening the dialog does not forget it; a double press sends nothing
  {
    const A = '0x' + '3c'.repeat(20);
    const { pg, ctx, errs } = await open('#/launch', true, { width: 1440, height: 900 }, { arg: A, script: standInWallet });
    await pg.waitForSelector('.wz', { timeout: 30000 });
    const toReview = async () => {
      await pg.click('.wz-step button[type=submit]:has-text("Review")', { timeout: 5000 });
      await pg.waitForSelector('[role=dialog][aria-labelledby=review-title]', { timeout: 5000 });
    };
    let ownFileOffered = 0;
    const fill = async (devBuy = '1') => {
      await pg.waitForSelector('.wz', { timeout: 30000 });
      await pg.fill('.wz-step input[placeholder="My Token"]', 'My Token');
      await pg.fill('.wz-step input[placeholder="MYT"]', 'MYT');
      await pg.click('.wz-next');
      await pg.fill('.wz-step input[placeholder="0"]', devBuy); // a dev buy, so the button's words carry it
      for (let i = 0; i < 3; i++) { ownFileOffered += await pg.locator('text=/Your own file/i').count(); await pg.click('.wz-next'); }
      ownFileOffered += await pg.locator('text=/Your own file/i').count();
      await pg.check('.accept-terms input');
      await toReview();
    };
    await fill();
    ok(ownFileOffered === 0, 'the mainnet wizard offers no “Your own file” at any step (a file on another site is not loaded here)');
    const dlg = pg.locator('[role=dialog][aria-labelledby=review-title]');
    const main = dlg.locator('button.create-launch');
    const notThere = dlg.locator('button.not-in-wallet');
    const sends = () => pg.evaluate(() => window.__sends);
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 20000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    ok(/^Create token with a 1 USDC dev buy$/.test((await main.innerText()).trim()) && await main.isEnabled(), `the review opens with the launch button on (${await main.innerText()})`);
    await main.click();
    ok(await soon(async () => /didn’t confirm this/.test(await dlg.innerText().catch(() => ''))), 'the wallet is asked and does not confirm: the page says it may have gone out');
    ok(await sends() === 1, 'the wallet was asked once');
    const said = await dlg.locator('[role=alert]').innerText();
    ok(/Your wallet didn’t confirm this\. It said: “Request timed out”\. It may still have gone out/.test(said) && !/Nothing was sent/.test(said), `in the cautious words (${said.slice(0, 120)})`);
    ok((await main.innerText()).trim() === 'Check your wallet first with a 1 USDC dev buy' && await main.isDisabled(), `the launch button says to check the wallet first, keeps the dev buy in its words, and is off (${await main.innerText()})`);
    ok(await notThere.count() === 1 && /It isn’t in my wallet/.test(await notThere.innerText()), 'and a separate button says it isn’t there');
    ok(!/Try again/.test(await dlg.innerText()), 'nothing offers “Try again”');
    // pressing the launch button now (forced: it is off) sends nothing
    await main.click({ force: true }).catch(() => {});
    await pg.keyboard.press('Enter');
    ok(await sends() === 1, 'pressing the launch button sends nothing');
    // closing the dialog every way, and opening it again: still unsettled, still nothing sent
    for (const close of [() => pg.keyboard.press('Escape'), () => dlg.locator('button:has-text("Back to details")').click(), () => pg.locator('.overlay').dispatchEvent('mousedown')]) {
      await close();
      await soon(async () => (await dlg.count()) === 0);
      if (await dlg.count()) await dlg.locator('button:has-text("Back to details")').click();
      await toReview();
      ok(await main.isDisabled() && /^Check your wallet first/.test((await main.innerText()).trim()) && await notThere.count() === 1 && /didn’t confirm this/.test(await dlg.innerText()), 'closed and reopened: still “Check your wallet first”, with the words and the separate button');
    }
    ok(await sends() === 1, 'and nothing more was sent');
    // the deliberate press, twice in a row and with Enter held: the launch button comes back, but nothing is sent by those presses
    await notThere.dblclick();
    await pg.keyboard.press('Enter');
    await pg.keyboard.press('Enter');
    await main.click({ force: true }).catch(() => {});
    ok(await sends() === 1, 'a double press on “It isn’t in my wallet” (and Enter after it) sends nothing');
    ok(await dlg.count() === 1 && await notThere.isDisabled() && /didn’t confirm this/.test(await dlg.innerText()), 'the dialog, the words and that button stay in place for a moment (the second press lands on nothing else)');
    ok(/^Try again with a 1 USDC dev buy$/.test((await main.innerText()).trim()), `the launch button's words change at once, dev buy and all (${await main.innerText()})`);
    ok(await main.isDisabled(), 'and the launch button is off for a moment after that press');
    const spot = await notThere.boundingBox();
    ok(await soon(async () => main.isEnabled()), 'then it is on again');
    ok(await notThere.count() === 1 && await notThere.isDisabled(), 'the “It isn’t in my wallet” button stays where it was, off, while the dialog is open');
    ok(await soon(async () => /You can create the token again now\./.test(await dlg.locator('[role=status]').textContent())), 'the dialog says the token can be created again');
    ok(await soon(async () => pg.evaluate(() => document.activeElement?.classList.contains('create-launch'))), 'and the launch button has the focus');
    // one more press where “It isn’t in my wallet” was, after the pause: it lands on that same button (off), not on the launch button
    await pg.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await pg.waitForTimeout(400);
    const under = await pg.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className || '', [spot.x + spot.width / 2, spot.y + spot.height / 2]);
    ok(await sends() === 1 && /not-in-wallet/.test(under), `a press at the same place after the pause asks the wallet for nothing (under the pointer: ${under})`);
    await pg.evaluate(() => { window.__answer = { code: 4001, message: 'User rejected the request.' }; });
    await main.click();
    ok(await soon(async () => (await sends()) === 2), 'a deliberate press on the launch button after that asks the wallet again');
    ok(await soon(async () => /Cancelled in your wallet/.test(await dlg.innerText().catch(() => ''))), 'a refusal reads as a cancel');
    ok(await main.isEnabled() && /^Try again/.test((await main.innerText()).trim()), 'and after a plain cancel the button is an ordinary “Try again” (nothing may have gone out)');
    // unsettled again, then a reload: the tab still knows, and the review still says to check the wallet first
    await pg.evaluate(() => { window.__answer = { code: -32603, message: 'Request timed out' }; });
    await main.click();
    ok(await soon(async () => (await sends()) === 3) && await soon(async () => /^Check your wallet first/.test((await main.innerText()).trim())), 'a later send the wallet does not confirm is unsettled again');
    ok(await notThere.isEnabled(), 'and its “It isn’t in my wallet” button is on again');
    // Enter held down on “It isn’t in my wallet”, through the pause and after it (when the launch button takes the focus): nothing is sent
    await notThere.focus();
    await pg.keyboard.down('Enter');
    for (let i = 0; i < 30; i++) { await pg.waitForTimeout(100); await pg.keyboard.down('Enter'); } // (a held key repeats)
    const focused = await pg.evaluate(() => document.activeElement?.classList.contains('create-launch'));
    await pg.keyboard.up('Enter');
    ok(await sends() === 3 && focused && await main.isEnabled(), `Enter held for three seconds on “It isn’t in my wallet” asks the wallet for nothing, though the launch button is on and focused by then (sends ${await sends()})`);
    // a fresh press of Enter, after letting go, does launch (the wallet does not confirm: unsettled again)
    await pg.keyboard.press('Enter');
    ok(await soon(async () => (await sends()) === 4) && await soon(async () => /^Check your wallet first/.test((await main.innerText()).trim())), 'a fresh press of Enter after letting go asks the wallet');
    await pg.reload();
    await fill('25.5');
    ok(await sends() === 0 && await main.isDisabled() && (await main.innerText()).trim() === 'Check your wallet first with a 25.5 USDC dev buy' && /didn’t confirm this/.test(await dlg.innerText()), `after a reload the review still says to check the wallet first (${await main.innerText()})`);
    // on phones the words of every button in the review stay inside it and inside the dialog, dev buy and all
    for (const width of [360, 320]) {
      await pg.setViewportSize({ width, height: 740 });
      await pg.waitForTimeout(200);
      const fit = await pg.evaluate(() => {
        const d = document.querySelector('[role=dialog][aria-labelledby=review-title]').getBoundingClientRect();
        const out = [];
        for (const b of document.querySelectorAll('[role=dialog] .dialog-actions .btn')) {
          const r = b.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect();
          // no word of a button is broken across lines (each word is drawn in one piece)
          const text = b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild : null;
          let broken = '';
          for (const m of (b.textContent || '').matchAll(/\S+/g)) {
            const node = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes(m[0]));
            if (!node) continue;
            const w = document.createRange(); const at = node.textContent.indexOf(m[0]); w.setStart(node, at); w.setEnd(node, at + m[0].length);
            if (w.getClientRects().length > 1) broken = m[0];
          }
          void text;
          if (broken) out.push(`${b.textContent}: the word “${broken}” is broken across lines in a button ${Math.round(r.width)} px wide`);
          if (r.left < d.left - 0.5 || r.right > d.right + 0.5 || t.left < r.left - 0.5 || t.right > r.right + 0.5 || b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent}: button ${Math.round(r.left)}..${Math.round(r.right)}, words ${Math.round(t.left)}..${Math.round(t.right)}, dialog ${Math.round(d.left)}..${Math.round(d.right)}`);
        }
        return { out, sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      ok(fit.out.length === 0 && !fit.sideways, `at ${width} px no button’s words are cut off in the review` + (fit.out.length ? ': ' + fit.out.join(' | ') : ''));
    }
    // a very long dev-buy amount at 320 px: every button stays inside the review box and its words inside it
    await pg.reload();
    await fill('1234567.123456789012345678');
    await pg.setViewportSize({ width: 320, height: 740 });
    await pg.waitForTimeout(200);
    const long = await pg.evaluate(() => {
      const d = document.querySelector('[role=dialog][aria-labelledby=review-title]').getBoundingClientRect();
      const out = [];
      for (const b of document.querySelectorAll('[role=dialog] .dialog-actions .btn')) {
        const r = b.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect();
        if (r.left < d.left - 0.5 || r.right > d.right + 0.5 || t.left < r.left - 0.5 || t.right > r.right + 0.5) out.push(`${(b.textContent || '').slice(0, 40)}: button ${Math.round(r.left)}..${Math.round(r.right)}, words ${Math.round(t.left)}..${Math.round(t.right)}, box ${Math.round(d.left)}..${Math.round(d.right)}`);
      }
      return { out, label: document.querySelector('[role=dialog] .create-launch').textContent, sideways: document.documentElement.scrollWidth - window.innerWidth };
    });
    ok(/1,234,567\.123456789012345678 USDC dev buy/.test(long.label) && long.out.length === 0 && long.sideways <= 1, `at 320 px with an 18-decimal dev buy the buttons stay inside the review box (${long.label})` + (long.out.length ? ': ' + long.out.join(' | ') : ''));
    await dlg.locator('button:has-text("Back to details")').click();
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.reload();
    await fill('25.5');
    // the other answer: it did go out. The review closes, nothing is sent, and the state is cleared
    await dlg.locator('button.went-out').click();
    ok(await soon(async () => (await dlg.count()) === 0) && await sends() === 0, '“it went out” closes the review and sends nothing');
    await toReview();
    ok(await soon(async () => main.isEnabled()) && /^Create token with a 25\.5 USDC dev buy$/.test((await main.innerText()).trim()), 'and the review is an ordinary one again');
    ok(errs.length === 0, 'nothing throws' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the switch can't be read: the wizard stays usable (the transaction is simulated before the wallet is asked)
  {
    const { pg, ctx, probe } = await open('#/launch', 'unreadable');
    ok(await until(() => probe.launchesReads > 0), 'the Create page asks whether launches are open (unreadable case)');
    await pg.waitForSelector('.wz', { timeout: 30000 });
    await pg.waitForTimeout(600);
    ok(await pg.locator('.wz').count() === 1 && await pg.locator('[data-launches=closed]').count() === 0, 'if the switch can’t be read the wizard is still there');
    await ctx.close();
  }

  // ---- a token page and a Manage page: the fee in words, the platform wallet, no partner fee
  {
    const { pg, ctx, errs } = await open(`#/token/${TOKEN}`, true);
    await pg.waitForSelector('.stats-card', { timeout: 10000 });
    const card = await pg.locator('.stats-card').innerText();
    ok(/Buy tax\s*2\.5%/.test(card) && /Sell tax\s*5%/.test(card), 'the token page shows the launch’s two taxes');
    ok(/the only fee a trade pays, in USDC/.test(card) && /one tenth of it goes to the platform wallet/.test(card) && /rest to the creator’s tax wallets/.test(card), 'and says the tax is the only fee, in USDC, a tenth of it to the platform wallet and the rest to the creator’s tax wallets');
    ok(await pg.locator('.stats-card a', { hasText: '0x7293' }).count() >= 1, 'with the platform wallet linked');
    ok(!/Partner fee|platform fee|per trade|10% of every|MINTA fee/i.test(card), 'and no partner fee, platform fee or “10% of every trade”');
    await pg.fill('.trade-card input', '100');
    await pg.waitForTimeout(700);
    ok(!/promoter/i.test(await pg.locator('.trade-card').innerText()), 'the trade panel has no promoter note');
    // the full amount is written under the box whenever the button would show it shortened, and not otherwise
    const exactLine = async () => (await pg.locator('.trade-card .exact-amount').count()) ? (await pg.locator('.trade-card .exact-amount').innerText()).trim() : null;
    const soon = async (cond) => { const t = Date.now(); while (Date.now() - t < 15000) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
    ok(await exactLine() === null, 'a round amount has no “Exactly” line');
    await pg.fill('.trade-card input', '1.123456');
    ok(await soon(async () => (await exactLine()) === 'Exactly 1.123456 USDC'), 'a buy with more than four decimals shows the full amount under the box');
    await pg.fill('.trade-card input', '1000.5');
    ok(await soon(async () => (await exactLine()) === null), 'and one the button shows whole does not');
    await pg.locator('.trade-card .seg button', { hasText: 'Sell' }).click();
    await pg.fill('.trade-card input', '11714096.582707705307803293');
    ok(await soon(async () => /^Exactly 11,714,096\.582707705307803293 /.test((await exactLine()) || '')), 'a sale of an amount with 18 decimals shows every one of them under the box');
    await pg.fill('.trade-card input', '5');
    ok(await soon(async () => (await exactLine()) === null), 'and a round sale does not');
    ok(errs.length === 0, 'nothing throws on the token page' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  await b.close();
  srv.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED` : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
