// Wallets that were asked to send a launch and did not confirm it (it may have gone out), with the words shown for it. Kept for the
// tab (session storage) and in memory: closing the review, or reloading the page, does not forget it, so the launch button never
// turns back into an ordinary one by itself. Cleared only by the person saying it isn't in their wallet (or that it went out), or by
// a launch from that wallet being sent or confirmed. Imports nothing, so the tests load it as it is.

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const ADDRESS = /^0x[0-9a-f]{40}$/;
/** The most wallets kept, and the longest sentence kept for one (what is read back is shown on the page) */
const MAX_WALLETS = 20;
const MAX_WORDS = 600;

/** What a stored value holds: wallet (lower-case address) -> words. Anything else in it is dropped. */
export function parseUnsure(raw: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || raw.length > 40_000) return out;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return out; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
    if (out.size >= MAX_WALLETS) break;
    if (ADDRESS.test(k) && typeof w === 'string' && w.length > 0 && w.length <= MAX_WORDS) out.set(k, w);
  }
  return out;
}

/** The unsettled launches, kept in `store` under `key` (and in memory when the store can't be used) */
export function unsureStore(store: () => Store | null, key: string) {
  let mem: Map<string, string> | null = null;
  const read = (): Map<string, string> => {
    if (mem) return mem;
    let raw: string | null = null;
    try { raw = store()?.getItem(key) ?? null; } catch { /* storage blocked: memory only */ }
    mem = parseUnsure(raw);
    return mem;
  };
  const write = () => {
    try {
      const s = store();
      if (!s) return;
      if (read().size) s.setItem(key, JSON.stringify(Object.fromEntries(read()))); else s.removeItem(key);
    } catch { /* not kept: held while the page stays open */ }
  };
  return {
    has: (who: string) => read().has(who.toLowerCase()),
    get: (who: string) => read().get(who.toLowerCase()),
    set: (who: string, words: string) => { read().set(who.toLowerCase(), words.slice(0, MAX_WORDS)); write(); },
    delete: (who: string) => { if (read().delete(who.toLowerCase())) write(); },
  };
}
