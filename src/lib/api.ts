// The app API (api.vyrechain.com): it keeps launches' pictures and picture-and-links files, so creators don't have to host
// anything: they upload the picture (lib/picture.ts makes it ready) and the file's "image" is the address that comes back.
// the app API's address; built with VITE_API_URL it can point anywhere (a service of MINTA's own, say)
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'https://api.vyrechain.com';

export interface LaunchFile {
  description?: string;
  image?: string;
  links?: Partial<Record<'website' | 'x' | 'telegram' | 'discord', string>>;
}

/** Uploads a picture (already made ready by preparePicture) and returns its address, to put in a launch file as its "image" */
export async function uploadPicture(blob: Blob): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}/image`, { method: 'POST', headers: { 'content-type': blob.type }, body: blob, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error('The picture couldn’t be sent: the service that keeps pictures isn’t reachable right now. Try again in a minute, or launch without a picture and add it later.');
  }
  const j = (await r.json().catch(() => ({}))) as { uri?: string; error?: string };
  if (!r.ok || typeof j.uri !== 'string' || !j.uri.startsWith(`${API_URL}/i/`)) throw new Error(j.error ? `The picture was refused: ${j.error}.` : 'The picture couldn’t be saved.');
  return j.uri;
}

/** The launch file to save for a form's state: its picture uploaded first when one was chosen (the file then points at it) */
export async function withUploadedPicture(file: LaunchFile, picture?: { blob: Blob } | null): Promise<LaunchFile> {
  return picture ? { ...file, image: await uploadPicture(picture.blob) } : file;
}

/** Stores a launch file and returns the link to put on chain (the same content always gets the same link) */
export async function saveLaunchFile(file: LaunchFile): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}/metadata`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(file),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('The service that keeps launch files isn’t reachable right now. Launch without them (you can add them later), or paste your own link under “Your own file”.');
  }
  const j = (await r.json().catch(() => ({}))) as { uri?: string; error?: string };
  if (!r.ok || !j.uri) throw new Error(j.error || 'The launch file couldn’t be saved.');
  return j.uri;
}

/** Whether a launch file has anything in it */
export const hasContent = (f: LaunchFile) => !!(f.description?.trim() || f.image?.trim() || Object.values(f.links || {}).some((v) => v?.trim()));

/** A card / Apple Pay checkout (Transak) that delivers USDC on Arc to `address`; the link works once, for 5 minutes */
export async function topupLink(address: string, usd?: number): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}/topup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, usd }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('The card checkout isn’t reachable right now. Try again soon.');
  }
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  // only ever Transak's own site: transak.com or a name under it (not "anything ending in transak.com")
  let host = '';
  try { const u = new URL(j.url || ''); host = u.protocol === 'https:' ? u.hostname : ''; } catch { host = ''; }
  if (!r.ok || !(host === 'transak.com' || host.endsWith('.transak.com'))) throw new Error(j.error || 'The card checkout couldn’t be opened.');
  return j.url!;
}

// Promoter codes (vyrechain.com/promote): the sign-up service answers only for codes whose wallet is approved on chain
const PROMOTERS_URL = (import.meta.env.VITE_PROMOTERS_URL as string | undefined)?.replace(/\/$/, '') || 'https://testnet-rpc.vyrechain.com/promoters';
export const isPromoterCode = (s: string) => /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(s);

/** The wallet behind an approved promoter code, or null if none; throws if the list can't be read just now */
export async function promoterWallet(code: string): Promise<{ code: string; wallet: string } | null> {
  if (!isPromoterCode(code)) return null;
  const r = await fetch(`${PROMOTERS_URL}/code/${code.toLowerCase()}`, { signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return null; // no approved promoter has it
  if (!r.ok) throw new Error('the promoter list is busy'); // starting or unreachable: worth asking again
  const j = (await r.json().catch(() => null)) as { code?: unknown; wallet?: unknown } | null;
  return j && typeof j.code === 'string' && j.code === code.toLowerCase() && typeof j.wallet === 'string' ? { code: j.code, wallet: j.wallet } : null;
}

/** A wallet's promoter application: its code and whether it's approved, or null if it hasn't applied */
export async function promoterStatus(wallet: string): Promise<{ code: string; status: string } | null> {
  const r = await fetch(`${PROMOTERS_URL}/status/${wallet}`, { signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return null;
  const j = (await r.json().catch(() => null)) as { code?: unknown; status?: unknown } | null;
  if (!r.ok || !j || typeof j.code !== 'string' || !isPromoterCode(j.code) || typeof j.status !== 'string') throw new Error('status unavailable');
  return { code: j.code, status: j.status };
}
