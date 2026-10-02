// Checks on the repository's own files, as `git ls-files` lists them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const TEXT = /\.(?:[cm]?js|tsx?|json|html|css|md|ya?ml|py|sh|txt|svg)$/;
const text = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The well-known development accounts every local test chain starts with (Hardhat's and Anvil's first five).
const DEV_ACCOUNTS = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
]);
/** A stand-in address: one digit repeated (0x1111…), zeros then a small number (0x00…01), or a development account */
const standIn = (a) => /^0x(?:([0-9a-f])\1{39}|0{30,}[0-9a-f]{1,10})$/i.test(a) || DEV_ACCOUNTS.has(a.toLowerCase());

test('the tests use stand-in addresses only (contracts come from the SDK, never written out)', () => {
  const found = [];
  for (const f of files.filter((f) => f.startsWith('test/') && TEXT.test(f))) {
    for (const [a] of text(f).matchAll(/(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) if (!standIn(a)) found.push(`${f}: ${a}`);
  }
  assert.deepEqual(found, []);
});

test('no file points at paths this repository does not have (app/web/…, brand/minta/…)', () => {
  const found = [];
  for (const f of files.filter((f) => TEXT.test(f) && f !== 'test/repo.test.mjs')) {
    text(f).split('\n').forEach((l, i) => { if (/\b(?:app\/web|brand\/minta)\//.test(l)) found.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(found, []);
});

test('the README’s brand/ line names only the tools that are there', () => {
  const line = text('README.md').split('\n').find((l) => l.startsWith('brand/'));
  assert.ok(line, 'the README describes brand/');
  const tools = new Set(files.filter((f) => /^brand\/[^/]+\//.test(f)).map((f) => f.split('/')[1]));
  for (const [word, dir] of [['logo', 'logo'], ['splash', 'splash'], ['mascots', 'memes'], ['art', 'art']]) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(line), tools.has(dir), `"${word}" in the README’s brand/ line, brand/${dir}/ ${tools.has(dir) ? 'there' : 'not there'}`);
  }
});
