// Tokens a person chose to hide on this device: a list of token addresses kept in the browser, never sent anywhere. Hidden
// tokens are left out of Explore, the top list and the search; their own page still opens (with a way to show them again).
// Pure: no app imports, so node unit tests can call it.

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
/** At most this many addresses are kept (a stored list can't grow without end) */
export const MAX_HIDDEN = 500;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The addresses in a stored value, lowercased, each once; anything that isn't a list of addresses is dropped */
export function parseHidden(raw: string | null): string[] {
  if (!raw) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const a of v) if (typeof a === 'string' && ADDRESS.test(a) && !out.includes(a.toLowerCase())) out.push(a.toLowerCase());
  return out.slice(0, MAX_HIDDEN);
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
