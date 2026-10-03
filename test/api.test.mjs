// Saving a launch file (src/lib/api.ts): the service that keeps launch files stores only pictures it keeps itself (an address
// under its /i/, as its picture upload answers) and refuses a link to a picture anywhere else. An older launch's file can hold
// such a link, which MINTA never drew; when its creator edits the file, the link is left out of what is saved, so the save
// works instead of being refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as sdk from '@vyrechain/sdk';
import * as picture from '../src/lib/picture.ts';

const API = 'https://api.vyrechain.com';
const HASH = 'cd'.repeat(32);

/** src/lib/api.ts, run with `fetchStub` as fetch, `env` as the build's settings (import.meta.env) and `sdkStub` as the SDK */
function api(fetchStub, { env = {}, sdkStub = sdk } = {}) {
  const src = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace(/import\.meta\.env\.(\w+)/g, (_, k) => JSON.stringify(env[k]) ?? 'undefined');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', js)((id) => {
    if (id === './picture') return picture;
    if (id === '@vyrechain/sdk') return sdkStub;
    throw new Error(`unexpected import ${id}`);
  }, module, module.exports, fetchStub);
  return module.exports;
}

// The app API's address follows the SDK's record of the test network (the SDK's check before signing is that API's /txcheck), so
// a new SDK release that moves the test network's services to other host names moves MINTA's pictures, launch files, card checkout,
// email sign-in and check before signing with it; a build setting still wins.
test('the app API’s address is the SDK’s test-network API unless the build sets one', () => {
  const none = async () => { throw new Error('no network'); };
  assert.equal(api(none).API_URL, API, 'with the SDK vendored today');
  assert.equal(sdk.TXCHECK_URL, `${API}/txcheck`, 'which names the API by its check');
  const moved = { ...sdk, TXCHECK_URL: 'https://testnet-api.example.org/txcheck' };
  assert.equal(api(none, { sdkStub: moved }).API_URL, 'https://testnet-api.example.org', 'a release that moves the API is followed');
  assert.equal(api(none, { sdkStub: { ...sdk, TXCHECK_URL: 'https://x.example.org/v2/txcheck' } }).API_URL, 'https://x.example.org/v2', 'an API under a path keeps its path');
  assert.equal(api(none, { sdkStub: moved, env: { VITE_API_URL: 'https://mine.example.com/' } }).API_URL, 'https://mine.example.com', 'the build setting wins');
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
