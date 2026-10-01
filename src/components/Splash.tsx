// The splash: a short silent film (about 10 s: a train through MINTA's mountain, ending on the logo; when there are several films, they
// take turns, one each time it plays) that plays over the Pad when
// someone opens its home page, and never gets in the way. It plays once every six hours on a device, only on the home page (a
// shared token link, the docs or a search go straight to what was asked for), and a tap, Esc, Enter or the Skip button ends it at
// once. It stands down by itself when it can't play well: reduced motion, Data Saver, a browser that refuses autoplay, a film
// that hasn't started in four seconds or stalls for four seconds, a storage that can't remember it played. The Pad loads
// underneath all the while and is inert (no tabbing into it) until the splash leaves. `?splash` in the address plays it
// regardless, to show it off. Assets: `brand/splash/make-assets.sh` (public/splash/).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { parseRoute } from '../lib/router';
import { FILMS, nextFilm } from '../lib/films';

const KEY = 'minta.splash'; // when it last played (ms since 1970)
const FILM_KEY = 'minta.splash.film'; // which film played last (an index into FILMS), so the next play shows the other
const EVERY = 6 * 3600_000;
const START_BY = 4000; // not playing by then: leave
const STALL_BY = 4000; // stalled this long: leave
const MAX = 14_000; // the film is 10 s; whatever happens it is gone by now
const HOLD = 450; // the logo stays this long after the film ends
const FADE = 600; // keep in step with .splash's transition in styles.css

/** Whether to play it now; reads only (nothing is written until it actually shows) */
function wanted(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return false;
    if (new URLSearchParams(window.location.search).has('splash')) return true;
    const r = parseRoute(window.location.hash);
    if (r.page !== 'explore' || r.q) return false;
    const last = Number(window.localStorage.getItem(KEY) ?? 0);
    return !(Number.isFinite(last) && Date.now() - last < EVERY && last <= Date.now() + 60_000);
  } catch {
    return false; // can't tell whether it played already (storage blocked): better none than every time
  }
}

/** The film for this play: the one after the one shown last time (the first, when none is remembered or storage can't say) */
function chooseFilm(): number {
  try {
    const v = window.localStorage.getItem(FILM_KEY);
    return nextFilm(FILMS.length, v === null ? null : Number(v));
  } catch {
    return 0;
  }
}

export default function Splash() {
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>(() => (wanted() ? 'in' : 'gone'));
  const [film] = useState(chooseFilm);
  const video = useRef<HTMLVideoElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const leave = useCallback(() => setPhase((p) => (p === 'in' ? 'out' : p)), []);

  useEffect(() => {
    if (phase !== 'in') return;
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
      window.localStorage.setItem(FILM_KEY, String(film));
    } catch { /* nothing to do */ }
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    document.documentElement.classList.add('splash-on');
    skip.current?.focus({ preventScroll: true });
    const v = video.current;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const timers = [
      setTimeout(() => { if (!v || v.paused || v.currentTime === 0) leave(); }, START_BY),
      setTimeout(leave, MAX),
    ];
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); leave(); } };
    const onWaiting = () => { clearTimeout(stall); stall = setTimeout(leave, STALL_BY); };
    const onPlaying = () => clearTimeout(stall);
    const onEnded = () => { timers.push(setTimeout(leave, HOLD)); };
    window.addEventListener('keydown', onKey);
    if (v) {
      v.muted = true; // autoplay is allowed only for a muted film (React doesn't always set the attribute)
      v.addEventListener('waiting', onWaiting);
      v.addEventListener('playing', onPlaying);
      v.addEventListener('ended', onEnded);
      v.addEventListener('error', leave);
      v.play().catch(leave);
    }
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(stall);
      window.removeEventListener('keydown', onKey);
      if (v) {
        v.removeEventListener('waiting', onWaiting); v.removeEventListener('playing', onPlaying);
        v.removeEventListener('ended', onEnded); v.removeEventListener('error', leave);
      }
      root?.removeAttribute('inert');
      document.documentElement.classList.remove('splash-on');
    };
  }, [phase, leave, film]);

  useEffect(() => {
    if (phase !== 'out') return;
    video.current?.pause();
    const t = setTimeout(() => setPhase('gone'), FADE + 150);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;
  return createPortal(
    <div className={`splash${phase === 'out' ? ' out' : ''}`} role="dialog" aria-modal="true" aria-label="MINTA intro" onClick={leave}>
      <video ref={video} src={FILMS[film].src} poster={FILMS[film].poster} style={{ '--r': FILMS[film].ratio } as CSSProperties} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1} disablePictureInPicture disableRemotePlayback controlsList="nodownload noremoteplayback" />
      <button ref={skip} type="button" className="splash-skip" onClick={(e) => { e.stopPropagation(); leave(); }}>
        Skip<svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </button>
    </div>,
    document.body,
  );
}
