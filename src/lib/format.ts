// Numbers and addresses for people: USDC amounts, prices down to tiny fractions, compact market caps.
import { formatUnits, parseUnits, type Address } from 'viem';

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/** A bigint with 18 decimals, to at most `places` decimals, with thousands separators */
export function amount(v: bigint, places = 4): string {
  const s = formatUnits(v, 18);
  const [w, f = ''] = s.split('.');
  const frac = f.slice(0, places).replace(/0+$/, '');
  const whole = BigInt(w.replace('-', '')).toLocaleString('en-US');
  return `${w.startsWith('-') ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** USDC with a $ sign; tiny amounts keep their significant digits */
export function usd(n: number): string {
  if (!isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (Math.abs(n) >= 1000) return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

/** An 18-decimal USDC amount with a $ sign, like usd() */
export const usdOf = (v: bigint) => usd(Number(formatUnits(v, 18)));

const sub = (n: number) => String(n).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]);

/** A price per token: prices of launch tokens are often tiny (a $5,000 market cap over a billion tokens), so from two
 * zeros after the point on, the zeros are counted, as a small number (0.0₅503 is 0.00000503). `sig` significant
 * digits. */
export function price(n: number, sig = 3): string {
  if (!isFinite(n) || n <= 0) return '—';
  // round first, then read the zeros from the rounded number's exponent (0.0009996 rounds to 0.00100: two zeros)
  const [mant, exp] = n.toExponential(sig - 1).split('e');
  const e = Number(exp);
  if (e >= 0) return `$${n.toLocaleString('en-US', { maximumFractionDigits: Math.max(2, sig - 1) })}`;
  const zeros = -e - 1;
  const digits = mant.replace('.', '');
  if (zeros >= 2) return `$0.0${sub(zeros)}${digits}`;
  return `$0.${'0'.repeat(zeros)}${digits}`;
}

/** Enough significant digits for ticks `step` apart around `v` to read differently */
export const digitsFor = (v: number, step: number) => Math.min(8, Math.max(3, Math.ceil(Math.log10(Math.abs(v) / step)) + 1));

export const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

// a percent as people type it: a plain number with at most two decimals (the pad counts taxes in 0.01% steps)
const PERCENT = /^\d+(\.\d{0,2})?$/;

/** A typed percent ("2.5") as basis points (250), or NaN if it isn't a plain number with at most two decimals ("0x5", "1e1"
 * and "2.555" aren't: they'd be read, or rounded, into something other than what was typed) */
export function percentBps(input: string): number {
  const s = input.trim();
  if (!PERCENT.test(s)) return NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

// a plain number (1000.5), or one with commas between groups of three digits (1,000.5)
const PLAIN = /^\d+(\.\d{0,18})?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d{0,18})?$/;

/** A typed amount (like "1.5" or "1,000.5") as 18-decimal units, or null if it isn't one (amountProblem says why) */
export function parse(input: string): bigint | null {
  const s = input.trim();
  if (!PLAIN.test(s) && !GROUPED.test(s)) return null;
  try { return parseUnits(s.replace(/,/g, ''), 18); } catch { return null; }
}

/** Why a typed amount can't be read: '' when it can, or when nothing is typed */
export function amountProblem(input: string): string {
  const s = input.trim();
  if (!s || parse(s) !== null) return '';
  if (s.includes(',')) return 'Commas go only between groups of three digits, like 1,000.5 (or leave them out).';
  if (/\.\d{19,}$/.test(s)) return 'At most 18 digits after the point.';
  return 'Type a plain number, like 12.5.';
}

/** A typed amount as it was read, every decimal kept, for buttons like "Buy with 1,000.5 USDC" */
export const exact = (v: bigint) => amount(v, 18);

export function ago(unix?: number): string {
  if (!unix) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const isAddr = (a: string): a is Address => /^0x[0-9a-fA-F]{40}$/.test(a);

// control and format characters (bidi controls, zero-width and other invisible ones), line and paragraph separators,
// every default-ignorable character (the Hangul fillers, the combining grapheme joiner, Khmer's invisible vowels,
// variation selectors and the rest that draw as nothing), and the braille blank and the Khitan filler, which draw as
// blanks: any of them can make two tickers that look alike differ
const INVISIBLE = '\\p{Cf}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}\\u2800\\u{16fe4}';
const HIDDEN = new RegExp(`[\\p{Cc}${INVISIBLE}]`, 'gu');
// the same, but keeping line breaks (for descriptions)
const HIDDEN_INLINE = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f${INVISIBLE}]`, 'gu');

/**
 * A token's name or ticker, which its creator chose, made safe to show: bidi controls and hidden characters removed.
 * Show it inside <bdi> (or use `iso` in plain text), so right-to-left letters in it can't reorder the text around it.
 */
export const tokenText = (s: string) => s.replace(HIDDEN, '').trim();

/** A creator's description made safe to show the same way, keeping its line breaks (show it with dir="auto") */
export const plainText = (s: string) => s.replace(/\r\n?/g, '\n').replace(HIDDEN_INLINE, '').trim();

/**
 * A search taken from the page's address (#/?q=...), as it may be shown back on the page: cleaned like a ticker, and only when
 * it reads as a plain search (letters, digits, spaces, $, - and _, up to 42 characters: enough for an address). Anything else
 * (quotes, punctuation, links, stacked marks) gets null, and the page says "your search": a shared link can't close the
 * page's quote and add a sentence of its own. Show it inside <bdi>.
 */
export function searchTerm(q: string): string | null {
  const s = tokenText(q);
  return /^[\p{L}\p{N} $_-]{1,42}$/u.test(s) ? s : null;
}

/** tokenText isolated for plain strings (labels, messages), the way <bdi> isolates it in the page */
export const iso = (s: string) => `⁨${tokenText(s)}⁩`;

/** A ticker's first `n` characters (whole characters, so an emoji isn't cut in half), for a picture's stand-in */
export const initials = (symbol: string, n: number) => Array.from(tokenText(symbol)).slice(0, n).join('').toUpperCase();

/** A percent change with its sign (+<0.1% for tiny moves, 1.2K% for huge ones); no change has no sign or color */
export function change(p: number): { text: string; cls: '' | 'up' | 'down' } {
  if (!isFinite(p) || p === 0) return { text: '0%', cls: '' };
  const cls = p > 0 ? 'up' : 'down';
  const sign = p > 0 ? '+' : '-';
  const a = Math.abs(p);
  if (a < 0.1) return { text: `${sign}<0.1%`, cls };
  const n = a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return { text: `${sign}${n}%`, cls };
}
