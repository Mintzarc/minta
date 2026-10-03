// The vendored SDK (vendor/): the package installed is the file recorded, byte for byte. vendor/SHA256SUMS records each file's
// SHA-256 (the same hash as the copy https://vyrechain.com/sdk/ serves, which `npm run check:published` confirms before a build is
// published), package.json points at a recorded file, and the
// lockfile's integrity and version match that file, so a file swapped or re-packed under the same name fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const tgzs = fs.readdirSync(new URL('vendor/', root)).filter((f) => f.endsWith('.tgz')).sort();
const sums = () => {
  const lines = read('vendor/SHA256SUMS').toString().split('\n').filter((l) => l.trim());
  return new Map(lines.map((l) => {
    const m = /^([0-9a-f]{64}) [ *]([\w.@-]+)$/.exec(l);
    assert.ok(m, `a line of vendor/SHA256SUMS: ${JSON.stringify(l)}`);
    return [m[2], m[1]];
  }));
};

/** package/package.json from inside a .tgz (a gzipped tar: 512-byte headers, each file's data padded to 512) */
function packageJsonOf(tgz) {
  const tar = zlib.gunzipSync(tgz);
  for (let o = 0; o + 512 <= tar.length;) {
    const name = tar.subarray(o, o + 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(tar.subarray(o + 124, o + 136).toString().replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === 'package/package.json') return JSON.parse(tar.subarray(o + 512, o + 512 + size).toString());
    o += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('no package/package.json in the file');
}

test('every vendored file is recorded in vendor/SHA256SUMS with its hash, and nothing else is', () => {
  const s = sums();
  assert.deepEqual([...s.keys()].sort(), tgzs);
  for (const f of tgzs) assert.equal(crypto.createHash('sha256').update(read(`vendor/${f}`)).digest('hex'), s.get(f), f);
});

test('the SDK installed is a recorded file, and the lockfile’s version and integrity are that file’s', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const spec = pkg.dependencies['@vyrechain/sdk'];
  const m = /^file:vendor\/(vyrechain-sdk-(\d+\.\d+\.\d+)\.tgz)$/.exec(spec);
  assert.ok(m, `package.json points at a vendored file: ${spec}`);
  const [, file, version] = m;
  assert.ok(sums().has(file), `${file} is recorded`);
  const tgz = read(`vendor/${file}`);
  assert.equal(packageJsonOf(tgz).version, version, 'the file holds the version its name says');
  assert.equal(lock.packages[''].dependencies['@vyrechain/sdk'], spec);
  const locked = lock.packages['node_modules/@vyrechain/sdk'];
  assert.equal(locked.resolved, spec);
  assert.equal(locked.version, version);
  assert.equal(locked.integrity, `sha512-${crypto.createHash('sha512').update(tgz).digest('base64')}`);
});
