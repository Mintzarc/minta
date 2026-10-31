// A browser check of MINTA's WalletConnect connection on a fresh mainnet build (chain 3045), with every outside request cut off. The
// WalletConnect relay is not used: a small page (test/harness-wc) mounts the app's own wallet provider, connect button, connect
// sheet and transaction button, and a stand-in wallet takes the place of what the library connects to (setWcDriver).
// What it must show: connect (code and Trust Wallet link, then connected), the wrong network (refused with the add-to-wallet link,
// before and during a connection), a rejection, the wallet ending the connection, a changed account, a saved connection restored
// only when valid, a double tap, cancelling before approval (a late approval is ended), the relay being down, and that every
// transaction sent goes to the intended contract from the connected account and nothing else.
//   node test/walletconnect.browser.cjs   (needs Playwright with a Chromium: PLAYWRIGHT=<its directory> and CHROME=<a Chromium binary> override)
// It cannot test a real wallet app or the real relay.
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT || 'playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const WEB = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'minta-wc-'));
const env = { ...process.env };
delete env.VITE_NETWORK; // a production build is mainnet
execFileSync('npx', ['vite', 'build', path.join(__dirname, 'harness-wc'), '--config', path.join(WEB, 'vite.config.ts'), '--outDir', OUT, '--emptyOutDir', '--base', './'], { cwd: WEB, stdio: 'ignore', env });
const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', json: 'application/json', woff2: 'font/woff2' };
const srv = http.createServer((q, r) => {
  let f = path.join(OUT, q.url.split('?')[0]);
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[f.split('.').pop()] || 'text/plain' }); r.end(d); });
});

let failed = 0;
const ok = (cond, what) => { if (!cond) { failed++; console.error('FAIL', what); } else console.log('ok  ', what); };
const until = async (pg, fn, arg, ms = 15000) => { try { await pg.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const PAD = '0x3333333333333333333333333333333333333333';

  const open = async (init = () => {}, viewport = { width: 1000, height: 800 }) => {
    const ctx = await b.newContext({ viewport });
    const outside = [];
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => { outside.push(route.request().url()); route.abort(); });
    await ctx.addInitScript(init);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto(base);
    await pg.waitForSelector('#who');
    return { pg, ctx, errs, outside };
  };
  const chooseWc = async (pg) => {
    await pg.getByRole('button', { name: 'Sign in' }).first().click();
    await pg.getByRole('menuitem', { name: /^WalletConnect/ }).click();
  };
  const who = (pg) => pg.locator('#who').innerText();
  const sent = (pg) => pg.evaluate(() => window.__sent);
  const buy = async (pg) => {
    await pg.getByRole('button', { name: 'Buy', exact: true }).click();
    return until(pg, () => document.querySelector('#trade .status') && !/Checking|Confirm|Waiting|Sending|…/.test(document.querySelector('#trade .status').textContent), null, 20000);
  };

  // ---- connect: the sheet shows the code and Trust Wallet's link; approving connects; a trade goes to the contract from the account
  {
    const { pg, ctx, errs, outside } = await open();
    ok(await who(pg) === 'none', 'starts disconnected');
    await chooseWc(pg);
    await pg.waitForSelector('.wc-qr');
    ok(await pg.locator('.wc-qr path').count() === 1, 'the sheet draws the pairing address as a code');
    const trust = await pg.locator('a:has-text("Open Trust Wallet")').getAttribute('href');
    const uri = await pg.evaluate(() => window.__ids.URI);
    ok(trust === `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`, 'the Trust Wallet button uses its documented form with the encoded address');
    ok((await pg.locator('.modal-card').innerText()).includes('sees your IP address'), 'the sheet says the service sees the IP address');
    ok(await pg.evaluate(() => window.__starts) === 1, 'one pairing was started');
    await pg.evaluate(() => window.__pair.resolve());
    ok(await until(pg, () => document.querySelector('#who').textContent !== 'none'), 'approving connects');
    ok((await who(pg)).toLowerCase() === ME.toLowerCase(), 'the connected account is the wallet’s');
    ok(await pg.locator('.wc-qr').count() === 0, 'the sheet closes');
    ok(await pg.evaluate(() => localStorage.getItem('minta.wc:3045')) === '1', 'the connection is noted for a reload');
    ok(await buy(pg), 'a trade finishes');
    const s = await sent(pg);
    ok(s.length === 1 && s[0].method === 'eth_sendTransaction', 'exactly one transaction was sent');
    ok(s[0].params[0].to.toLowerCase() === PAD.toLowerCase() && s[0].params[0].from.toLowerCase() === ME.toLowerCase(), 'it went to the contract, from the connected account');
    ok(s[0].chain === 'eip155:3045', 'it was addressed to VYRE’s chain');
    // from another account: refused, not sent
    await pg.getByRole('button', { name: 'Send from another account' }).click();
    ok(await until(pg, () => /isn’t from the account you connected/.test(document.querySelector('#other .status')?.textContent || '')), 'a transaction from another account is refused with a plain message');
    ok((await sent(pg)).length === 1, 'and was not sent');
    // moving the connection to Arc is refused
    await pg.getByRole('button', { name: 'Move on Arc' }).click();
    ok(await until(pg, () => /works on VYRE only/.test(document.querySelector('#arc .status')?.textContent || '')), 'a step on another network says this connection is for VYRE only');
    // Disconnect: the wallet app is told, the note is cleared
    await pg.locator('.connect > button').first().click();
    await pg.getByRole('menuitem', { name: 'Disconnect' }).click();
    ok(await who(pg) === 'none', 'Disconnect clears the account');
    ok(await pg.evaluate(() => window.__disconnects) === 1, 'and ends the connection in the wallet');
    ok(await pg.evaluate(() => localStorage.getItem('minta.wc:3045')) === null, 'and forgets it');
    ok(errs.length === 0, 'no page errors ' + errs.join('|'));
    ok(outside.every((u) => !/pulse\.walletconnect|verify\.walletconnect|echo\.walletconnect|rpc\.walletconnect/.test(u)), 'nothing asked an analytics or verify host');
    await ctx.close();
  }

  // ---- the wrong network at connect: refused with the add-to-wallet link, nothing connected
  {
    const { pg, ctx } = await open(() => {});
    await pg.evaluate(() => { window.__fake.chain = 1; });
    await chooseWc(pg);
    await pg.waitForSelector('.wc-qr');
    await pg.evaluate(() => window.__pair.resolve());
    await pg.waitForSelector('.modal-card [role=alert]');
    const t = await pg.locator('.modal-card [role=alert]').innerText();
    ok(/https:\/\/vyrechain\.com\/add\//.test(t), 'a wallet not on VYRE is told how to add it');
    ok(await who(pg) === 'none', 'and is not connected');
    ok(await pg.evaluate(() => window.__disconnects) === 1, 'the connection it made is ended');
    ok(await pg.evaluate(() => localStorage.getItem('minta.wc:3045')) === null, 'nothing is kept');
    await ctx.close();
  }

  // ---- the wallet moves to another network, then another account, mid-flow
  {
    const { pg, ctx } = await open();
    await chooseWc(pg); await pg.waitForSelector('.wc-qr'); await pg.evaluate(() => window.__pair.resolve());
    await until(pg, () => document.querySelector('#who').textContent !== 'none');
    await pg.evaluate(() => { window.__fake.chain = 1; window.__emit('chainChanged', '0x1'); });
    ok(await until(pg, () => /moved off VYRE/.test(document.body.innerText)), 'a chain change shows a notice');
    await pg.getByRole('button', { name: 'Buy', exact: true }).click();
    ok(await until(pg, () => /isn’t on VYRE/.test(document.querySelector('#trade .status')?.textContent || '')), 'a trade on the wrong network is refused in plain words');
    ok((await sent(pg)).length === 0, 'and nothing reaches the wallet');
    await pg.evaluate(() => { window.__fake.chain = 3045; window.__emit('chainChanged', '0xbe5'); });
    ok(await until(pg, () => !/moved off VYRE/.test(document.body.innerText)), 'coming back clears the notice');
    ok(await buy(pg) && (await sent(pg)).length === 1, 'and a trade works again');
    await pg.evaluate(() => { window.__fake.account = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; window.__emit('accountsChanged', ['0x90F79bf6EB2c4f870365E785982E1f101E93b906']); });
    ok(await until(pg, () => document.querySelector('#who').textContent === 'none'), 'a changed account disconnects');
    ok(/account in your wallet changed/.test(await pg.locator('body').innerText()), 'and says why');
    ok(await pg.evaluate(() => window.__disconnects) === 1, 'and ends the connection');
    await ctx.close();
  }

  // ---- rejecting: at pairing, and at a transaction
  {
    const { pg, ctx } = await open();
    await chooseWc(pg); await pg.waitForSelector('.wc-qr');
    await pg.evaluate(() => window.__pair.reject(Object.assign(new Error('User rejected.'), { code: 5000 })));
    await pg.waitForSelector('.modal-card [role=alert]');
    ok(/Cancelled in your wallet/.test(await pg.locator('.modal-card [role=alert]').innerText()), 'rejecting the connection says so');
    ok(await who(pg) === 'none', 'and nothing is connected');
    await pg.getByRole('button', { name: 'Try again' }).click();
    await pg.waitForSelector('.wc-qr');
    ok(await pg.evaluate(() => window.__starts) === 2, 'Try again starts a new pairing');
    await pg.evaluate(() => window.__pair.resolve());
    await until(pg, () => document.querySelector('#who').textContent !== 'none');
    await pg.evaluate(() => { window.__fake.reject = true; });
    await pg.getByRole('button', { name: 'Buy', exact: true }).click();
    ok(await until(pg, () => /Cancelled in your wallet/.test(document.querySelector('#trade .status')?.textContent || '')), 'rejecting a transaction says so');
    ok(await who(pg) !== 'none', 'and stays connected');
    await ctx.close();
  }

  // ---- the wallet ends the connection; a request finds it gone
  {
    const { pg, ctx } = await open();
    await chooseWc(pg); await pg.waitForSelector('.wc-qr'); await pg.evaluate(() => window.__pair.resolve());
    await until(pg, () => document.querySelector('#who').textContent !== 'none');
    await pg.evaluate(() => window.__emit('session_delete', { topic: 'x' }));
    ok(await until(pg, () => document.querySelector('#who').textContent === 'none'), 'the wallet ending it disconnects');
    ok(/ended the connection/.test(await pg.locator('body').innerText()), 'and says so');
    await chooseWc(pg); await pg.waitForSelector('.wc-qr'); await pg.evaluate(() => window.__pair.resolve());
    await until(pg, () => document.querySelector('#who').textContent !== 'none');
    await pg.evaluate(() => { window.__fake.lost = true; });
    await pg.getByRole('button', { name: 'Buy', exact: true }).click();
    ok(await until(pg, () => document.querySelector('#who').textContent === 'none'), 'a request that finds the session gone disconnects');
    ok(/ended the connection/.test(await pg.locator('body').innerText()), 'and says so');
    await ctx.close();
  }

  // ---- an expired session
  {
    const { pg, ctx } = await open();
    await pg.evaluate(() => { window.__fake.expiry = Math.floor(Date.now() / 1000) + 2; });
    await chooseWc(pg); await pg.waitForSelector('.wc-qr'); await pg.evaluate(() => window.__pair.resolve());
    await until(pg, () => document.querySelector('#who').textContent !== 'none');
    ok(await until(pg, () => document.querySelector('#who').textContent === 'none', null, 8000), 'a session reaching its end disconnects');
    ok(/expired/.test(await pg.locator('body').innerText()), 'and says it expired');
    await ctx.close();
  }

  // ---- a double tap; cancelling before approval; a late approval is ended
  {
    const { pg, ctx } = await open();
    await pg.getByRole('button', { name: 'Sign in' }).first().click();
    const item = pg.getByRole('menuitem', { name: /^WalletConnect/ });
    await item.dblclick();
    await pg.waitForSelector('.wc-qr');
    ok(await pg.evaluate(() => window.__starts) === 1, 'a double tap starts one pairing');
    await pg.getByRole('button', { name: 'Cancel' }).click();
    ok(await pg.locator('.modal-card').count() === 0, 'Cancel closes the sheet');
    await pg.evaluate(() => { try { window.__pair.resolve(); } catch { /* aborted */ } });
    await pg.waitForTimeout(400);
    ok(await who(pg) === 'none', 'an approval after cancelling does not connect');
    await ctx.close();
  }

  // ---- the relay is down: a plain message and the Trust Wallet link
  {
    const { pg, ctx } = await open();
    await chooseWc(pg); await pg.waitForSelector('.wc-qr');
    await pg.evaluate(() => window.__pair.reject(new Error('WebSocket connection failed for URL: wss://relay.walletconnect.org')));
    await pg.waitForSelector('.modal-card [role=alert]');
    ok(/Couldn’t reach the WalletConnect service/.test(await pg.locator('.modal-card [role=alert]').innerText()), 'the relay being down is said plainly');
    ok(await pg.locator('.modal-card a:has-text("Open in Trust Wallet")').getAttribute('href') === 'https://link.trustwallet.com/open_url?coin_id=60&url=https://minta.vyrechain.com', 'with the Trust Wallet browser link');
    await ctx.close();
  }

  // ---- a saved connection: restored only if valid
  {
    const { pg, ctx } = await open(() => { try { localStorage.setItem('minta.wc:3045', '1'); window.__wantRestore = true; } catch { /* none */ } });
    // (the stand-in's restore answers window.__restoreable, which is false at load: the saved note is stale)
    ok(await until(pg, () => /earlier wallet connection has ended/.test(document.body.innerText)), 'a saved connection that is gone is said to have ended');
    ok(await who(pg) === 'none', 'and nothing is connected');
    ok(await pg.evaluate(() => localStorage.getItem('minta.wc:3045')) === null, 'and the note is cleared');
    await ctx.close();
  }
  {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('minta.wc:3045', '1'); } catch { /* none */ } });
    const pg = await ctx.newPage();
    // make the stand-in's session valid before the app asks: the harness reads window.__restoreable when the provider mounts
    await pg.addInitScript(() => { Object.defineProperty(window, '__restoreable', { get: () => true, set: () => {}, configurable: true }); });
    await pg.goto(base);
    ok(await until(pg, () => document.querySelector('#who')?.textContent !== 'none' && !!document.querySelector('#who')), 'a valid saved connection is restored on load');
    ok((await who(pg)).toLowerCase() === ME.toLowerCase(), 'with the wallet’s account');
    ok(await pg.evaluate(() => window.__starts) === 0, 'without asking the wallet again');
    await ctx.close();
  }

  await b.close();
  srv.close();
  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
  console.log('all WalletConnect browser checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
