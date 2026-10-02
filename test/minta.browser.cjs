// A browser check of MINTA's Create wizard and docs, on a fresh build, with every outside request cut off (the pages must
// work from their own files): the wizard asks for each step's details before moving on, shows the problem in words, keeps
// what was typed, ticks the checklist, and ends on a review with a wallet button; the docs open every article, search,
// deep-link to a section and carry no wording we don't use; nothing throws and nothing scrolls sideways on a phone.
//   node test/minta.browser.cjs   (npm run test:browser)
// (needs Playwright with a Chromium: `npx playwright install chromium`; PLAYWRIGHT=<its directory> and CHROME=<a Chromium binary> override)
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT || 'playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); } })();
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const WEB = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'minta-'));
execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir'], { cwd: WEB, stdio: 'ignore' });
const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', json: 'application/json', webmanifest: 'application/json', mp4: 'video/mp4', webp: 'image/webp' };
const serveDir = (dir) => http.createServer((q, r) => {
  let f = path.join(dir, q.url.split('?')[0]);
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[f.split('.').pop()] || 'text/plain' }); r.end(d); });
});
const srv = serveDir(OUT);

let failed = 0;
const ok = (cond, what) => { if (!cond) { failed++; console.error('FAIL', what); } else console.log('ok  ', what); };

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  // the splash (components/Splash.tsx) covers the home page the first time; every other check starts as a visitor who saw it already
  const open = async (hash, viewport, { splash = false, ...context } = {}) => {
    const ctx = await b.newContext({ viewport, ...context });
    if (!splash) await ctx.addInitScript(() => { try { window.localStorage.setItem('minta.splash', String(Date.now())); } catch { /* none */ } });
    // nothing leaves the machine: the chain, the API and the fonts are all refused
    await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR|CORS/.test(m.text()) && errs.push(m.text()));
    await pg.goto(base + hash);
    await pg.waitForSelector('.top');
    return { pg, ctx, errs };
  };
  const sideways = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // ---- the Create wizard
  {
    const { pg, ctx, errs } = await open('#/launch', { width: 1440, height: 900 });
    const stepTitle = () => pg.locator('.wz-step legend').first().innerText().then((t) => t.split('\n')[0].trim());
    const next = () => pg.click('.wz-next');
    ok(await stepTitle() === 'Token info', 'opens on step 1, Token info');
    await next();
    ok(await stepTitle() === 'Token info', 'Next with no name stays on step 1');
    ok(/Give it a name/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'and says what is missing');
    await pg.fill('.wz-step input[placeholder="My Token"]', 'My Token');
    await next();
    ok(/Give it a ticker/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a name without a ticker is asked for the ticker');
    await pg.fill('.wz-step input[placeholder="MYT"]', 'myt');
    ok(await pg.inputValue('.wz-step input[placeholder="MYT"]') === 'MYT', 'the ticker is upper-cased');
    ok(/My Token/.test(await pg.locator('.preview').innerText()) && /\bMYT\b/.test(await pg.locator('.preview .pv-sym').innerText()), 'the preview shows the name and ticker');
    await pg.click('text=Have an image link instead?');
    await pg.fill('.wz-step input[placeholder^="https://… or ipfs"]', 'ftp://nope');
    await next();
    ok(/picture must be an https/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a bad picture link is refused in words');
    await pg.fill('.wz-step input[placeholder^="https://… or ipfs"]', '');
    await pg.fill('.wz-step input[placeholder="https://…"]', 'ftp://x');
    await next();
    ok(/Website link must start with https/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a bad website link is refused in words (the links are on step 1, as in the design)');
    await pg.fill('.wz-step input[placeholder="https://…"]', 'https://example.com');
    await next();
    ok(await stepTitle() === 'Launch settings', 'a good first step moves to Launch settings');
    ok(/\$3K|\$3,000/.test(await pg.locator('.setting-cards').innerText()) && /Instant/.test(await pg.locator('.setting-cards').innerText()), 'the settings step shows the fixed $3,000 market cap and the instant launch');
    await pg.fill('.wz-step input[placeholder="0"]', 'abc');
    await next();
    ok(/Dev buy/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a bad dev buy is refused');
    await pg.fill('.wz-step input[placeholder="0"]', '');
    await next();
    ok(await stepTitle() === 'Tokenomics', 'then Tokenomics');
    await pg.fill('.wz-step input[inputmode=decimal] >> nth=0', '10');
    await next();
    ok(/1,000 to 1,000,000,000,000,000/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a supply below 1,000 is refused in words');
    await pg.fill('.wz-step input[inputmode=decimal] >> nth=0', '2000000');
    await pg.click('button:has-text("Custom")');
    await pg.fill('.wz-step input[placeholder="0 to 10"] >> nth=0', '11');
    await next();
    ok(/0 to 10%/.test(await pg.locator('.wz-step [role=alert]').innerText()), 'a tax over 10% is refused in words');
    // a tax is a plain percent with at most two decimals: what Number() would also read (hex, exponents) or round is refused,
    // and the preview never shows the typed text as the tax
    for (const odd of ['0x5', '1e1', '2.555']) {
      await pg.fill('.wz-step input[placeholder="0 to 10"] >> nth=0', odd);
      await next();
      const stayed = await stepTitle() === 'Tokenomics';
      ok(stayed && /two decimals/.test(await pg.locator('.wz-step [role=alert]').innerText()), `a tax typed as ${odd} is refused in words`);
      ok(!(await pg.locator('.preview .facts').innerText()).includes(odd), `and the preview doesn’t show ${odd}% as the tax`);
      if (!stayed) await pg.click('.wz-steps li:nth-child(3) button');
    }
    await pg.fill('.wz-step input[inputmode=decimal] >> nth=0', '2000000.9');
    await pg.fill('.wz-step input[placeholder="0 to 10"] >> nth=0', '2');
    ok(/2% \/ 1%/.test(await pg.locator('.preview .facts').innerText()), 'the preview shows the taxes as they will be sent');
    await next();
    ok(await stepTitle() === 'Media & links', 'then Media & links');
    ok(/Links\s*1 of 4/.test(await pg.locator('.brand-summary').innerText()) && /Logo\s*Not added/.test(await pg.locator('.brand-summary').innerText()), 'which sums up the logo and links from step 1');
    await next();
    ok(await stepTitle() === 'Review & launch', 'then Review & launch');
    const review = await pg.locator('.review-list').innerText();
    ok(/MYT/.test(review) && /My Token/.test(review) && /2,000,000/.test(review) && /2% \/ 1%/.test(review), 'the review lists what was typed (supply, taxes)');
    ok(/2,000,000\.9 tokens/.test(review), 'the supply is shown as it will be sent, its fraction too (' + (review.match(/[\d,.]+ tokens/) || [''])[0] + ')');
    ok(await pg.locator('.wz-step button:has-text("Sign in")').isVisible(), 'the last step offers the wallet button (no wallet is connected)');
    ok((await pg.locator('.checklist li.ok').count()) === 5 && !(await pg.locator('.checklist li.ok:has-text("Logo")').count()), 'the checklist ticks all but the logo, which was left empty');
    await pg.click('.wz-steps li:nth-child(1) button');
    ok(await stepTitle() === 'Token info' && await pg.inputValue('.wz-step input[placeholder="My Token"]') === 'My Token', 'going back keeps what was typed');
    await pg.fill('.wz-step input[placeholder="My Token"]', '');
    await pg.click('.wz-steps li:nth-child(4) button');
    ok(await stepTitle() === 'Token info', 'a later step can’t be jumped to past a step with a problem');
    ok(errs.length === 0, 'no page errors on the wizard' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }
  {
    const { pg, ctx } = await open('#/launch', { width: 390, height: 844 });
    ok(await sideways(pg) <= 1, 'the wizard does not scroll sideways on a phone (390)');
    await ctx.close();
    const n = await open('#/launch', { width: 360, height: 740 });
    ok(await sideways(n.pg) <= 1, 'nor at 360');
    await n.ctx.close();
  }

  // ---- the docs
  {
    const { pg, ctx, errs } = await open('#/docs', { width: 1440, height: 900 });
    const slugs = ['introduction', 'create-a-launch', 'launch-model', 'lifecycle', 'tokenomics', 'fees', 'contracts', 'sdk', 'integrations', 'guides', 'faq', 'support'];
    const banned = /layer.?2|\bon Arc\b|settles on|trustless|fair launch|airdrop|\bAPY\b|staking|audited|independent(ly)? (chain|of)/i;
    let all = '';
    for (const s of slugs) {
      await pg.goto(base + '#/docs/' + s);
      await pg.waitForSelector('.docs-section');
      const text = await pg.locator('.docs-main').innerText();
      all += '\n' + text;
      ok((await pg.locator('.docs-section').count()) >= 1 && text.length > 120, `article ${s} renders`);
    }
    ok(!banned.test(all), 'no wording we don’t use in the docs' + (banned.test(all) ? ': ' + all.match(banned)[0] : ''));
    ok(!/@vyrechain\.com|mailto:/i.test(all) && !(await pg.locator('a[href^="mailto:"]').count()), 'the docs carry no email address or mailto link (MINTA is run by whoever hosts it, not by the chain team)');
    ok(/outside audit/i.test(all), 'the docs say there has been no outside audit');
    await pg.goto(base + '#/docs/fees');
    ok(/Platform fee/.test(await pg.locator('.docs-main').innerText()) && /1% of every buy and sell/.test(await pg.locator('.docs-main').innerText()), 'the fees article has the platform fee');
    await pg.goto(base + '#/docs/introduction?s=how-it-works');
    await pg.waitForSelector('#how-it-works');
    await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => document.getElementById('how-it-works').getBoundingClientRect().top < window.innerHeight * 0.6), 'a deep link scrolls to its section');
    ok(await pg.locator('.docs-group a.on').innerText().then((t) => /How it works/.test(t)), 'and lights its entry in the sidebar');
    await pg.fill('.docs-search input', 'promoter');
    ok(await pg.locator('.docs-hits li').count() >= 1, 'search finds the promoter text');
    await pg.fill('.docs-search input', 'zzzzqqq');
    ok(/Nothing found/.test(await pg.locator('.docs-hits').innerText()), 'and says when there is nothing');
    ok(errs.length === 0, 'no page errors in the docs' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
    const m = await open('#/docs', { width: 390, height: 844 });
    ok(await sideways(m.pg) <= 1, 'the docs do not scroll sideways on a phone (390)');
    ok(!(await m.pg.locator('.docs-nav-body').isVisible()), 'the docs menu starts closed on a phone');
    await m.pg.click('.docs-nav-toggle');
    ok(await m.pg.locator('.docs-nav-body').isVisible(), 'and opens');
    await m.ctx.close();
    const n = await open('#/docs/contracts', { width: 360, height: 740 });
    ok(await sideways(n.pg) <= 1, 'the contracts article does not scroll sideways at 360');
    await n.ctx.close();
  }

  // ---- the header at laptop and tablet widths (it once stepped over the edge between 861 and 1479 px and hid Connect Wallet)
  {
    for (const w of [721, 768, 861, 1000, 1100, 1280, 1366, 1440, 1672]) {
      const { pg, ctx } = await open('#/docs', { width: w, height: 800 });
      const m = await pg.evaluate(() => {
        const de = document.documentElement;
        // (the last action that is showing: the wallet button, or the menu button on a tablet)
        const shown = [...document.querySelectorAll('.top-actions > *')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
        const r = shown.length ? shown[shown.length - 1] : null;
        return { over: de.scrollWidth - de.clientWidth, right: r ? Math.round(r.right) : -1, left: r ? Math.round(r.left) : -1 };
      });
      ok(m.over <= 1 && m.right > 0 && m.right <= w + 1 && m.left >= 0, `the header fits at ${w} px with the wallet button on screen (overflow ${m.over}, button ${m.left}-${m.right})`);
      await ctx.close();
    }
  }

  // ---- the shell
  {
    const { pg, ctx } = await open('#/', { width: 1440, height: 900 });
    ok(/MINTA/.test(await pg.locator('.brand').getAttribute('aria-label')) && (await pg.locator('.brand .wordmark').getAttribute('alt')) === 'MINTA', 'the header says MINTA');
    ok(await pg.evaluate(() => [...document.querySelectorAll('.brand img')].length === 2 && [...document.querySelectorAll('.brand img')].every((i) => i.complete && i.naturalWidth > 100)), 'and shows MINTA’s logo pictures (the M and the wordmark both load)');
    ok(/VYRE Testnet/.test(await pg.locator('.chain-pill').innerText()), 'and shows the chain it runs on');
    ok(!/VYRE Pad/.test(await pg.locator('body').innerText()), 'nothing on the page still says VYRE Pad');
    ok(!/@vyrechain\.com/i.test(await pg.locator('footer').innerText()) && !(await pg.locator('a[href^="mailto:"]').count()), 'the footer and header carry no email address');
    ok((await pg.title()).startsWith('MINTA'), 'the tab is titled MINTA');
    await ctx.close();
  }

  // ---- the logo is chosen from the device, not pasted as a link: it's cropped to a square, shrunk, shown, and refused in words when unusable
  {
    const { pg, ctx, errs } = await open('#/launch', { width: 1440, height: 900 });
    const fixture = (n) => path.join(__dirname, 'fixtures', n);
    const input = pg.locator('.picture-field input[type=file]');
    const alertText = () => pg.locator('.picture-field [role=alert]').innerText();
    const shown = () => pg.locator('.picture-field .pic-up-box img');
    const dims = () => shown().evaluate((i) => [i.naturalWidth, i.naturalHeight]);
    const png = (w, h) => pg.evaluate(async ([w, h]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#26f0f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#061018'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
      return c.toDataURL('image/png').split(',')[1];
    }, [w, h]).then((b64) => Buffer.from(b64, 'base64'));
    ok(await pg.locator('.picture-field .pic-up-box').count() === 1 && await pg.locator('.picture-field input[placeholder^="https://… or ipfs"]').count() === 0, 'the logo is a picture to choose, with no link box unless asked for');
    ok(/Choose a picture/.test(await pg.locator('.picture-field').innerText()), 'and says what to do');
    await input.setInputFiles(fixture('ok.png'));
    await shown().waitFor();
    ok(/^data:image\/(webp|png)/.test(await shown().getAttribute('src')), 'a chosen picture is shown (as a data: image, which the page’s security policy allows)');
    ok((await dims()).join('x') === '64x64', 'a 64 px picture is not enlarged');
    ok(await pg.locator('.preview img[src^="data:image"]').count() === 1, 'and shows in the preview card beside the form');
    await input.setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await png(1600, 900) });
    await pg.waitForFunction(() => document.querySelector('.picture-field .pic-up-box img')?.naturalWidth === 512);
    ok((await dims()).join('x') === '512x512', 'a wide 1600 x 900 picture is cropped to a square and shrunk to 512');
    await input.setInputFiles({ name: 'tall.png', mimeType: 'image/png', buffer: await png(600, 1200) });
    await pg.waitForFunction(() => document.querySelector('.picture-field .pic-up-box img')?.naturalWidth === 512);
    ok((await dims()).join('x') === '512x512', 'a tall one too');
    await input.setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>1</script></svg>') });
    await pg.waitForSelector('.picture-field [role=alert]');
    ok(/SVG pictures aren’t supported/.test(await alertText()), 'an SVG is refused in words');
    await input.setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: fs.readFileSync(fixture('tiny-dim.png')) });
    await pg.waitForFunction(() => /too small/.test(document.querySelector('.picture-field [role=alert]')?.textContent || ''));
    ok(/too small/.test(await alertText()), 'one that is too small is refused in words');
    await input.setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') });
    await pg.waitForFunction(() => /couldn’t be opened/.test(document.querySelector('.picture-field [role=alert]')?.textContent || ''));
    ok(/couldn’t be opened/.test(await alertText()), 'a file that is not a picture is refused in words');
    ok((await dims()).join('x') === '512x512', 'and the last good picture stays');
    await pg.click('.picture-field >> text=Remove');
    ok(await shown().count() === 0 && await pg.locator('.preview img[src^="data:image"]').count() === 0, 'Remove clears it from the box and the preview');
    await pg.click('.picture-field >> text=Have an image link instead?');
    ok(await pg.locator('.picture-field input[placeholder^="https://… or ipfs"]').count() === 1, 'a link can still be given');
    ok(await sideways(pg) <= 0, 'no sideways scroll');
    await ctx.close();
    const m = await open('#/launch', { width: 390, height: 844 });
    ok((await m.pg.locator('.picture-field .pic-up-box').boundingBox()).width <= 90 && await sideways(m.pg) <= 0, 'on a phone the picture box fits');
    ok(!m.errs.length && !errs.length, 'no page errors: ' + [...errs, ...m.errs].join(' | '));
    await m.ctx.close();
  }

  // ---- the ticker across the top: it says what it is when there is nothing to show (this check has no chain), carries a Pause button only when it moves, and never overflows
  {
    const { pg, ctx } = await open('#/', { width: 1440, height: 900 });
    ok(/live/i.test(await pg.locator('.ticker').innerText()) && /testnet/i.test(await pg.locator('.ticker').innerText()), 'the ticker says it is live and on the testnet');
    ok(/Test USDC, no real money/.test(await pg.locator('.ticker').innerText()), 'with nothing to show it says what shows here, and that it is test money');
    ok(await pg.locator('.tk-pause').count() === 0, 'and has no Pause button while nothing moves');
    ok(await sideways(pg) <= 0, 'no sideways scroll at 1440');
    await ctx.close();
    const m = await open('#/', { width: 390, height: 844 });
    ok(await sideways(m.pg) <= 0, 'no sideways scroll on a phone');
    await m.ctx.close();
  }

  // ---- a search carried in a link (#/?q=): the token list says it back only when it reads as a plain search, inside <bdi>, with
  // hidden and direction-changing characters taken out; anything else is "your search", so a link can't add a sentence of its own.
  // The list needs a chain: a stand-in answers with no launches (every read is zero)
  {
    const { decodeFunctionData, encodeFunctionResult, multicall3Abi } = require('viem');
    const zero = '0x' + '0'.repeat(64);
    const answer = ({ id, method, params }) => {
      let result = null;
      if (method === 'eth_chainId') result = '0x1cbd';
      else if (method === 'eth_blockNumber') result = '0x100';
      else if (method === 'eth_getLogs') result = [];
      else if (method === 'eth_call') {
        try {
          const d = decodeFunctionData({ abi: multicall3Abi, data: params[0].data });
          result = d.functionName === 'aggregate3' ? encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: d.args[0].map(() => ({ success: true, returnData: zero })) }) : zero;
        } catch { result = zero; }
      }
      return { jsonrpc: '2.0', id, result };
    };
    const note = async (q) => {
      const { pg, ctx, errs } = await open('#/docs', { width: 1280, height: 800 });
      await ctx.route(/testnet-rpc\.vyrechain\.com/, async (route) => {
        const body = JSON.parse(route.request().postData() || 'null');
        await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
      });
      await pg.goto(base + '#/?q=' + q);
      const el = await pg.waitForSelector('.filter-note', { timeout: 15000 }).catch(() => null);
      const out = el ? { text: await el.innerText(), bdi: await pg.locator('.filter-note bdi').count() } : { text: '', bdi: 0 };
      await ctx.close();
      return { ...out, errs };
    };
    let n = await note('pepe');
    ok(n.text === 'Showing tokens matching “pepe”. Clear' && n.bdi === 1 && !n.errs.length, `a plain search is said back, isolated (${n.text})`);
    n = await note(encodeURIComponent('x”. Official airdrop: send USDC to 0x1234'));
    ok(n.text === 'Showing tokens matching your search. Clear' && n.bdi === 0, `a link’s own sentence is not shown (${n.text})`);
    n = await note(encodeURIComponent('‮epep​'));
    ok(n.text === 'Showing tokens matching “epep”. Clear', `hidden and direction-changing characters are taken out (${JSON.stringify(n.text)})`);
  }

  // ---- no Face ID wallets for now (they're on the roadmap): nothing in the Pad offers or mentions them, and with no wallet in the
  // browser the connect menu says what to do; with one, it lists it
  {
    const { pg, ctx } = await open('#/', { width: 1440, height: 900 });
    for (const h of ['#/', '#/launch', '#/wallet', '#/portfolio', '#/docs', '#/docs/faq', '#/docs/create-a-launch', '#/docs/introduction']) {
      await pg.goto(base + h); await pg.waitForSelector('.top'); await pg.waitForTimeout(250);
      ok(!/face id|passkey/i.test(await pg.locator('body').innerText()), `no Face ID or passkey wording on ${h}`);
    }
    await pg.goto(base + '#/launch'); await pg.waitForSelector('.top');
    await pg.click('button[aria-label="Connect Wallet"]');
    const menu = await pg.locator('.menu').innerText();
    ok(/No wallet found in this browser/.test(menu) && /MetaMask/.test(menu) && /How to add VYRE Testnet/.test(menu) && !/face id/i.test(menu), 'with no wallet, the connect menu says what to do (and offers no Face ID)');
    await ctx.close();
    const w = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await w.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
    const wp = await w.newPage();
    await wp.addInitScript(() => {
      window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 't', name: 'Test wallet', icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>', rdns: 'test' }, provider: { request: async () => null, on() {}, removeListener() {} } } })));
    });
    await wp.goto(base + '#/launch'); await wp.waitForSelector('.top');
    await wp.click('button[aria-label="Connect Wallet"]');
    await wp.waitForSelector('button.wallet-choice:has-text("Test wallet")', { timeout: 5000 }).catch(() => {});
    const m2 = await wp.locator('.menu').innerText();
    ok(/Connect a wallet/.test(m2) && /Test wallet/.test(m2) && !/No wallet found/.test(m2) && !/face id/i.test(m2), 'with a wallet in the browser, the menu lists it (and still no Face ID)');
    await w.close();
    // a wallet that injects window.ethereum a moment after the page started, announcing nothing: opening the menu finds it
    const l = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await l.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
    const lp = await l.newPage();
    await lp.goto(base + '#/launch'); await lp.waitForSelector('.top');
    await lp.evaluate(() => { window.ethereum = { request: async () => null, on() {}, removeListener() {} }; });
    await lp.click('button[aria-label="Connect Wallet"]');
    await lp.waitForSelector('button.wallet-choice:has-text("Browser wallet")', { timeout: 5000 }).catch(() => {});
    const m3 = await lp.locator('.menu').innerText();
    ok(/Browser wallet/.test(m3) && !/No wallet found/.test(m3), 'a wallet injected late (no announcement) is found when the menu opens');
    await l.close();
  }

  // ---- the splash: plays over the home page once in a while, can always be skipped, and stands down whenever it can't play well.
  // The film itself is H.264, which a plain Chromium can't decode, so a 1 s clip stands in for it; the real film's size and look are checked by hand
  {
    const clip = path.join(__dirname, 'fixtures', 'splash-test.webm');
    const film = (ctx) => ctx.route(/\/splash\/minta-splash(-2)?\.mp4$/, (route) => route.fulfill({ path: clip, contentType: 'video/webm' }));
    const gone = (pg, ms = 4000) => pg.waitForSelector('.splash', { state: 'detached', timeout: ms }).then(() => true, () => false);
    const phone = { width: 390, height: 844 };
    // the first load already played (and recorded) it with the real, undecodable film: forget that and load again
    const again = async (pg) => { await pg.evaluate(() => { localStorage.removeItem('minta.splash'); localStorage.removeItem('minta.splash.film'); }); await pg.reload(); };

    // first visit: it shows, the Pad underneath can't be reached, Skip is focused; Skip ends it, the Pad is usable and it doesn't come back on reload
    {
      const { pg, ctx, errs } = await open('#/', phone, { splash: true });
      await film(ctx); await again(pg); await pg.waitForSelector('.splash');
      ok(await pg.locator('.splash video').getAttribute('src') === '/splash/minta-splash.mp4' && /minta-splash-poster\.webp$/.test(await pg.locator('.splash video').getAttribute('poster')), 'the splash shows the film with its poster frame');
      ok(await pg.evaluate(() => document.getElementById('root').hasAttribute('inert') && document.documentElement.classList.contains('splash-on')), 'the Pad underneath is inert and the page does not scroll while it plays');
      ok(await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('splash-skip')), 'the Skip button has the focus');
      const box = await pg.locator('.splash video').boundingBox();
      ok(Math.abs(box.width - 390) <= 1 && Math.abs(box.height - 390) <= 1, 'on a phone the square film is as wide as the screen');
      ok(await sideways(pg) <= 0, 'no sideways scroll under the splash');
      await pg.click('.splash-skip');
      ok(await gone(pg), 'Skip ends it');
      ok(await pg.evaluate(() => !document.getElementById('root').hasAttribute('inert') && !document.documentElement.classList.contains('splash-on')), 'and the Pad is usable again');
      ok(await pg.evaluate(() => Number(localStorage.getItem('minta.splash')) > Date.now() - 60_000), 'it remembers that it played');
      await pg.reload(); await pg.waitForSelector('.top'); await pg.waitForTimeout(300);
      ok(await pg.locator('.splash').count() === 0, 'a reload does not play it again');
      await pg.goto(base + '?splash#/'); await pg.waitForSelector('.splash');
      ok(true, '?splash plays it again whenever asked');
      await pg.keyboard.press('Escape');
      ok(await gone(pg), 'Esc ends it');
      ok(errs.length === 0, 'no page errors from the splash' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }
    // two films take turns, one each time it plays, and each is sized to its own shape without being cropped
    {
      const { pg, ctx } = await open('#/', phone, { splash: true });
      await film(ctx); await again(pg); await pg.waitForSelector('.splash');
      ok(await pg.locator('.splash video').getAttribute('src') === '/splash/minta-splash.mp4', 'the first play shows the first film');
      let box = await pg.locator('.splash video').boundingBox();
      ok(Math.abs(box.width - 390) <= 1 && Math.abs(box.height - 390) <= 1, 'which is square on a phone');
      await pg.click('.splash-skip'); await pg.waitForSelector('.splash', { state: 'detached' });
      await pg.evaluate(() => localStorage.removeItem('minta.splash')); await pg.reload(); await pg.waitForSelector('.splash');
      ok(await pg.locator('.splash video').getAttribute('src') === '/splash/minta-splash-2.mp4', 'the next play shows the second film');
      ok(/minta-splash-2-poster\.webp$/.test(await pg.locator('.splash video').getAttribute('poster')), 'with its own poster');
      box = await pg.locator('.splash video').boundingBox();
      ok(Math.abs(box.width - 390) <= 1 && Math.abs(box.height - 390 / (1072 / 720)) <= 1.5, 'which fills the width of a phone in its own wider shape, uncropped');
      ok(await sideways(pg) <= 0, 'with no sideways scroll');
      await pg.click('.splash-skip'); await pg.waitForSelector('.splash', { state: 'detached' });
      await pg.evaluate(() => localStorage.removeItem('minta.splash')); await pg.reload(); await pg.waitForSelector('.splash');
      ok(await pg.locator('.splash video').getAttribute('src') === '/splash/minta-splash.mp4', 'and then the first again');
      await ctx.close();
      const w = await open('#/', { width: 1440, height: 900 }, { splash: true });
      await film(w.ctx); await again(w.pg); await w.pg.waitForSelector('.splash');
      await w.pg.click('.splash-skip'); await w.pg.waitForSelector('.splash', { state: 'detached' });
      await w.pg.evaluate(() => localStorage.removeItem('minta.splash')); await w.pg.reload(); await w.pg.waitForSelector('.splash');
      box = await w.pg.locator('.splash video').boundingBox();
      ok(Math.abs(box.height - 900) <= 1 && Math.abs(box.width - 900 * (1072 / 720)) <= 2, 'on a wide screen the second film is as tall as the screen, in its own shape');
      await w.ctx.close();
    }
    // a tap anywhere ends it; playing through to the end holds the last frame a moment, then leaves by itself
    {
      const { pg, ctx } = await open('#/', { width: 1440, height: 900 }, { splash: true });
      await film(ctx); await again(pg); await pg.waitForSelector('.splash');
      const box = await pg.locator('.splash video').boundingBox();
      ok(Math.abs(box.height - 900) <= 1 && Math.abs(box.width - 900) <= 1, 'on a wide screen the film is a square as tall as the screen');
      await pg.mouse.click(300, 300);
      ok(await gone(pg), 'a tap anywhere ends it');
      await ctx.close();
      const t = await open('#/', { width: 1440, height: 900 }, { splash: true });
      await film(t.ctx); await again(t.pg); await t.pg.waitForSelector('.splash');
      const t0 = Date.now();
      ok(await gone(t.pg, 7000), 'played to the end, it leaves by itself');
      const took = Date.now() - t0;
      ok(took > 900 && took < 5000, `after about the film's length plus the fade (${took} ms)`);
      await t.ctx.close();
    }
    // when not to play: another page, a search link, reduced motion, a seen-it-lately device, a film that can't be loaded, a storage that can't remember
    {
      for (const [hash, what] of [['#/docs', 'the docs'], ['#/launch', 'Create'], ['#/token/0x0000000000000000000000000000000000000001', 'a shared token link'], ['#/?q=cat', 'a search link']]) {
        const { pg, ctx } = await open(hash, phone, { splash: true });
        await pg.waitForTimeout(400);
        ok(await pg.locator('.splash').count() === 0, `no splash on ${what}`);
        await ctx.close();
      }
      const r = await open('#/', phone, { splash: true, reducedMotion: 'reduce' });
      await r.pg.waitForTimeout(400);
      ok(await r.pg.locator('.splash').count() === 0, 'no splash with reduced motion');
      await r.ctx.close();
      const s = await open('#/', phone);
      await s.pg.waitForTimeout(400);
      ok(await s.pg.locator('.splash').count() === 0, 'no splash for a visitor who saw it in the last six hours');
      await s.ctx.close();
      const old = await open('#/', phone, { splash: true });
      await film(old.ctx);
      await old.pg.evaluate(() => localStorage.setItem('minta.splash', String(Date.now() - 7 * 3600_000)));
      await old.pg.reload(); await old.pg.waitForSelector('.splash', { timeout: 5000 }).then(() => ok(true, 'it plays again after six hours'), () => ok(false, 'it plays again after six hours'));
      await old.ctx.close();
      const bad = await open('#/', phone, { splash: true });
      await bad.ctx.route(/\/splash\/minta-splash(-2)?\.mp4$/, (route) => route.abort());
      await again(bad.pg);
      await bad.pg.waitForSelector('.top');
      ok(await gone(bad.pg, 5000), 'a film that can’t be loaded ends the splash by itself');
      ok(await bad.pg.evaluate(() => !document.getElementById('root').hasAttribute('inert')), 'and leaves the Pad usable');
      await bad.ctx.close();
      const blocked = await b.newContext({ viewport: phone });
      await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
      await blocked.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
      const bp = await blocked.newPage(); const berrs = [];
      bp.on('pageerror', (e) => berrs.push(String(e)));
      await bp.goto(base + '#/'); await bp.waitForSelector('.top'); await bp.waitForTimeout(400);
      ok(await bp.locator('.splash').count() === 0 && berrs.length === 0, 'with storage blocked there is no splash (it could not remember it played) and no error');
      await blocked.close();
    }
  }

  // ---- the pre-sign check (lib/txcheck.ts): a small page (test/harness) uses the app's own wallet client, transaction button,
  // dialog and stylesheet with a stand-in wallet; the check service's answers are stood in too. It must be advisory: silent on
  // no flags and on every kind of no answer, within the 800 ms budget; a flag opens the dialog BEFORE the wallet is asked, with
  // two buttons; the dialog shows only MINTA's own words; another chain is never checked.
  {
    const HOUT = fs.mkdtempSync(path.join(os.tmpdir(), 'minta-txc-'));
    execFileSync('npx', ['vite', 'build', path.join(__dirname, 'harness'), '--config', path.join(WEB, 'vite.config.ts'), '--outDir', HOUT, '--emptyOutDir', '--base', './'], { cwd: WEB, stdio: 'ignore' });
    const hsrv = serveDir(HOUT);
    await new Promise((r) => hsrv.listen(0, '127.0.0.1', r));
    const hbase = 'http://127.0.0.1:' + hsrv.address().port + '/';
    const ME = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', TO = '0x1111111111111111111111111111111111111111';
    const base0 = { advisory: true, chainId: 7357, simulated: true, reverts: false, revertReason: null, nativeChange: '0', transfers: [], approvals: [], addressChecks: { source: 'goplus', available: true, checked: [] }, flags: [] };
    const reply = (status, body) => async (route, cors) => { await route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }).catch(() => {}); };
    const wallet = () => {
      window.__asked = [];
      window.__chainHex = '0x1cbd';
      window.__wallet = {
        request: async ({ method, params }) => { window.__asked.push({ method, params }); if (method === 'eth_chainId') return window.__chainHex; if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32); return null; },
        on() {}, removeListener() {},
      };
      window.__sawDialog = 0;
      new MutationObserver(() => { if (document.querySelector('[role=alertdialog]')) window.__sawDialog++; }).observe(document, { childList: true, subtree: true });
    };
    const harness = async (answer, viewport = { width: 1280, height: 800 }) => {
      const ctx = await b.newContext({ viewport });
      await ctx.route((u) => !u.href.startsWith('http://127.0.0.1'), (route) => route.abort());
      const hits = [];
      // (registered after the catch-all above, so it takes precedence for the check's address)
      await ctx.route('https://api.vyrechain.com/txcheck', async (route) => {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        hits.push(JSON.parse(route.request().postData() || 'null'));
        await answer(route, cors);
      });
      await ctx.addInitScript(wallet);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(hbase + 'index.html');
      await pg.waitForSelector('#vyre button');
      const asked = () => pg.evaluate(() => window.__asked.filter((x) => x.method === 'eth_sendTransaction'));
      return { pg, ctx, hits, errs, asked };
    };

    // no flags: silent. The wallet is asked, no dialog ever showed, and the service was sent the transaction's own parts and nothing else
    {
      const { pg, ctx, hits, errs, asked } = await harness(reply(200, base0));
      await pg.click('#vyre button');
      await pg.waitForSelector('#vyre .status.ok');
      ok((await asked()).length === 1 && await pg.evaluate(() => window.__sawDialog) === 0, 'no flags: the wallet is asked and no dialog ever showed');
      ok(hits.length === 1 && JSON.stringify(Object.entries(hits[0]).sort()) === JSON.stringify(Object.entries({ from: ME, to: TO, data: '0xdeadbeef', value: '10000', chainId: 7357 }).sort()), 'the check was sent the transaction’s from, to, data, value and chain, and nothing else');
      ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }

    // a flag: the dialog opens before the wallet is asked, shows only MINTA's own words, and Continue anyway sends
    const evil = '<img src=x onerror="window.__pwned=1">';
    const hostile = { ...base0, flags: [
      { code: 'flagged_address', address: TO, roles: ['to'], categories: ['phishing_activities'], message: evil },
      { code: 'unlimited_approval', token: evil, spender: '"><img src=x onerror=window.__pwned=1>', message: '<script>window.__pwned=1</script>' },
    ] };
    {
      const { pg, ctx, asked, errs } = await harness(reply(200, hostile), { width: 1280, height: 800 });
      await pg.click('#vyre button');
      const dlg = pg.locator('[role=alertdialog]');
      await dlg.waitFor();
      ok((await asked()).length === 0, 'a flag: the dialog is up and the wallet has not been asked yet');
      const text = await dlg.innerText();
      ok(/Before you continue/.test(text) && /A security service has flagged an address involved in this transaction/.test(text) && /information, not a verdict/.test(text) && /unlimited amount of a token/.test(text), 'the dialog says what was found, in plain words (' + text.replace(/\s+/g, ' ').slice(0, 90) + '…)');
      ok(text.includes(TO) && /the contract this transaction calls/i.test(text), 'a flagged address is shown with how it figures in the call');
      ok(!/safe/i.test(text), 'and never calls the transaction safe');
      ok(!/pwned|phishing|<|script/i.test(text) && await dlg.locator('img, script').count() === 0 && await pg.evaluate(() => window.__pwned) === undefined, 'nothing the service said (its sentences, its categories, markup) shows or runs');
      ok(await dlg.locator('button').allInnerTexts().then((t) => t.join('|') === 'Continue anyway|Cancel'), 'with two buttons: Continue anyway and Cancel');
      ok(await pg.evaluate(() => document.activeElement && document.activeElement.textContent === 'Cancel'), 'Cancel has the focus');
      await pg.click('button:has-text("Continue anyway")');
      await pg.waitForSelector('#vyre .status.ok');
      ok((await asked()).length === 1 && await pg.locator('[role=alertdialog]').count() === 0, 'Continue anyway closes it and sends, once');
      ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }
    // Cancel, Esc and a tap outside send nothing and say so
    for (const how of ['Cancel', 'Esc', 'outside']) {
      const { pg, ctx, asked } = await harness(reply(200, hostile));
      await pg.click('#vyre button');
      await pg.waitForSelector('[role=alertdialog]');
      if (how === 'Cancel') await pg.click('[role=alertdialog] button:has-text("Cancel")');
      else if (how === 'Esc') await pg.keyboard.press('Escape');
      else await pg.mouse.click(5, 5);
      await pg.waitForSelector('#vyre .status.err');
      ok((await asked()).length === 0 && /Cancelled\. Nothing was sent\./.test(await pg.locator('#vyre .status').innerText()) && await pg.locator('[role=alertdialog]').count() === 0, `${how}: nothing is sent, and the page says so`);
      await ctx.close();
    }
    // "would fail" alone opens it too
    {
      const { pg, ctx, asked } = await harness(reply(200, { ...base0, reverts: true, revertReason: 'x' }));
      await pg.click('#vyre button');
      await pg.waitForSelector('[role=alertdialog]');
      ok(/would most likely fail/.test(await pg.locator('[role=alertdialog]').innerText()) && (await asked()).length === 0, 'an answer that says it would fail opens it');
      await ctx.close();
    }
    // every kind of no answer is silent, and none costs more than the budget (800 ms) and the page's own work
    {
      const flagged = { ...base0, flags: [{ code: 'flagged_address', address: TO, roles: ['to'] }], reverts: true };
      const cases = {
        'a busy service (429)': reply(429, { error: 'busy: try again in a moment', busy: true, retryAfter: 1 }),
        'an error (500)': reply(500, { error: 'boom' }),
        'an error body that looks flagged (500)': reply(500, flagged),
        'a page that is not JSON': reply(200, '<html><script>window.__pwned=1</script></html>'),
        'truncated JSON': reply(200, '{"advisory":true,"simulated":true,"flags":[{"code":"rev'),
        'an answer with no simulation and nothing flagged but a failure': reply(200, { ...base0, simulated: false, reason: 'trace_unavailable', reverts: true, flags: [{ code: 'reverts' }] }),
        'a network error': async (route) => { await route.abort().catch(() => {}); },
        'a service that takes 3 s': async (route, cors) => { await new Promise((r) => setTimeout(r, 3000)); await reply(200, flagged)(route, cors); },
      };
      for (const [name, answer] of Object.entries(cases)) {
        const { pg, ctx, asked } = await harness(answer);
        const t0 = Date.now();
        await pg.click('#vyre button');
        await pg.waitForSelector('#vyre .status.ok', { timeout: 6000 });
        const ms = Date.now() - t0;
        ok((await asked()).length === 1 && await pg.evaluate(() => window.__sawDialog) === 0 && await pg.evaluate(() => window.__pwned) === undefined && !(await pg.locator('#vyre .status').innerText()).match(/check|fail|error/i), `${name}: silent, the wallet is asked (${ms} ms)`);
        ok(ms < 1800, `${name}: no more than the budget was added (${ms} ms)`);
        await ctx.close();
      }
    }
    // another chain is never checked
    {
      const { pg, ctx, hits, asked } = await harness(reply(200, hostile));
      await pg.click('#arc button');
      await pg.waitForSelector('#arc .status.ok');
      ok(hits.length === 0 && (await asked()).length === 1 && await pg.evaluate(() => window.__sawDialog) === 0, 'a send on another chain (Arc) goes straight to the wallet: the check isn’t asked');
      await ctx.close();
    }
    // a trade sent whose result couldn't be read (the RPC busy, say): the same button never sends it again. It becomes Check it,
    // which only reads the chain: no receipt yet keeps it so; a receipt that went through ends it (and clears the form, as a
    // trade that confirmed at once would); one that failed on chain lets it be sent again; and after a check that found
    // nothing it can be sent again, but only on purpose (start over)
    {
      const RPC = 'https://testnet-rpc.vyrechain.com';
      const HASH = '0x' + 'cd'.repeat(32);
      const receipt = (status) => ({ blockHash: '0x' + '11'.repeat(32), blockNumber: '0x10', contractAddress: null, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x989680', from: ME, gasUsed: '0x5208', logs: [], logsBloom: '0x' + '00'.repeat(256), status, to: TO, transactionHash: HASH, transactionIndex: '0x0', type: '0x2' });
      let answer = null;
      const { pg, ctx, errs } = await harness(reply(200, base0));
      const asks = [];
      await ctx.route((u) => u.href.startsWith(RPC), async (route) => {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const body = JSON.parse(route.request().postData() || 'null');
        const one = (q) => { asks.push(q.method); return { jsonrpc: '2.0', id: q.id, result: q.method === 'eth_getTransactionReceipt' ? answer : null }; };
        await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) }).catch(() => {});
      });
      const btn = pg.locator('#unread .tx > button');
      const status = () => pg.locator('#unread .status').innerText().catch(() => '');
      const runs = () => pg.evaluate(() => window.__runs || 0);
      const done = () => pg.evaluate(() => window.__done || 0);
      const settle = (re) => pg.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('#unread .status')?.textContent || ''), re.source, { timeout: 5000 }).catch(() => {});
      await btn.click();
      await settle(/couldn’t be read/);
      ok(await runs() === 1 && /Check it/.test(await btn.innerText()) && await btn.isEnabled(), 'sent but unread: the trade ran once, and its button now reads Check it');
      ok(/couldn’t be read/.test(await status()) && await pg.locator(`#unread a[href$="/tx/${HASH}"]`).count() === 1, 'the status says so and links the transaction that was sent');
      await btn.click();
      await settle(/isn’t confirmed yet/);
      ok(await runs() === 1 && asks.includes('eth_getTransactionReceipt'), 'pressing it again only reads the chain: nothing is sent twice');
      ok(/isn’t confirmed yet/i.test(await status()) && /Check it/.test(await btn.innerText()), 'no receipt yet: it says so, and stays Check it');
      answer = receipt('0x1');
      await btn.click();
      await settle(/went through/);
      ok(/went through/i.test(await status()) && await done() === 1 && await runs() === 1, 'a receipt that went through: it says so, and the form is cleared as after any trade');
      ok(/Buy with 50 USDC/.test(await btn.innerText()), 'and the button is a buy button again');
      // one that failed on chain: it can be sent again
      answer = null;
      await btn.click();
      await settle(/couldn’t be read/);
      answer = receipt('0x0');
      await btn.click();
      await settle(/failed/);
      ok(await runs() === 2 && /failed/i.test(await status()) && /Buy with 50 USDC/.test(await btn.innerText()) && await done() === 1, 'a receipt that failed on chain: it says so and the button can send again');
      // never found: sent again only on purpose
      answer = null;
      await btn.click();
      await settle(/couldn’t be read/);
      ok(await pg.locator('#unread button:has-text("start over")').count() === 0, 'before any check there is no way to start over');
      await btn.click();
      await settle(/isn’t confirmed yet/);
      await pg.locator('#unread button:has-text("start over")').click().catch(() => {});
      ok(await runs() === 3 && /Buy with 50 USDC/.test(await btn.innerText()), 'after a check found nothing, “start over” only re-arms the button (it sends nothing by itself)');
      ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }
    // the dialog on a phone
    {
      const { pg, ctx } = await harness(reply(200, hostile), { width: 360, height: 640 });
      await pg.click('#vyre button');
      await pg.waitForSelector('[role=alertdialog]');
      const card = await pg.locator('[role=alertdialog] .modal-card').boundingBox();
      const btns = await pg.locator('[role=alertdialog] button').evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1 || e.closest('.modal-card').scrollHeight > e.closest('.modal-card').clientHeight; }));
      ok(card.x >= 0 && card.x + card.width <= 360 && await sideways(pg) <= 0 && btns.every(Boolean), 'on a phone (360) the dialog fits and its buttons can be reached');
      await ctx.close();
    }
    // the privacy page and the FAQ say plainly what the check sends and to whom, and that it is advisory
    {
      const { pg, ctx } = await open('#/docs/faq', { width: 1280, height: 800 });
      const faq = await pg.locator('.faq').textContent();
      ok(/Does MINTA check a transaction before I sign it\?/.test(faq) && /api\.vyrechain\.com/.test(faq) && /third-party security service/.test(faq) && /goes on without saying anything/.test(faq) && /Continue anyway and Cancel/.test(faq), 'the FAQ explains the check, who it asks, and that MINTA goes on without it');
      ok(!/\bsafe\b/i.test(faq.slice(faq.indexOf('Does MINTA check'), faq.indexOf('Has it had an outside audit'))), 'and never calls a checked transaction safe');
      await pg.goto(base + 'privacy/');
      const privacy = await pg.locator('main').textContent();
      ok(/Send a transaction on VYRE/.test(privacy) && /api\.vyrechain\.com/.test(privacy) && /third-party security service/.test(privacy) && /advisory \(it never stops a transaction\)/.test(privacy) && /GoPlus/.test(privacy), 'the privacy page lists what the check sends, to which service, and that it is advisory');
      await ctx.close();
    }
    hsrv.close();
    fs.rmSync(HOUT, { recursive: true, force: true });
  }

  await b.close();
  srv.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
