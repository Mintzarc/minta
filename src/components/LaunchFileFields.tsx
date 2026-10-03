// The picture, description and links of a launch, as form fields; or, for those who host their own file, its link.
// The picture is chosen from the device (nobody should have to find an image link): it is made ready here and uploaded when the
// launch is sent (lib/api.ts withUploadedPicture). A picture link to another site isn't taken: MINTA's pages draw only pictures
// the picture service keeps (lib/picture.ts shownPicture), so one would never show. A launch file that already has one (from
// before, or the creator's own) shows it in the field as a link that isn't drawn; saving the fields leaves it out of the new file
// (lib/api.ts storable), and the field says so first.
import { useRef, useState } from 'react';
import { API_URL, type LaunchFile } from '../lib/api';
import { preparePicture, shownPicture, type Picture } from '../lib/picture';

export interface LaunchFileState {
  file: LaunchFile;
  own: string; // a link to the creator's own file, used instead when set
  useOwn: boolean;
  /** A picture chosen from the device, ready to upload; sent when the launch is, and replacing file.image */
  picture?: Picture | null;
}
/** A launch file's picture link when MINTA draws it (one the picture service keeps), else '' */
export const keptPicture = (u?: string) => shownPicture(u?.trim(), API_URL) || '';
/** Whether the launch has a picture of its own that MINTA shows: one chosen here, or one the picture service already keeps */
export const hasPicture = (s: LaunchFileState) => !!(s.picture || keptPicture(s.file.image));

export const emptyLaunchFile = (): LaunchFileState => ({ file: { links: {} }, own: '', useOwn: false });

const LINKS: { key: 'website' | 'x' | 'telegram' | 'discord'; label: string; ph: string }[] = [
  { key: 'website', label: 'Website', ph: 'https://…' },
  { key: 'x', label: 'X', ph: 'https://x.com/…' },
  { key: 'telegram', label: 'Telegram', ph: 'https://t.me/…' },
  { key: 'discord', label: 'Discord', ph: 'https://discord.gg/…' },
];
const httpsOk = (u?: string) => !u?.trim() || /^https:\/\/[^\s]+$/.test(u.trim());

type Part = 'all' | 'basics' | 'links' | 'info' | 'own';
/** What's wrong with the fields, or ''. `part` narrows it, for a form that asks for them on different steps: the picture and
 * description ('basics'), the links ('links'), both ('info'), or the creator's own file ('own'); the whole file is always
 * checked on send */
export function launchFileProblem(s: LaunchFileState, part: Part = 'all'): string {
  if (s.useOwn) {
    if (part === 'basics' || part === 'links' || part === 'info') return '';
    const u = s.own.trim();
    if (!u) return '';
    if (!/^(https:\/\/|ipfs:\/\/)\S+$/.test(u)) return 'Your own file’s link must start with https:// or ipfs://.';
    if (new TextEncoder().encode(u).length > 256) return 'That link is too long (256 bytes at most).';
    return '';
  }
  if (part === 'own') return '';
  const f = s.file;
  if (part !== 'links') {
    if (f.image?.trim() && !/^(https:\/\/|ipfs:\/\/)\S+$/.test(f.image.trim())) return 'The picture must be an https:// or ipfs:// link.';
    if ((f.description || '').length > 600) return 'The description is too long (600 characters at most).';
  }
  if (part !== 'basics') for (const l of LINKS) if (!httpsOk(f.links?.[l.key])) return `The ${l.label} link must start with https://.`;
  return '';
}

export function LaunchFileFields({ value, onChange, part = 'all' }: { value: LaunchFileState; onChange: (v: LaunchFileState) => void; part?: Part }) {
  const f = value.file;
  const set = (patch: Partial<LaunchFileState['file']>) => onChange({ ...value, file: { ...f, ...patch } });
  const basics = part === 'all' || part === 'basics' || part === 'info';
  const links = part === 'all' || part === 'links' || part === 'info';
  const own = part === 'all' || part === 'own';
  return (
    <div className="launch-file">
      {!value.useOwn && (
        <>
          {basics && (
            <>
              <label className="field"><span>Description</span>
                <textarea rows={3} maxLength={600} value={f.description || ''} onChange={(e) => set({ description: e.target.value })} placeholder="Tell the community about your project…" />
                <small className="count muted">{(f.description || '').length}/600</small>
              </label>
              <PictureField value={value} onChange={onChange} />
            </>
          )}
          {links && (
            <div className="two">
              {LINKS.map((l) => (
                <label className="field" key={l.key}><span>{l.label}</span>
                  <input value={f.links?.[l.key] || ''} onChange={(e) => set({ links: { ...f.links, [l.key]: e.target.value.trim() } })} placeholder={l.ph} />
                </label>
              ))}
            </div>
          )}
        </>
      )}
      {value.useOwn && !own && <p className="small muted">The picture, description and links come from your own file (set under Media &amp; links).</p>}
      {value.useOwn && own && (
        <label className="field"><span>Your own file’s link</span>
          <input value={value.own} onChange={(e) => onChange({ ...value, own: e.target.value.trim() })} placeholder="https://… or ipfs://… (a JSON file)" />
          <small className="muted">{'{"image": "https://…", "description": "…", "links": {"website": "https://…"}}'}</small>
          <small className="muted">MINTA shows only pictures uploaded through it: a picture link to another site in your file isn’t shown (the token’s mascot is).</small>
        </label>
      )}
      {own && (
        <button type="button" className="linkish small" onClick={() => onChange({ ...value, useOwn: !value.useOwn })}>
          {value.useOwn ? 'Fill in the fields instead' : 'Your own file (advanced)'}
        </button>
      )}
    </div>
  );
}

function PictureField({ value, onChange }: { value: LaunchFileState; onChange: (v: LaunchFileState) => void }) {
  const f = value.file;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const shown = value.picture?.preview || keptPicture(f.image);
  // a link to another site's picture (an older file's, or the creator's own): never drawn, and left out when the fields are saved
  const outside = !value.picture && !!f.image?.trim() && !shown;
  const choose = async (file?: File | null) => {
    if (!file) return;
    setErr(''); setBusy(true);
    try {
      const picture = await preparePicture(file);
      onChange({ ...value, picture });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That picture couldn’t be used.');
    } finally { setBusy(false); }
  };
  return (
    <div className="field picture-field">
      <span id="pic-label">Logo</span>
      <div className="pic-up" role="group" aria-labelledby="pic-label"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void choose(e.dataTransfer.files?.[0]); }}>
        <button type="button" className={`pic-up-box ${shown ? 'has' : ''}`} onClick={() => input.current?.click()} aria-label={shown ? 'Choose a different logo' : 'Choose a logo from your device'}>
          {shown
            ? <img src={shown} alt="" referrerPolicy="no-referrer" />
            : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5-5 3 3 3-4 5 6" /></svg>}
        </button>
        <div className="pic-up-side">
          <div className="pic-up-actions">
            <button type="button" className="btn btn-line btn-sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Getting it ready…' : shown ? 'Choose another' : 'Choose a picture'}</button>
            {(shown || outside) && !busy && <button type="button" className="linkish small" onClick={() => { setErr(''); onChange({ ...value, picture: null, file: { ...f, image: '' } }); }}>Remove</button>}
          </div>
          <small className="muted">A PNG, JPEG or WebP from your phone or computer. It’s cropped to a square and shrunk for you; 300 × 300 or larger looks best.</small>
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {outside && <small className="muted pic-outside">This launch’s picture is a link to another site, which MINTA doesn’t show: its pages show only pictures uploaded through it, so they show the token’s mascot. Saving here keeps only uploaded pictures, so that link is left out of the new file. Choose the picture from your device to keep a picture.</small>}
      {err && <small className="err" role="alert">{err}</small>}
    </div>
  );
}
