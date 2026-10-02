// A search carried in a link (#/?q=...): the route keeps it free of hidden and direction-changing characters, and the token
// list shows it back only when it reads as a plain search, so a shared link can't put its own sentence on MINTA's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as format from '../src/lib/format.ts';

const { searchTerm } = format;
const require = createRequire(import.meta.url);

// the router as the app builds it, with the promoter lookup stood in (it calls a service)
function router() {
  const src = fs.readFileSync(new URL('../src/lib/router.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stubs = { './api': { isPromoterCode: () => false, promoterWallet: async () => null }, './format': format };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => stubs[id] || require(id), module, module.exports);
  return module.exports;
}

test('a plain search is shown back as typed', () => {
  for (const q of ['pepe', '$PEPE', 'Pepe Coin', 'my_token-2', '0x33D945764d3De5AB0211455c13fC48490f7082DE', 'ДОГЕ', 'ドージ']) assert.equal(searchTerm(q), q);
});

test('a search that could pass for MINTA’s own words is not shown back', () => {
  for (const q of [
    'x”. Official airdrop: send USDC to 0x1234',
    'x". Claim now at example.com',
    'https://example.com',
    '<b>bold</b>',
    'a'.repeat(43),
    'Zalgó́́',
    '',
    '   ',
  ]) assert.equal(searchTerm(q), null, JSON.stringify(q));
});

test('hidden and direction-changing characters are taken out before anything is shown', () => {
  assert.equal(searchTerm('‮epep'), 'epep');
  assert.equal(searchTerm('pe​pe⁦'), 'pepe');
  assert.equal(searchTerm('‮x”. Official airdrop'), null);
});

test('the route keeps the search clean, at most 64 characters, and drops an empty one', () => {
  const { parseRoute } = router();
  assert.deepEqual(parseRoute('#/?q=pepe'), { page: 'explore', q: 'pepe' });
  assert.deepEqual(parseRoute('#/?q=%E2%80%AEepep%E2%80%8B'), { page: 'explore', q: 'epep' });
  assert.deepEqual(parseRoute('#/?q=%E2%80%AE%E2%81%A6'), { page: 'explore' });
  assert.equal(parseRoute(`#/?q=${'a'.repeat(100)}`).q.length, 64);
  assert.equal(Array.from(parseRoute(`#/?q=${'😀'.repeat(70)}`).q).length, 64, 'cut by whole characters');
});

test('the token list shows the search through searchTerm only', () => {
  const explore = fs.readFileSync(new URL('../src/pages/Explore.tsx', import.meta.url), 'utf8');
  assert.match(explore, /searchTerm\(q\)/);
  assert.doesNotMatch(explore, /\{q\}/, 'the raw search is not drawn');
});
