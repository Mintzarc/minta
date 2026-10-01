// Which splash film plays next (src/lib/films.ts): the next one in turn, wrapping round; the first when nothing sensible is remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILMS, nextFilm } from '../src/lib/films.ts';

test('with one film it is always that one', () => {
  for (const last of [null, 0, 1, -1, NaN, 7]) assert.equal(nextFilm(1, last), 0);
  assert.equal(nextFilm(0, 0), 0);
});

test('with two films they alternate', () => {
  assert.equal(nextFilm(2, null), 0);
  assert.equal(nextFilm(2, 0), 1);
  assert.equal(nextFilm(2, 1), 0);
});

test('with three they go round in turn', () => {
  assert.deepEqual([0, 1, 2, 0].map((last) => nextFilm(3, last)), [1, 2, 0, 1]);
});

test('a remembered value that makes no sense starts again at the first', () => {
  for (const last of [NaN, -1, 2, 99, 0.5, Infinity]) assert.equal(nextFilm(2, last), 0);
});

test('every listed film has a video and a poster in public/splash', async () => {
  const { existsSync } = await import('node:fs');
  for (const f of FILMS) {
    for (const file of [f.src, f.poster]) assert.ok(existsSync(new URL(`../public${file}`, import.meta.url)), `${file} exists`);
  }
});
