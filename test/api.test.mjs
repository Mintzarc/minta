// Saving a launch file (src/lib/api.ts): the service that keeps launch files stores only pictures it keeps itself (an address
// under its /i/, as its picture upload answers) and refuses a link to a picture anywhere else. An older launch's file can hold
// such a link, which MINTA never drew; when its creator edits the file, the link is left out of what is saved, so the save
// works instead of being refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as picture from '../src/lib/picture.ts';

const API = 'https://api.vyrechain.com';
const HASH = 'cd'.repeat(32);

/** src/lib/api.ts, run with `fetchStub` as fetch, `env` as the build's settings (import.meta.env) and `network` as the selected network's settings */
function api(fetchStub, { env = {}, network = { api: API, promoters: 'https://testnet-rpc.vyrechain.com/promoters' } } = {}) {
  const src = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace(/import\.meta\.env\.(\w+)/g, (_, k) => JSON.stringify(env[k]) ?? 'undefined');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', js)((id) => {
    if (id === './picture') return picture;
    if (id === './network') return { NETWORK: network };
    throw new Error(`unexpected import ${id}`);
  }, module, module.exports, fetchStub);
  return module.exports;
}

// The app API's address is the selected network's (src/lib/network.ts); a build setting still wins.
test('the app API’s address is the selected network’s unless the build sets one', () => {
  const none = async () => { throw new Error('no network'); };
  assert.equal(api(none).API_URL, API);
  assert.equal(api(none, { network: { api: 'https://api.example.org', promoters: null } }).API_URL, 'https://api.example.org', 'the network’s own');
  assert.equal(api(none, { env: { VITE_API_URL: 'https://mine.example.com/' } }).API_URL, 'https://mine.example.com', 'the build setting wins');
});

test('a network with no promoter program never asks the promoter service', async () => {
  const a = api(async () => assert.fail('nothing to ask'), { network: { api: API, promoters: null } });
  assert.equal(await a.promoterWallet('somebody'), null);
  assert.equal(await a.promoterStatus('0x1111111111111111111111111111111111111111'), null);
});

test('a picture the service keeps stays; a link to any other picture is left out of the saved file', async () => {
  const sent = [];
  const a = api(async (_url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ uri: `${API}/m/x.json` }) }; });
  const kept = `${API}/i/${HASH}.webp`;
  assert.equal(a.storable({ image: kept }).image, kept);
  for (const outside of ['https://example.com/p.png', 'ipfs://bafy', `${API}/i/${HASH}.gif`, `${API}/i/../m/${HASH}.webp`, `https://api.vyrechain.com.evil/i/${HASH}.webp`, ' ']) {
    assert.equal(a.storable({ image: outside, description: 'd' }).image, '', outside);
  }
  await a.saveLaunchFile({ description: 'hello', image: 'https://tracker.example/p.gif', links: { website: 'https://a.example' } });
  assert.deepEqual(sent[0], { description: 'hello', image: '', links: { website: 'https://a.example' } });
  await a.saveLaunchFile({ image: kept });
  assert.equal(sent[1].image, kept);
});

test('a file whose only content was an outside picture link counts as empty', () => {
  const a = api(async () => { throw new Error('no network'); });
  assert.equal(a.hasContent({ image: 'https://example.com/p.png' }), false);
  assert.equal(a.hasContent({ image: `${API}/i/${HASH}.png` }), true);
  assert.equal(a.hasContent({ links: { x: 'https://x.com/a' } }), true);
});
