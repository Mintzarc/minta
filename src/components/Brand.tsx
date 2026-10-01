// MINTA's mark and wordmark: MINTA's logo (brand/logo-source.jpg), cut into transparent pictures so they sit on any dark page
// (public/brand: the M alone, MINTA in letters, and the whole logo with its ring), and the glyph for the VYRE chain beside it.
import { useId } from 'react';

const BASE = import.meta.env.BASE_URL;
const M_RATIO = 619 / 633; // the M picture's width over its height
const WORD_RATIO = 960 / 128;

/** The M: faceted glass, teal, lit from within */
export function MintaMark({ size = 34 }: { size?: number }) {
  return <img className="mark" src={`${BASE}brand/minta-m.webp`} width={Math.round(size * M_RATIO)} height={size} alt="" aria-hidden="true" draggable={false} />;
}

/** MINTA in letters, the A carrying its small cyan triangle; `height` is the picture's height */
export function MintaWordmark({ height = 20 }: { height?: number }) {
  return <img className="wordmark" src={`${BASE}brand/minta-wordmark.webp`} width={Math.round(height * WORD_RATIO)} height={height} alt="MINTA" draggable={false} />;
}

/** The mark with MINTA beside it */
export function MintaLogo({ size = 34 }: { size?: number }) {
  return (
    <span className="logo">
      <MintaMark size={size} />
      <MintaWordmark height={Math.round(size * 0.37)} />
    </span>
  );
}

/** The VYRE chain's glyph: a faceted V, for the chain selector and the cards that name the chain */
export function VyreGlyph({ size = 18 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="vglyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3ef0f5" /><stop offset="1" stopColor="#16b3bd" /></linearGradient>
        <linearGradient id={`${id}b`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a6fcff" /><stop offset="1" stopColor="#32dfe7" /></linearGradient>
      </defs>
      <path d="M2 4h8.5l5.5 14v10Z" fill={`url(#${id}a)`} />
      <path d="M30 4h-8.5L16 18v10Z" fill={`url(#${id}b)`} />
      <path d="M10.5 4h11L16 18Z" fill="#0b5961" opacity="0.8" />
    </svg>
  );
}
