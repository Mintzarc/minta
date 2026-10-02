// The meme mascots MINTA shows for a token that has no picture of its own: public/memes/m01.webp ... (50 original cartoon
// characters). A token's address picks one, so the same token always gets the same mascot. Decoration only: the creator's own
// picture replaces it as soon as there is one.
export const MEME_COUNT = 50;

/** The mascot number (1 to MEME_COUNT) for a token's address (or any text) */
export function memeNumber(seed: string): number {
  let h = 2166136261;
  for (const ch of (seed || 'minta').toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; // mixes the last characters in (addresses differ mostly there)
  return ((h >>> 0) % MEME_COUNT) + 1;
}

/** The mascot's file name, under the app's `memes/` folder */
export const memeFile = (seed: string) => `memes/m${String(memeNumber(seed)).padStart(2, '0')}.webp`;
