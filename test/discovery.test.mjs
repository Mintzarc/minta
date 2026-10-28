// What search engines and AI assistants are told about MINTA (public/llms.txt, llms-full.txt, robots.txt, sitemap.xml, agents/index.html and the
// head of index.html): the files exist, are the ones scripts/discovery.mjs writes from the app's own facts (so an address that changed in
// src/lib/padv2.ts or the SDK makes this fail until `npm run discovery` is run), carry only addresses the app or the SDK knows, state the
// fee rule the contracts have, and use none of the wording MINTA's pages avoid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toFunctionSelector, toEventSelector, parseAbi, isAddress, getAddress } from 'viem';
import { getAddresses, vyreMainnet, quoterV2Abi } from '@vyrechain/sdk';
import * as P from '../src/lib/padv2.ts';
import { render, loadFacts, SIGNATURES, SITE } from '../scripts/discovery.mjs';

const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const words = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const GENERATED = ['public/llms.txt', 'public/llms-full.txt', 'public/agents/index.html'];
const PUBLIC = [...GENERATED, 'public/robots.txt', 'public/sitemap.xml', 'index.html'];

test('llms.txt, llms-full.txt, robots.txt, sitemap.xml and the agents page exist and are not empty', () => {
  for (const f of [...PUBLIC, 'public/agents/copy.js']) {
    assert.ok(fs.existsSync(new URL(f, root)), `${f} is missing`);
    assert.ok(read(f).trim().length > 200, `${f} is empty`);
  }
});

test('the committed llms files and agents page are what scripts/discovery.mjs writes now (addresses and limits come from padv2.ts and the SDK)', async () => {
  const fresh = await render();
  for (const f of GENERATED) assert.equal(read(f), fresh[f], `${f} is out of date: run npm run discovery`);
});

test('every address the pages name is one the app or the SDK’s mainnet record has, and every launchpad address the app uses is named', async () => {
  const f = await loadFacts();
  const sdk = getAddresses(3045);
  const known = new Set([...Object.entries(P.PAD_V2).filter(([k]) => k !== 'startBlock').map(([, v]) => v), sdk.wusdc, vyreMainnet.contracts.multicall3.address].map((a) => a.toLowerCase()));
  const llmsFull = read('public/llms-full.txt');
  for (const file of GENERATED) {
    for (const a of read(file).match(/0x[0-9a-fA-F]{40}\b/g) ?? []) {
      assert.ok(isAddress(a, { strict: true }), `${file}: ${a} is not a checksummed address`);
      assert.ok(known.has(a.toLowerCase()), `${file}: ${a} is not in padv2.ts or the SDK`);
    }
  }
  for (const [k, v] of Object.entries(P.PAD_V2)) if (k !== 'startBlock') assert.ok(llmsFull.includes(v), `llms-full.txt does not name ${k} ${v}`);
  assert.ok(llmsFull.includes(sdk.wusdc) && llmsFull.includes(vyreMainnet.contracts.multicall3.address));
  // the SDK’s own pad, router and quoter are the first launchpad’s: never named as places to send a launch or a trade
  for (const k of ['pad', 'appRouter', 'feeSplitter', 'swapRouter', 'quoter', 'poolFactory', 'poolDeployer', 'tickLens', 'referrals']) {
    if (Object.values(P.PAD_V2).some((v) => String(v).toLowerCase() === String(sdk[k]).toLowerCase())) continue;
    for (const file of GENERATED) assert.ok(!read(file).toLowerCase().includes(sdk[k].toLowerCase()), `${file} names the first launchpad’s ${k}`);
  }
  assert.equal(f.chainId, 3045);
  assert.equal(f.rpc, 'https://rpc.vyrechain.com');
  assert.equal(f.explorer, 'https://explorer.vyrechain.com');
});

test('the contract calls in the pages are the app’s own ABI (same selectors)', () => {
  const sel = (items) => new Map(items.filter((x) => x.type === 'function').map((x) => [x.name, toFunctionSelector(x)]));
  const mine = (lines) => parseAbi(lines);
  const check = (lines, abi, what) => {
    const have = sel(abi);
    for (const x of mine(lines)) {
      if (x.type === 'function') assert.equal(toFunctionSelector(x), have.get(x.name), `${what}.${x.name} differs from the app’s ABI`);
      if (x.type === 'event') {
        const ev = abi.find((e) => e.type === 'event' && e.name === x.name);
        assert.ok(ev && toEventSelector(x) === toEventSelector(ev), `${what} event ${x.name} differs from the app’s ABI`);
      }
    }
  };
  check(SIGNATURES.pad, P.padV2Abi, 'pad');
  check(SIGNATURES.router, P.swapRouterAbi, 'router');
  check(SIGNATURES.quoter, quoterV2Abi, 'quoter');
  assert.deepEqual(SIGNATURES.pad.filter((s) => /createLaunch/.test(s)).length, 1);
});

test('the pages state the fee rule the app and contracts have', async () => {
  const f = await loadFacts();
  assert.equal(P.PLATFORM_SHARE_BPS, 1000);
  assert.deepEqual([f.minTaxBps, f.maxTaxBps], [100, 1000]);
  for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
    const t = read(file);
    assert.match(t, /creator['’]s tax is the only fee/i, `${file}: the tax is the only fee`);
    assert.match(t, /1% (to|and) 10%|1% to 10%/, `${file}: tax range`);
    assert.match(t, /lower[^.]*never raise/i, `${file}: lowerable, never raisable`);
    assert.match(t, /a tenth/, `${file}: the platform’s tenth`);
    assert.match(t, /about a day/, `${file}: withdrawal time`);
    assert.match(t, /3045/, `${file}: chain id`);
  }
  assert.match(words(read('public/agents/index.html')), /only fee a trader pays/);
  assert.match(words(read('public/agents/index.html')), /Never paste a private key or seed phrase/);
  assert.match(read('public/llms.txt'), /never ask a user for a private key or seed phrase/i);
  // no fee the contracts don't have
  for (const file of GENERATED) assert.doesNotMatch(read(file), /platform fee of|partner fee of|promoter (share|reward) of|referral (fee|reward)/i, file);
});

test('none of the pages uses wording MINTA avoids (layer 2, "on Arc", trustless, audited, instant withdrawals, cheapest, promises of price, profit, airdrops or tokens)', () => {
  const bad = [
    /layer[ -]?(2|two)|\bL2\b/i, /\bon Arc\b|settles on Arc|secured by Arc/i, /trustless/i, /audit(ed)?\b/i, /instant(ly)?\s+withdraw|withdraw\w*\s+instant/i,
    /cheap(est)?\b/i, /airdrop/i, /guarantee/i, /\bprofit/i, /passive income/i, /to the moon/i, /\b\d+x\b/i, /decentrali[sz]ed|independent/i,
    /price (will|going)|will (go up|rise|pump)/i, /\b(ChatGPT|OpenAI|Anthropic|Claude|Gemini|Copilot|GPT-?\d|LLM)\b/i, /\bJarvis\b|\bCursor\b|session/i,
  ];
  for (const file of PUBLIC) {
    const t = file.endsWith('.html') ? words(read(file)) : read(file);
    for (const re of bad) assert.doesNotMatch(t.replace(/https?:\/\/\S+/g, ''), re, `${file} matches ${re}`);
  }
});

test('robots.txt allows everyone and points at the sitemap and llms.txt; the sitemap lists real pages of this site', () => {
  const robots = read('public/robots.txt');
  assert.match(robots, /^User-agent: \*\s*$/m);
  assert.match(robots, /^Allow: \/\s*$/m);
  assert.doesNotMatch(robots, /^Disallow:\s*\S/m, 'nothing is disallowed');
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml\\s*$`, 'm'));
  assert.match(robots, /llms\.txt/);
  const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(urls.length >= 4);
  assert.equal(new Set(urls).size, urls.length);
  for (const u of urls) {
    assert.ok(u.startsWith(`${SITE}/`), u);
    assert.ok(!u.includes('#'), `${u}: a # route is not a page of its own`);
    const path = u.slice(SITE.length + 1);
    assert.ok(path === '' ? fs.existsSync(new URL('index.html', root)) : fs.existsSync(new URL(`public/${path}index.html`, root)), `${u} has no page`);
  }
  for (const p of ['', 'agents/', 'terms/', 'privacy/']) assert.ok(urls.includes(`${SITE}/${p}`), `the sitemap lacks /${p}`);
});

test('index.html has a title, description, canonical, Open Graph and Twitter tags and honest WebApplication data', () => {
  const html = read('index.html');
  const meta = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(html)?.[1];
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
  assert.ok(title && title.length <= 70 && /MINTA/.test(title), 'title');
  const description = meta('name', 'description');
  assert.ok(description && description.length >= 70 && description.length <= 200, 'description length');
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/">`));
  for (const k of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'og:site_name']) assert.ok(meta('property', k), k);
  for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.ok(meta('name', k), k);
  assert.equal(meta('property', 'og:url'), `${SITE}/`);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'WebApplication');
  assert.equal(ld.name, 'MINTA');
  assert.equal(ld.url, `${SITE}/`);
  // nothing that would claim what isn't true: no ratings, reviews, prices or an organization
  for (const k of ['aggregateRating', 'review', 'offers', 'price', 'author', 'publisher', 'creator']) assert.ok(!(k in ld), `${k} is not claimed`);
  assert.ok(fs.existsSync(new URL('public/og.png', root)), 'the share picture exists');
});

test('the pages link the terms, the privacy page and the support contacts the terms page names; the app links the agents page', () => {
  const terms = read('public/terms/index.html');
  const hrefs = (t) => new Set([...t.matchAll(/href="(https:\/\/(?:t\.me|x\.com)[^"]+)"/g)].map((m) => m[1]));
  const support = hrefs(terms);
  assert.ok(support.size >= 2);
  for (const file of ['public/llms.txt', 'public/llms-full.txt', 'public/agents/index.html']) {
    const t = read(file);
    for (const u of support) assert.ok(t.includes(u), `${file} lacks the support contact ${u}`);
    assert.ok(t.includes(`${SITE}/terms/`) || t.includes('href="/terms/"'), `${file} lacks the terms`);
    assert.ok(t.includes(`${SITE}/privacy/`) || t.includes('href="/privacy/"'), `${file} lacks the privacy page`);
  }
  assert.match(read('src/App.tsx'), /href="\/agents\/"/, 'the app’s footer links the agents page');
  assert.match(read('public/agents/index.html'), /<script src="\/agents\/copy\.js"><\/script>/, 'copy buttons use a script file (the page’s policy allows no inline script)');
  assert.doesNotMatch(read('public/agents/index.html'), /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
});

test('the SDK package the pages tell builders to install is the one the docs name', async () => {
  const f = await loadFacts();
  const docs = read('src/pages/Docs.tsx');
  const url = /^const SDK_FILE = '([^']+)'/m.exec(docs)[1];
  assert.equal(f.sdkInstall, `npm install ${url} viem`);
  assert.ok(read('public/llms-full.txt').includes(f.sdkInstall));
  assert.equal(getAddress(P.PAD_V2.platformWallet), P.PAD_V2.platformWallet);
});
