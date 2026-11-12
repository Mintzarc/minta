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
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[f.split('.').pop()] || 'text/plain' }); r.end(d); });
});

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
    if (init) await ctx.addInitScript(init.script, init.arg);
    await ctx.addInitScript(() => { try { window.localStorage.setItem('minta.splash', String(Date.now())); } catch { /* none */ } });
    const hosts = new Set();
    // launchesReads: how many times the page has asked the stand-in whether launches are open; wrapped: the wrapped USDC every account
    // holds; mined: the transaction hashes the stand-in chain has a receipt for
    const probe = { launchesReads: 0, wrapped: 0n, mined: new Set(), symbol: 'FEE', code: {} }; // symbol: the stand-in token's ticker; code: address (lower case) -> its code
    const wusdc = viem.parseAbi(['function balanceOf(address) view returns (uint256)', 'function withdraw(uint256 wad)']);
    const answerCall = (to, data) => {
      if (to.toLowerCase() === multicall && data.startsWith('0x4d2301cc')) return viem.encodeAbiParameters([{ type: 'uint256' }], [init ? 100n * 10n ** 18n : 0n]); // getEthBalance
      if (to.toLowerCase() === multicall) {
        const calls = viem.decodeFunctionData({ abi: m3, data }).args[0];
        const results = calls.map((c) => {
          try { return { success: true, returnData: answerCall(c.target, c.callData) }; } catch { return { success: false, returnData: '0x' }; }
        });
        return viem.encodeFunctionResult({ abi: m3, functionName: 'aggregate3', result: results });
      }
      if (to.toLowerCase() === pad) {
        const call = viem.decodeFunctionData({ abi: v2.padV2Abi, data });
        if (call.functionName === 'launchesOpen') {
          probe.launchesReads += 1;
          if (launchesOpen === 'unreadable') throw new Error('unreadable');
          return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'launchesOpen', result: launchesOpen });
        }
        if (call.functionName === 'launchCount') return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'launchCount', result: 0n });
        // the page's own simulation of a launch passes (whatever stops it after that is the wallet's doing)
        if (call.functionName === 'createLaunch') return viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: 'createLaunch', result: [TOKEN, POOL, 0n] });
      }
      if (to.toLowerCase() === v2.PAD_V2.wusdc.toLowerCase()) {
        const call = viem.decodeFunctionData({ abi: wusdc, data });
        if (call.functionName === 'balanceOf') return viem.encodeFunctionResult({ abi: wusdc, functionName: 'balanceOf', result: probe.wrapped });
        // unwrapping passes only for no more than is held
        if (call.functionName === 'withdraw') { if (call.args[0] > probe.wrapped) throw new Error('more than held'); return '0x'; }
      }
      // a launch on the new pad, to show a token page and a Manage page
      const t = TOKEN.toLowerCase();
      if (to.toLowerCase() === pad) {
        const call = viem.decodeFunctionData({ abi: v2.padV2Abi, data });
        const out = (result) => viem.encodeFunctionResult({ abi: v2.padV2Abi, functionName: call.functionName, result });
        if (call.functionName === 'launches') return out(String(call.args[0]).toLowerCase() === t ? [POOL, 250, 500, -200, 887200, CREATOR, 1700000000n] : [viem.zeroAddress, 0, 0, 0, 0, viem.zeroAddress, 0n]);
        if (call.functionName === 'metadataOf') return out('');
        if (call.functionName === 'taxWalletsOf') return out([[], []]);
        if (call.functionName === 'pendingCreator') return out(viem.zeroAddress);
        if (call.functionName === 'tokenOfPool') return out(viem.zeroAddress);
        if (call.functionName === 'tokens') return out(TOKEN);
        if (call.functionName === 'setTaxWallets') return '0x'; // the page's own simulation of saving a split passes
      }
      if (to.toLowerCase() === t) {
        const call = viem.decodeFunctionData({ abi: sdk.vyreTokenAbi, data });
        const out = (result) => viem.encodeFunctionResult({ abi: sdk.vyreTokenAbi, functionName: call.functionName, result });
        if (call.functionName === 'name') return out('Fee Check');
        if (call.functionName === 'symbol') return out(probe.symbol);
        if (call.functionName === 'totalSupply') return out(1000000n * 10n ** 18n);
        if (call.functionName === 'balanceOf') return out(0n);
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
        if (req.method === 'eth_blockNumber') return { jsonrpc: '2.0', id, result: '0x31' };
        if (req.method === 'eth_getLogs') return { jsonrpc: '2.0', id, result: [] };
        if (req.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id, result: { number: '0x31', hash: '0x' + '0b'.repeat(32), timestamp: '0x6000', transactions: [], gasLimit: '0x1c9c380', baseFeePerGas: '0x1' } };
        if (req.method === 'eth_getBalance') return { jsonrpc: '2.0', id, result: init ? '0x56bc75e2d63100000' : '0x0' };
        if (req.method === 'eth_estimateGas') return { jsonrpc: '2.0', id, result: '0x7a120' };
        if (req.method === 'eth_getTransactionCount') return { jsonrpc: '2.0', id, result: '0x1' };
        if (req.method === 'eth_gasPrice' || req.method === 'eth_maxPriorityFeePerGas') return { jsonrpc: '2.0', id, result: '0x1' };
        if (req.method === 'eth_getCode') return { jsonrpc: '2.0', id, result: probe.code[String(req.params[0]).toLowerCase()] || '0x' };
        if (req.method === 'eth_getTransactionReceipt') return { jsonrpc: '2.0', id, result: probe.mined.has(req.params[0]) ? { transactionHash: req.params[0], transactionIndex: '0x0', blockHash: '0x' + '0b'.repeat(32), blockNumber: '0x31', from: '0x' + '3c'.repeat(20), to: v2.PAD_V2.wusdc, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', type: '0x2' } : null };
        if (req.method === 'eth_call') return { jsonrpc: '2.0', id, result: answerCall(req.params[0].to, req.params[0].data || req.params[0].input) };
      } catch { /* falls through to the error */ }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'not answered' } };
    };
    // nothing leaves the machine but the mainnet RPC, which is a stand-in; every host asked is kept
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), async (route) => {
      const u = new URL(route.request().url());
      hosts.add(u.host);
      if (u.host === 'rpc.vyrechain.com' && route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || 'null');
        const out = Array.isArray(body) ? body.map(answer) : answer(body);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(out) });
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
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [who];
        if (method === 'eth_chainId') return '0xbe5';
        if (method === 'eth_sendTransaction' || method === 'wallet_sendTransaction') {
          window.__sends++; window.__asked.push(params && params[0]);
          if (window.__answer.hash) return window.__answer.hash;
          throw Object.assign(new Error(window.__answer.message), { code: window.__answer.code });
        }
        return null;
      },
      on() {}, removeListener() {},
    };
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
    ok((await move.locator('.read-as').innerText()).trim() === 'read as 1,000.5', 'an amount typed with a comma says how it was read');
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
    await btn.click();
    ok(await soon(async () => (await pg.evaluate(() => window.__sends)) === 2), 'a press asks the wallet');
    probe.wrapped = 0n;
    ok(await soon(async () => (await card.count()) === 0), 'once unwrapped, the card is gone (the wallet holds none)');
    const second = await pg.evaluate(() => window.__asked[1]);
    ok(second.data === viem.encodeFunctionData({ abi: viem.parseAbi(['function withdraw(uint256 wad)']), functionName: 'withdraw', args: [10n ** 18n] }), 'for exactly the amount on the button');
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
    await pg.fill('.wz-step input[placeholder="My Token"]', 'My Token');
    await pg.fill('.wz-step input[placeholder="MYT"]', 'MYT');
    await pg.click('.wz-next');
    await pg.fill('.wz-step input[placeholder="0"]', '1'); // a dev buy, so the button's words carry it
    for (let i = 0; i < 3; i++) await pg.click('.wz-next');
    await pg.check('.accept-terms input');
    await toReview();
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
    ok(await soon(async () => main.isEnabled()), 'then it is on again');
    ok(await notThere.count() === 0, 'and the “It isn’t in my wallet” button is gone');
    await pg.evaluate(() => { window.__answer = { code: 4001, message: 'User rejected the request.' }; });
    await main.click();
    ok(await soon(async () => (await sends()) === 2), 'a deliberate press on the launch button after that asks the wallet again');
    ok(await soon(async () => /Cancelled in your wallet/.test(await dlg.innerText().catch(() => ''))), 'a refusal reads as a cancel');
    ok(await notThere.count() === 0 && await main.isEnabled() && /^Try again/.test((await main.innerText()).trim()), 'and after a plain cancel the button is an ordinary “Try again” (nothing may have gone out)');
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
