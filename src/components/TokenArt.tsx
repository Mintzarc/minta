// Art for a launch that has no picture of its own: a meme mascot (lib/memes.ts) picked by the token's address, so the same token
// always gets the same one. If the mascot's file can't load, a faceted gem on a glowing field is drawn from the address instead
// (cyan to violet). Decoration only: it says nothing about the token (the creator's own picture replaces it as soon as there is one).
import { useId, useMemo, useState } from 'react';
import { memeFile } from '../lib/memes';

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n: number) => +n.toFixed(2);

interface Art { id: string; bg: [string, string, number]; glows: { x: number; y: number; r: number; c: string }[]; rings: { r: number; c: string }[]; gem: { pts: [number, number][]; inner: [number, number][]; cx: number; cy: number; a: string; b: string }; stars: { x: number; y: number; r: number; o: number }[] }

function draw(seed: string): Art {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const h1 = pick([166, 176, 186, 196, 206, 218, 232, 248]);
  const h2 = pick([262, 276, 290, 304, 150, 160]);
  const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
  const cx = 50 + (r() - 0.5) * 12, cy = 50 + (r() - 0.5) * 12;
  const n = pick([3, 4, 5, 6, 6, 7, 8]);
  const R = 19 + r() * 9, rot = r() * Math.PI * 2;
  const ring = (rad: number, off: number) => Array.from({ length: n }, (_, i): [number, number] => {
    const t = rot + off + (i * Math.PI * 2) / n;
    return [f(cx + Math.cos(t) * rad), f(cy + Math.sin(t) * rad)];
  });
  return {
    id: `ta${(Math.floor(r() * 1e9) + seed.length).toString(36)}`,
    bg: [hsl(h1, 55, 11), hsl(h2, 60, 5), Math.floor(r() * 360)],
    glows: [
      { x: f(15 + r() * 70), y: f(15 + r() * 70), r: f(32 + r() * 26), c: hsl(h1, 92, 52, 0.55) },
      { x: f(15 + r() * 70), y: f(15 + r() * 70), r: f(28 + r() * 24), c: hsl(h2, 85, 55, 0.45) },
    ],
    rings: [{ r: f(R + 8 + r() * 6), c: hsl(h1, 80, 72, 0.28) }, { r: f(R + 17 + r() * 8), c: hsl(h2, 80, 72, 0.16) }],
    gem: { pts: ring(R, 0), inner: ring(R * 0.55, Math.PI / n), cx: f(cx), cy: f(cy), a: hsl(h1, 95, 72), b: hsl(h2, 85, 46) },
    stars: Array.from({ length: 12 }, () => ({ x: f(r() * 100), y: f(r() * 100), r: f(0.3 + r() * 0.8), o: f(0.25 + r() * 0.55) })),
  };
}

const BASE = import.meta.env.BASE_URL;

/** The fallback: a gem on a glowing field, drawn from the seed */
function Gem({ seed, className }: { seed: string; className: string }) {
  const art = useMemo(() => draw(seed || 'minta'), [seed]);
  // ids unique to this drawing on the page (the same token can be drawn twice, and a copy in a hidden box would take the gradients with it)
  const a = { ...art, id: `ta${useId().replace(/[^a-zA-Z0-9]/g, '')}` };
  const poly = (p: [number, number][]) => p.map((q) => q.join(',')).join(' ');
  return (
    <svg className={`token-art ${className}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${a.id}b`} gradientTransform={`rotate(${a.bg[2]} .5 .5)`}><stop offset="0" stopColor={a.bg[0]} /><stop offset="1" stopColor={a.bg[1]} /></linearGradient>
        {a.glows.map((g, i) => <radialGradient key={i} id={`${a.id}g${i}`}><stop offset="0" stopColor={g.c} /><stop offset="1" stopColor={g.c.replace(/[\d.]+\)$/, '0)')} /></radialGradient>)}
        <linearGradient id={`${a.id}m`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a.gem.a} /><stop offset="1" stopColor={a.gem.b} /></linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${a.id}b)`} />
      {a.glows.map((g, i) => <circle key={i} cx={g.x} cy={g.y} r={g.r} fill={`url(#${a.id}g${i})`} />)}
      {a.stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />)}
      {a.rings.map((g, i) => <circle key={i} cx={a.gem.cx} cy={a.gem.cy} r={g.r} fill="none" stroke={g.c} strokeWidth="0.5" />)}
      <polygon points={poly(a.gem.pts)} fill={`url(#${a.id}m)`} opacity="0.94" stroke="rgba(255,255,255,0.55)" strokeWidth="0.5" strokeLinejoin="round" />
      {a.gem.pts.map((p, i) => <line key={i} x1={a.gem.cx} y1={a.gem.cy} x2={p[0]} y2={p[1]} stroke="rgba(255,255,255,0.3)" strokeWidth="0.4" />)}
      <polygon points={poly(a.gem.inner)} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.45)" strokeWidth="0.45" strokeLinejoin="round" />
      <polygon points={`${a.gem.cx},${a.gem.cy} ${a.gem.pts[0].join(',')} ${a.gem.pts[1].join(',')}`} fill="rgba(255,255,255,0.2)" />
    </svg>
  );
}

export default function TokenArt({ seed, className = '' }: { seed: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <Gem seed={seed} className={className} />;
  return <img className={`token-art ${className}`} src={`${BASE}${memeFile(seed)}`} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />;
}
