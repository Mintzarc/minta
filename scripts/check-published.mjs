// Before a build of MINTA is published: the SDK package the in-app docs tell builders to install (`SDK_FILE` in src/pages/Docs.tsx,
// the release vendored here) must answer at its address and be that same file, byte for byte (vendor/SHA256SUMS). The vendored copy
// can be a release that vyrechain.com doesn't serve yet; a build published then would show builders an install line that fails.
//   node scripts/check-published.mjs   (npm run check:published; it asks the network)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MAINNET_HOST, mainnetHeader } from './csp.mjs';

const ROOT = new URL('..', import.meta.url);
const readFile = (p) => fs.readFileSync(new URL(p, ROOT));

/** The SDK package the docs' install line names: its address and its file name */
export function docsSdkFile(docs) {
  const m = /^const SDK_FILE = '(https:\/\/[^'\s]+\/(vyrechain-sdk-\d+\.\d+\.\d+\.tgz))';$/m.exec(docs);
  if (!m) throw new Error('src/pages/Docs.tsx has no SDK_FILE line naming an https address of a vyrechain-sdk-<version>.tgz');
  return { url: m[1], file: m[2] };
}

/** What holds a publish, in sentences ([] when nothing does). `fetch` and `read` (a repository file's bytes) can be stand-ins */
export async function checkPublished({ fetch = globalThis.fetch, read = readFile, timeoutMs = 20_000 } = {}) {
  const { url, file } = docsSdkFile(read('src/pages/Docs.tsx').toString());
  const sums = new Map();
  for (const line of read('vendor/SHA256SUMS').toString().split('\n')) {
    const m = /^([0-9a-f]{64}) [ *]([\w.@-]+)$/.exec(line.trim());
    if (m) sums.set(m[2], m[1]);
  }
  const want = sums.get(file);
  if (!want) return [`The docs’ install line names ${file}, which isn’t the SDK vendored here (vendor/SHA256SUMS): name the vendored release in SDK_FILE.`];
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return [`${url} couldn’t be reached (${e instanceof Error ? e.message : String(e)}): check again before publishing.`];
  }
  if (!r.ok) return [`${url} answers ${r.status}: the docs’ install line would fail for builders. Publish once that address serves the vendored ${file}.`];
  const got = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
  if (got !== want) return [`${url} serves a different file from the vendored ${file} (SHA-256 ${got}; vendored ${want}).`];
  return [];
}

/**
 * The content policy the mainnet site's host really sends (vercel.json's rule by host, scripts/csp.mjs): read from a page that has
 * no policy of its own, the terms. Answers one of:
 *   { state: 'narrow' }                 the narrow policy is the header: the rule works on the host
 *   { state: 'not-live', message }      the host still sends the wide policy of before this rule: the change is not deployed there yet
 *   { state: 'wrong', message }         no policy header, or some other one: the host rule is not doing what vercel.json says
 *   { state: 'unread', message }        the host could not be read
 * `fetch` and `read` can be stand-ins.
 */
export async function checkSiteHeader({ fetch = globalThis.fetch, read = readFile, timeoutMs = 20_000 } = {}) {
  const url = `https://${MAINNET_HOST}/terms/`;
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' }); }
  catch (e) { return { state: 'unread', message: `${url} couldn’t be reached (${e instanceof Error ? e.message : String(e)}): the content policy it sends was not checked.` }; }
  if (!r.ok) return { state: 'unread', message: `${url} answers ${r.status}: the content policy it sends was not checked.` };
  const got = r.headers.get('content-security-policy');
  if (got === mainnetHeader()) return { state: 'narrow' };
  // the wide policy, as vercel.json sends it on every other host (and as the mainnet host sent it before the rule by host)
  const rules = JSON.parse(read('vercel.json').toString()).headers ?? [];
  const wide = rules.filter((x) => Array.isArray(x.missing)).flatMap((x) => x.headers ?? []).find((h) => h.key === 'Content-Security-Policy')?.value;
  if (got && got === wide) return { state: 'not-live', message: `${url} still sends the wide content policy: the rule that sends the narrow one on ${MAINNET_HOST} is not live there yet (or does not match that host). Check again after the deploy; with --live this is a failure.` };
  return { state: 'wrong', message: got ? `${url} sends a content policy that is neither the narrow one (scripts/csp.mjs) nor the wide one: ${got}` : `${url} sends no Content-Security-Policy header at all.` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = await checkPublished();
  // (--live: run after a deploy, when the narrow policy must already be the mainnet host's header)
  const live = process.argv.includes('--live');
  const site = await checkSiteHeader();
  if (site.state === 'narrow') console.log(`${MAINNET_HOST} sends the narrow content policy as its header.`);
  else if (site.state === 'wrong' || live) problems.push(site.message);
  else console.warn(`NOT CHECKED AS LIVE: ${site.message}`);
  for (const p of problems) console.error(p);
  console.log(problems.length ? 'Not ready to publish.' : 'The docs’ SDK install line answers with the vendored file.');
  process.exit(problems.length ? 1 : 0);
}
