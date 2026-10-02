// A launch's picture-and-links file (src/lib/market.ts metaOf), read as the app reads it, with its own imports stood in and the
// file served by a stand-in fetch. What it must get right: a picture is drawn on MINTA's shared pages only when it is one the
// picture service keeps (an address under its /i/, named by the hash of a file that service checked at 1,024 px a side at most).
// Any other picture link (any https site, IPFS) is a file of any size, which every visitor's browser would decode at full size:
// one that declares 20,000 x 20,000 pixels takes gigabytes, so such links are never drawn (the mascot is shown instead). The
// link itself is kept apart, so the Manage page can carry it over when a creator edits their file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as picture from '../src/lib/picture.ts';

const API = 'https://api.vyrechain.com';
const HASH = 'ab'.repeat(32);

/** market.ts as the app builds it, its imports from the app stood in (`api` is the picture service's address it is built with) */
function market(api = API) {
  const src = fs.readFileSync(new URL('../src/lib/market.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stubs = {
    './chain': { vyre: {} },
    './api': { API_URL: api },
    './picture': picture,
    '@vyrechain/sdk': { getAddresses: () => ({}), getLaunches: async () => [], readLogsSplitting: async () => [], vyreTestnet: { id: 7357 }, vyreTokenAbi: [] },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => {
    if (id in stubs) return stubs[id];
    if (id === 'viem') return { getAddress: (a) => a, parseAbi: () => [], parseAbiItem: () => ({}) };
    throw new Error(`unexpected import ${id}`);
  }, module, module.exports);
  return module.exports;
}

/** Serves `files` (link -> JSON body, or a status number) to the code under test; returns what was asked for */
function serve(files) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const f = files[String(url)];
    if (f === undefined) return new Response('not here', { status: 404 });
    if (typeof f === 'number') return new Response('busy', { status: f });
    return new Response(JSON.stringify(f), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return asked;
}

let n = 0;
/** The Meta the app makes of a file whose "image" is `image` (each under a fresh link, so nothing is served from the cache) */
async function metaWith(image, m = market()) {
  const uri = `${API}/m/${(++n).toString(16).padStart(64, '0')}.json`;
  serve({ [uri]: { image, description: 'd', links: { website: 'https://example.com' } } });
  return m.metaOf(uri);
}

test('a picture the picture service keeps is drawn', async () => {
  for (const ext of ['webp', 'png', 'jpg']) {
    const u = `${API}/i/${HASH}.${ext}`;
    assert.equal((await metaWith(u)).image, u, ext);
  }
});

test('a picture link to any other site, or IPFS, is never drawn (it could decode to gigabytes in every visitor’s browser)', async () => {
  for (const u of [
    'https://attacker.example/bomb.png',
    'ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    'https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    `http://api.vyrechain.com/i/${HASH}.webp`,
    `https://api.vyrechain.com.attacker.example/i/${HASH}.webp`,
    `https://attacker.example/?${API}/i/${HASH}.webp`,
    `https://user@api.vyrechain.com/i/${HASH}.webp`,
    `${API}/i/${HASH}.webp?w=20000`,
    `${API}/i/${HASH}.webp#x`,
    `${API}/i/${HASH}.svg`,
    `${API}/i/${HASH}.gif`,
    `${API}/i/${HASH.toUpperCase()}.webp`,
    `${API}/i/${HASH.slice(2)}.webp`,
    `${API}/i/../m/${HASH}.webp`,
    `${API}/i/sub/${HASH}.webp`,
    `${API}/m/${HASH}.json`,
    ` ${API}/i/${HASH}.webp`,
    `${API}/i/${HASH}.webp\n`,
    `data:image/png;base64,AAAA`,
    42,
    null,
  ]) {
    const meta = await metaWith(u);
    assert.ok(meta, `the file is still read (${JSON.stringify(u)})`);
    assert.equal(meta.image, undefined, `not drawn: ${JSON.stringify(u)}`);
    assert.equal(meta.description, 'd');
    assert.equal(meta.links.length, 1);
  }
});

test('a build pointed at another picture service draws that service’s pictures, and no longer the default one’s', async () => {
  const other = market('https://pics.example.org/api');
  const mine = `https://pics.example.org/api/i/${HASH}.png`;
  assert.equal((await metaWith(mine, other)).image, mine);
  assert.equal((await metaWith(`${API}/i/${HASH}.png`, other)).image, undefined);
  assert.equal((await metaWith(`https://pics.example.org/i/${HASH}.png`, other)).image, undefined, 'the path counts too');
});

test('the picture link as written is kept apart (never drawn), so an edit of the file can carry it over', async () => {
  assert.equal((await metaWith('https://attacker.example/bomb.png')).imageLink, 'https://attacker.example/bomb.png');
  assert.equal((await metaWith(`${API}/i/${HASH}.webp`)).imageLink, `${API}/i/${HASH}.webp`);
  assert.equal((await metaWith('ftp://x/y.png')).imageLink, undefined, 'only an https or ipfs link');
});

test('the check on its own: only the exact address of a kept picture passes', () => {
  assert.equal(picture.shownPicture(`${API}/i/${HASH}.webp`, API), `${API}/i/${HASH}.webp`);
  assert.equal(picture.shownPicture(`${API}/i/${HASH}.webp`, `${API}/`), `${API}/i/${HASH}.webp`, 'a trailing slash on the service’s address');
  assert.equal(picture.shownPicture(`${API}/i/${HASH}.webp`, 'https://api.vyrechain.co'), undefined);
  assert.equal(picture.shownPicture(`https://apixvyrechain.com/i/${HASH}.webp`, API), undefined, 'a dot in the service’s address is only a dot');
  assert.equal(picture.shownPicture(undefined, API), undefined);
  assert.equal(picture.shownPicture(`${API}/i/${HASH}.webp`, ''), undefined, 'no service, no picture');
});
