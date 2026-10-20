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
const ok = (cond, what) => { if (!cond) { failed++; console.error('FAIL', what); } else console.log('ok  ', what); };
/** words the mainnet pages must not carry (testnet-only things, and wording the project does not use) */
const BANNED = /testnet|test usdc|test money|faucet|\b7357\b|sepolia|instant(?:ly)? withdraw|layer ?2|layer-2|trustless|audited|decentralized|decentralised|cheapest|promoter|airdrop|guaranteed|platform fee|per trade/i;

(async () => {
  const viem = await import('viem');
  const sdk = await import('@vyrechain/sdk');
  const pad = sdk.getAddresses(3045).pad.toLowerCase();
  const multicall = sdk.vyreMainnet.contracts.multicall3.address.toLowerCase();
  const m3 = viem.parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)']);

  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));

  /** `launchesOpen`: true, false, or 'unreadable' (the read fails). Returns the page, the hosts asked and the errors */
  const open = async (hash, launchesOpen, viewport = { width: 1440, height: 900 }) => {
    const ctx = await b.newContext({ viewport });
    await ctx.addInitScript(() => { try { window.localStorage.setItem('minta.splash', String(Date.now())); } catch { /* none */ } });
    const hosts = new Set();
    const answerCall = (to, data) => {
      if (to.toLowerCase() === multicall) {
        const calls = viem.decodeFunctionData({ abi: m3, data }).args[0];
        const results = calls.map((c) => {
          try { return { success: true, returnData: answerCall(c.target, c.callData) }; } catch { return { success: false, returnData: '0x' }; }
        });
        return viem.encodeFunctionResult({ abi: m3, functionName: 'aggregate3', result: results });
      }
      if (to.toLowerCase() === pad) {
        const call = viem.decodeFunctionData({ abi: sdk.vyrePadAbi, data });
        if (call.functionName === 'launchesOpen') {
          if (launchesOpen === 'unreadable') throw new Error('unreadable');
          return viem.encodeFunctionResult({ abi: sdk.vyrePadAbi, functionName: 'launchesOpen', result: launchesOpen });
        }
        if (call.functionName === 'launchCount') return viem.encodeFunctionResult({ abi: sdk.vyrePadAbi, functionName: 'launchCount', result: 0n });
      }
      throw new Error('not answered');
    };
    const answer = (req) => {
      const id = req.id;
      try {
        if (req.method === 'eth_chainId') return { jsonrpc: '2.0', id, result: '0xbe5' };
        if (req.method === 'eth_blockNumber') return { jsonrpc: '2.0', id, result: '0x31' };
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
    return { pg, ctx, errs, hosts };
  };
  const body = (pg) => pg.locator('body').innerText();

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
    ok(/Live/i.test(await pg.locator('.tk-live').innerText()) && /mainnet/i.test(await pg.locator('.tk-live').innerText()), 'the ticker says mainnet');
    await pg.waitForTimeout(800);
    ok([...hosts].every((h) => /^(?:rpc|api|explorer)\.vyrechain\.com$|^fonts\.(?:googleapis|gstatic)\.com$/.test(h)), `only mainnet hosts are asked (${[...hosts].join(', ') || 'none'})`);
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
    const { pg, ctx, errs } = await open('#/launch', false);
    await pg.waitForSelector('[data-launches=closed], .wz', { timeout: 8000 });
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
    const { pg, ctx, errs } = await open('#/launch', true);
    await pg.waitForSelector('.wz', { timeout: 8000 });
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
    ok(!/platform fee|per trade|MINTA fee/i.test(tokenomics), 'it states no platform or MINTA fee');
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
    ok(/1% \/ 10%/.test(review) && !/platform fee|per trade|MINTA fee|Trading fees/i.test(review), 'the final review shows the tax and no fee sentence');
    ok(!BANNED.test(await body(pg)), 'the wizard has no testnet-only wording' + (BANNED.test(await body(pg)) ? ': ' + (await body(pg)).match(BANNED)[0] : ''));
    ok(errs.length === 0, 'nothing throws in the wizard' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // ---- the switch can't be read: the wizard stays usable (the transaction is simulated before the wallet is asked)
  {
    const { pg, ctx } = await open('#/launch', 'unreadable');
    await pg.waitForSelector('.wz', { timeout: 8000 });
    await pg.waitForTimeout(600);
    ok(await pg.locator('.wz').count() === 1 && await pg.locator('[data-launches=closed]').count() === 0, 'if the switch can’t be read the wizard is still there');
    await ctx.close();
  }

  await b.close();
  srv.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED` : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
