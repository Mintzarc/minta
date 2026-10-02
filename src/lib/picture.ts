// Getting a picture ready to upload: whatever the person picks (a photo from the phone, a screenshot, a PNG) is decoded here,
// cropped to a square from the middle, shrunk to 512 px and saved again as a WebP (or a PNG where the browser can't make one).
// Saving it again drops everything but the pixels (location, camera, anything hidden in the file), and it keeps uploads small
// (usually 20 to 80 KB). Nothing leaves the browser until the launch is sent.
export const PICTURE_SIDE = 512;
export const MIN_SIDE = 64;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 380 * 1024; // the API takes 400 KB

// Which pictures MINTA's pages draw: only one the picture service keeps (`api`/i/<sha256>.<webp|png|jpg>, named by the hash of a
// file that service checked: a still PNG, JPEG or WebP of 16 to 1,024 px a side). Any other picture link (another site, IPFS) is
// a file of any size, which every visitor's browser would decode at full size, however small it is drawn: one that says it is
// 20,000 x 20,000 pixels takes gigabytes and stops the page. So such a link is never drawn (the token's mascot is, instead).
const KEPT = /^\/i\/[0-9a-f]{64}\.(?:webp|png|jpg)$/;

/** `u` when it is the exact address of a picture kept by the picture service at `api`, else undefined */
export function shownPicture(u: unknown, api: string): string | undefined {
  const base = api.replace(/\/+$/, '');
  if (typeof u !== 'string' || !base || !u.startsWith(`${base}/i/`)) return undefined;
  return KEPT.test(u.slice(base.length)) ? u : undefined;
}

export interface Picture {
  blob: Blob;
  /** A data: address showing the result (the page's security policy allows data: images, not blob: ones) */
  preview: string;
  width: number;
  height: number;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));
const readAsDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('That picture couldn’t be read.'));
  r.readAsDataURL(b);
});

/** The picked file as a square picture ready to upload; throws an Error saying what's wrong, in words for the person */
export async function preparePicture(file: File): Promise<Picture> {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('SVG pictures aren’t supported: use a PNG, JPEG or WebP.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That file is too big (25 MB at most).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file); // a browser that doesn't take the option (it turns photos upright by itself)
    } catch {
      throw new Error('That picture couldn’t be opened here. Use a PNG, JPEG or WebP (a photo saved as HEIC may need to be saved as JPEG first).');
    }
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side < MIN_SIDE) throw new Error(`That picture is too small (${MIN_SIDE} pixels at least on each side; 300 or more looks best).`);
    const out = Math.min(PICTURE_SIDE, side);
    const sx = Math.floor((bitmap.width - side) / 2), sy = Math.floor((bitmap.height - side) / 2);
    const draw = (background?: string) => {
      const c = document.createElement('canvas');
      c.width = out; c.height = out;
      const g = c.getContext('2d');
      if (!g) throw new Error('This browser can’t prepare pictures.');
      if (background) { g.fillStyle = background; g.fillRect(0, 0, out, out); }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
      return c;
    };
    // WebP first (small, keeps see-through areas); a browser that can't make one answers with a PNG; too big, a JPEG on a dark ground
    const c1 = draw();
    let blob = await toBlob(c1, 'image/webp', 0.9);
    if (!blob || blob.size > MAX_UPLOAD_BYTES) blob = await toBlob(c1, 'image/webp', 0.7);
    if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/png') || blob.size > MAX_UPLOAD_BYTES) {
      const j = await toBlob(draw('#07121a'), 'image/jpeg', 0.85);
      if (j && j.type === 'image/jpeg' && j.size <= MAX_UPLOAD_BYTES) blob = j;
    }
    if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error('That picture couldn’t be made small enough. Try a simpler one.');
    return { blob, preview: await readAsDataUrl(blob), width: out, height: out };
  } finally {
    bitmap.close();
  }
}
