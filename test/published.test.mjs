// The SDK package MINTA's in-app docs tell builders to install (`SDK_FILE` in src/pages/Docs.tsx) is the release vendored here,
// and `npm run check:published` (scripts/check-published.mjs) holds a publish while that address doesn't serve it byte for byte:
// the vendored copy can be a release vyrechain.com doesn't serve yet, and a build published then would show an install line that
// fails. These tests run the check against stand-in answers (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPublished, docsSdkFile } from '../scripts/check-published.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const vendored = /^file:vendor\/(vyrechain-sdk-\d+\.\d+\.\d+\.tgz)$/.exec(JSON.parse(read('package.json')).dependencies['@vyrechain/sdk'])[1];
const docs = docsSdkFile(read('src/pages/Docs.tsx').toString());

test('the docs’ install line names the SDK release vendored here, on vyrechain.com', () => {
  assert.equal(docs.file, vendored);
  assert.equal(docs.url, `https://vyrechain.com/sdk/${vendored}`);
});

test('a publish is held while the install line’s address doesn’t answer with the vendored file', async () => {
  const asked = [];
  const answer = (status, body) => async (url) => { asked.push(url); return new Response(body, { status }); };
  let p = await checkPublished({ fetch: answer(404, 'not found') });
  assert.equal(p.length, 1);
  assert.match(p[0], /answers 404/);
  assert.equal(asked[0], docs.url, 'the address asked is the docs’ own');
  p = await checkPublished({ fetch: answer(200, Buffer.from('another file')) });
  assert.equal(p.length, 1);
  assert.match(p[0], /different file/);
  p = await checkPublished({ fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(p.length, 1);
  assert.match(p[0], /couldn’t be reached/);
  assert.deepEqual(await checkPublished({ fetch: answer(200, read(`vendor/${vendored}`)) }), [], 'the vendored file itself: ready');
});

test('an install line that names a file not vendored here holds a publish too, without asking the network', async () => {
  const other = (p) => (p === 'src/pages/Docs.tsx' ? Buffer.from("const SDK_FILE = 'https://vyrechain.com/sdk/vyrechain-sdk-0.0.1.tgz';\n") : read(p));
  const p = await checkPublished({ read: other, fetch: async () => assert.fail('nothing to ask') });
  assert.equal(p.length, 1);
  assert.match(p[0], /isn’t the SDK vendored here/);
  assert.throws(() => docsSdkFile("const SDK_FILE = 'http://vyrechain.com/sdk/vyrechain-sdk-0.5.6.tgz';"), /SDK_FILE/, 'only an https address counts');
});

test('the check is a script of its own, named in the handover notes’ publishing steps', () => {
  assert.equal(JSON.parse(read('package.json')).scripts['check:published'], 'node scripts/check-published.mjs');
  assert.match(read('docs/HANDOFF.md').toString(), /npm run check:published/);
});
