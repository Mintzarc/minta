// Checks a blocklist.json file: node android/scripts/check-blocklist.mjs <file>. Exit 0 only for valid JSON of the right shape
// ({"version": 1, "tokens": [addresses], "creators": [addresses]}). The release workflow runs it on the LIVE file, because the app shows
// everything when the file is missing or invalid.
import fs from 'node:fs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The problems with a parsed file (an empty list means it is valid) */
export function problems(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not an object'];
  const out = [];
  if (v.version !== 1) out.push('version is not 1');
  for (const k of ['tokens', 'creators']) {
    if (!Array.isArray(v[k])) { out.push(`${k} is not a list`); continue; }
    v[k].forEach((a, i) => { if (typeof a !== 'string' || !ADDRESS.test(a)) out.push(`${k}[${i}] is not an address`); });
    if (new Set(v[k].map((a) => String(a).toLowerCase())).size !== v[k].length) out.push(`${k} has a duplicate`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  let v;
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: not valid JSON (${e.message})`); process.exit(1); }
  const p = problems(v);
  if (p.length) { console.error(`${file}: ${p.join('; ')}`); process.exit(1); }
  console.log(`${file}: valid (${v.tokens.length} tokens, ${v.creators.length} creators)`);
}
