// The SDK package MINTA's in-app docs tell builders to install (`SDK_FILE` in src/pages/Docs.tsx) is the release vendored here,
// and `npm run check:published` (scripts/check-published.mjs) holds a publish while that address doesn't serve it byte for byte:
// the vendored copy can be a release vyrechain.com doesn't serve yet, and a build published then would show an install line that
// fails. These tests run the check against stand-in answers (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPublished, checkSiteHeader, decideSite, docsSdkFile } from '../scripts/check-published.mjs';
import { mainnetHeader } from '../scripts/csp.mjs';

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
  assert.throws(() => docsSdkFile("const SDK_FILE = 'http://vyrechain.com/sdk/vyrechain-sdk-0.6.0.tgz';"), /SDK_FILE/, 'only an https address counts');
});

test('the check is a script of its own, named in the handover notes’ publishing steps', () => {
  assert.equal(JSON.parse(read('package.json')).scripts['check:published'], 'node scripts/check-published.mjs');
  assert.match(read('docs/HANDOFF.md').toString(), /npm run check:published/);
});

// After a deploy: the mainnet site's own host must really send the narrow policy (the rule by host in vercel.json). Before the rule
// is live the host still sends the wide one: that is said as "not live yet", never passed as checked.
test('the header check tells the narrow policy from the wide one still being sent, from no policy at all, and from a host that can’t be read', async () => {
  const asked = [];
  const answer = (status, csp) => async (url) => { asked.push(String(url)); return new Response('x', { status, headers: csp === undefined ? {} : { 'content-security-policy': csp } }); };
  const wide = JSON.parse(read('vercel.json').toString()).headers.find((h) => h.missing).headers[0].value;
  assert.deepEqual(await checkSiteHeader({ fetch: answer(200, mainnetHeader()) }), { state: 'narrow' });
  assert.equal(asked[0], 'https://minta.vyrechain.com/terms/', 'a page with no policy of its own, on the mainnet host');
  const notLive = await checkSiteHeader({ fetch: answer(200, wide) });
  assert.equal(notLive.state, 'not-live');
  assert.match(notLive.message, /still sends the wide content policy.*not live there yet/);
  for (const csp of [undefined, '', "default-src 'self'", `${mainnetHeader()}; img-src https:`, mainnetHeader().replace('https://api.vyrechain.com', 'https:')]) {
    const r = await checkSiteHeader({ fetch: answer(200, csp) });
    assert.equal(r.state, 'wrong', String(csp).slice(0, 40));
  }
  assert.match((await checkSiteHeader({ fetch: answer(200, undefined) })).message, /sends no Content-Security-Policy header at all/);
  assert.equal((await checkSiteHeader({ fetch: answer(503, mainnetHeader()) })).state, 'unread');
  assert.equal((await checkSiteHeader({ fetch: async () => { throw new TypeError('fetch failed'); } })).state, 'unread');
  // the command: narrow passes; "not live" is a loud note, and a failure with --live; wrong always fails
  // a full narrow policy whose three host lists differ from this checkout's (an earlier or later version of them): not live yet, not wrong
  const h = mainnetHeader();
  for (const other of [h.replace('https://explorer.vyrechain.com ', ''), h.replace('https://api.vyrechain.com https://explorer', 'https://api.vyrechain.com https://mine.example.com https://explorer'), h.replace("img-src 'self' data: https://api.vyrechain.com", "img-src 'self' data: https://api.vyrechain.com https://mine.example.com"), h.replace('frame-src https://verify.walletconnect.org', 'frame-src https://verify.walletconnect.org https://other.example')]) {
    const r = await checkSiteHeader({ fetch: answer(200, other) });
    assert.equal(r.state, 'not-live', other.slice(60, 140));
    assert.match(r.message, /other lists than this checkout’s/);
  }
  // but never one that is wider in kind, or differs anywhere else
  for (const bad of [h.replace('https://api.vyrechain.com https://explorer', 'https: https://explorer'), h.replace('https://rpc.mainnet.arc.io', '*'), h.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), h.replace("; object-src 'none'", ''), h.replace('frame-src https://verify.walletconnect.org', 'frame-src'), h.replace("img-src 'self' data: https://api.vyrechain.com", "img-src 'self' https: data:")]) {
    assert.equal((await checkSiteHeader({ fetch: answer(200, bad) })).state, 'wrong', bad.slice(60, 150));
  }
  // in the three lists only 'self', data: (pictures only) and whole https or wss origins count as a narrow policy's own
  for (const bad of [
    h.replace('https://rpc.mainnet.arc.io', 'https://*.arc.io'), h.replace('https://rpc.mainnet.arc.io', 'http://rpc.mainnet.arc.io'), h.replace('https://rpc.mainnet.arc.io', 'rpc.mainnet.arc.io'),
    h.replace('https://rpc.mainnet.arc.io', "'unsafe-inline'"), h.replace('https://rpc.mainnet.arc.io', 'blob:'), h.replace('https://rpc.mainnet.arc.io', 'wss:'), h.replace('https://rpc.mainnet.arc.io', 'https://rpc.mainnet.arc.io/path'),
    h.replace("connect-src 'self'", "connect-src 'self' data:"), h.replace('frame-src https://verify.walletconnect.org', 'frame-src data:'), h.replace('frame-src https://verify.walletconnect.org', "frame-src 'none' https://x.example"),
  ]) assert.equal((await checkSiteHeader({ fetch: answer(200, bad) })).state, 'wrong', bad.slice(100, 200));
  // a list under another directive's name is not that list: the directives are compared by name, in order
  for (const bad of [h.replace('img-src ', 'media-src ').replace("media-src 'self';", "img-src 'self';"), h.replace('frame-src ', 'child-src '), h.replace('connect-src ', 'frame-src ').replace(/frame-src https:\/\/verify\.walletconnect\.org$/, 'connect-src https://verify.walletconnect.org'), h.replace("; base-uri 'none'", "; base-uri 'self'")]) {
    assert.equal((await checkSiteHeader({ fetch: answer(200, bad) })).state, 'wrong', bad.slice(0, 120));
  }
  // "the wide policy" is the one in the rule for every host but the mainnet site's (the rule with `missing`), nowhere else
  const moved = JSON.parse(read('vercel.json').toString());
  const wideRule = moved.headers.find((x) => x.missing);
  const elsewhere = { ...moved, headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'" }] }, ...moved.headers.filter((x) => x !== wideRule), { source: '/other', headers: wideRule.headers }] };
  const readMoved = (f) => (f === 'vercel.json' ? Buffer.from(JSON.stringify(elsewhere)) : read(f));
  assert.equal((await checkSiteHeader({ fetch: answer(200, wide), read: readMoved })).state, 'wrong', 'the wide policy no longer in a rule with `missing`: not taken for "not live yet"');
  assert.equal((await checkSiteHeader({ fetch: answer(200, "default-src 'none'"), read: readMoved })).state, 'wrong', 'nor is some other rule’s policy');
  // what the command does with each answer, before a deploy and (--live) after one
  const states = { narrow: { state: 'narrow' }, notLive: { state: 'not-live', message: 'M' }, unread: { state: 'unread', message: 'M' }, wrong: { state: 'wrong', message: 'M' } };
  for (const live of [false, true]) assert.deepEqual(Object.keys(decideSite(states.narrow, live)), ['ok'], 'the narrow policy passes either way');
  assert.deepEqual(decideSite(states.notLive, false), { note: 'NOT CHECKED AS LIVE: M' });
  assert.deepEqual(decideSite(states.unread, false), { note: 'NOT CHECKED AS LIVE: M' });
  assert.deepEqual(decideSite(states.wrong, false), { problem: 'M' }, 'no policy, or another one, fails before a deploy too');
  for (const k of ['notLive', 'unread', 'wrong']) assert.deepEqual(decideSite(states[k], true), { problem: 'M' }, `${k} fails after a deploy`);
  const script = read('scripts/check-published.mjs').toString();
  assert.match(script, /const live = process\.argv\.includes\('--live'\);\n\s*const site = await checkSiteHeader\(\);\n\s*const what = decideSite\(site, live\);\n\s*if \(what\.ok\) console\.log\(what\.ok\);\n\s*if \(what\.note\) console\.warn\(what\.note\);\n\s*if \(what\.problem\) problems\.push\(what\.problem\);/);
  // the strict run has its own script, and the hand-off notes name it as the step after every deploy
  assert.equal(JSON.parse(read('package.json').toString()).scripts['check:live'], 'node scripts/check-published.mjs --live');
  assert.match(read('docs/HANDOFF.md').toString(), /After every deploy to the mainnet site's host, run `npm run check:live`/);
});
