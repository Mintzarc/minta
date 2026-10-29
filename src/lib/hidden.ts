// Tokens a person chose to hide on this device: a list of token addresses kept in the browser, never sent anywhere. Hidden
// tokens are left out of Explore, the top list and the search; their own page still opens (with a way to show them again).
// Pure: no app imports, so node unit tests can call it.

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
/** At most this many addresses are kept (a stored list can't grow without end) */
export const MAX_HIDDEN = 500;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A stored list longer than this many characters is not one MINTA wrote (500 addresses are about 25,000): it is dropped unread */
const MAX_RAW = 100_000;

/** The addresses in a stored value, lowercased, each once, at most MAX_HIDDEN of them (scanning stops there); anything that isn't a list of addresses is dropped */
export function parseHidden(raw: string | null): string[] {
  if (!raw || raw.length > MAX_RAW) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.length && out.length < MAX_HIDDEN; i++) {
    const a = v[i];
    if (typeof a !== 'string' || !ADDRESS.test(a)) continue;
    const l = a.toLowerCase();
    if (!seen.has(l)) { seen.add(l); out.push(l); }
  }
  return out;
}

export function loadHidden(store: Store | null, key: string): string[] {
  try { return parseHidden(store?.getItem(key) ?? null); } catch { return []; }
}

/** Adds a token to the list (when it is an address); returns the list now kept */
export function hideToken(store: Store | null, key: string, token: string): string[] {
  const now = loadHidden(store, key);
  if (!ADDRESS.test(token) || now.includes(token.toLowerCase())) return now;
  const next = [...now, token.toLowerCase()].slice(-MAX_HIDDEN);
  try { store?.setItem(key, JSON.stringify(next)); } catch { /* storage blocked: nothing is kept */ }
  return next;
}

export function showToken(store: Store | null, key: string, token: string): string[] {
  const next = loadHidden(store, key).filter((a) => a !== token.toLowerCase());
  try { store?.setItem(key, JSON.stringify(next)); } catch { /* storage blocked */ }
  return next;
}

export function showAllTokens(store: Store | null, key: string): string[] {
  try { store?.removeItem(key); } catch { /* storage blocked */ }
  return [];
}

/** The launches whose token is not in the hidden list */
export function withoutHidden<T extends { token: string }>(rows: T[], hidden: readonly string[]): T[] {
  if (hidden.length === 0) return rows;
  const set = new Set(hidden);
  return rows.filter((r) => !set.has(r.token.toLowerCase()));
}

// ---- the list MINTA's team keeps: tokens and creators it has decided to hide because they were reported ----

/** The schema of `public/blocklist.json`: {"version": 1, "tokens": [addresses], "creators": [addresses]} */
export interface Blocklist { tokens: string[]; creators: string[] }
export const NO_BLOCKS: Blocklist = { tokens: [], creators: [] };
export const MAX_BLOCKLIST = 5000;

/** What the app takes from the file: version 1 only, addresses only (lowercased, once each, at most MAX_BLOCKLIST per list); anything else is ignored */
export function parseBlocklist(v: unknown): Blocklist {
  if (!v || typeof v !== 'object' || (v as { version?: unknown }).version !== 1) return NO_BLOCKS;
  const list = (x: unknown): string[] => {
    if (!Array.isArray(x)) return [];
    const out = new Set<string>();
    for (let i = 0; i < x.length && out.size < MAX_BLOCKLIST; i++) if (typeof x[i] === 'string' && ADDRESS.test(x[i])) out.add((x[i] as string).toLowerCase());
    return [...out];
  };
  return { tokens: list((v as Blocklist).tokens), creators: list((v as Blocklist).creators) };
}

/** True when the file or the visitor's own lists hide this launch: its token, or everything from its creator */
export function isHidden(l: { token: string; creator: string }, hiddenTokens: readonly string[], hiddenCreators: readonly string[], block: Blocklist): boolean {
  const t = l.token.toLowerCase(), c = l.creator.toLowerCase();
  return hiddenTokens.includes(t) || hiddenCreators.includes(c) || block.tokens.includes(t) || block.creators.includes(c);
}

/** The launches that are not hidden by the file or by the visitor */
export function visibleLaunches<T extends { token: string; creator: string }>(rows: T[], hiddenTokens: readonly string[], hiddenCreators: readonly string[], block: Blocklist): T[] {
  if (!hiddenTokens.length && !hiddenCreators.length && !block.tokens.length && !block.creators.length) return rows;
  const ht = new Set(hiddenTokens), hc = new Set(hiddenCreators), bt = new Set(block.tokens), bc = new Set(block.creators);
  return rows.filter((r) => { const t = r.token.toLowerCase(), c = r.creator.toLowerCase(); return !(ht.has(t) || hc.has(c) || bt.has(t) || bc.has(c)); });
}
