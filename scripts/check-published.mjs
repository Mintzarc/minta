// Before a build of MINTA is published: the SDK package the in-app docs tell builders to install (`SDK_FILE` in src/pages/Docs.tsx,
// the release vendored here) must answer at its address and be that same file, byte for byte (vendor/SHA256SUMS). The vendored copy
// can be a release that vyrechain.com doesn't serve yet; a build published then would show builders an install line that fails.
//   node scripts/check-published.mjs   (npm run check:published; it asks the network)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = await checkPublished();
  for (const p of problems) console.error(p);
  console.log(problems.length ? 'Not ready to publish.' : 'The docs’ SDK install line answers with the vendored file.');
  process.exit(problems.length ? 1 : 0);
}
