// A launch's price over time, from its pool's swaps: one line (the brand cyan) with a faint wash under it, an end dot
// at the latest price, clean ticks, and a crosshair that snaps to the nearest trade and shows its price and time.
// Every value here is also in the Latest trades table below the chart.
import { useMemo, useRef, useState } from 'react';
import { ago, change as fmtChange, digitsFor, price as fmtPrice } from '../lib/format';
import type { Trade } from '../lib/market';

const W = 640, H = 220, PAD = { l: 8, r: 104, t: 14, b: 26 };
const RANGES = [
  { key: '1h', label: '1H', secs: 3600 },
  { key: '24h', label: '24H', secs: 86400 },
  { key: '7d', label: '7D', secs: 7 * 86400 },
  { key: 'all', label: 'All', secs: Infinity },
] as const;

interface Pt { t: number; p: number; isBuy?: boolean; start?: boolean }

// "nice" ticks: 1, 2 or 5 times a power of ten, 3-5 of them across the range. Never more than a few: prices a float
// step or two apart would otherwise give a step too small to move the loop forward (a frozen page)
function ticks(min: number, max: number): number[] {
  if (!(max > min) || (max - min) / Math.max(Math.abs(max), Math.abs(min)) < 1e-9) return [min];
  const raw = (max - min) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => (max - min) / s <= 5) || raw;
  if (!(step > 0) || !isFinite(step)) return [min];
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9 && out.length < 8; v += step) out.push(v);
  return out;
}

export default function PriceChart({ trades, current, failed = false }: { trades: Trade[] | null; current: number; failed?: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('all');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pts = useMemo<Pt[]>(() => {
    if (!trades) return [];
    const now = Math.floor(Date.now() / 1000);
    const all = trades.filter((t) => t.time && t.price > 0).map((t) => ({ t: t.time!, p: t.price, isBuy: t.isBuy })).sort((a, b) => a.t - b.t);
    const secs = RANGES.find((r) => r.key === range)!.secs;
    const from = secs === Infinity ? (all[0]?.t ?? now) : now - secs;
    const inRange = all.filter((x) => x.t >= from);
    const before = all.filter((x) => x.t < from).pop();
    // the price going into the window, then every trade in it, then now at the pool's current price
    const out: Pt[] = [];
    if (before) out.push({ t: from, p: before.p, start: true });
    out.push(...inRange);
    if (current > 0) out.push({ t: now, p: current });
    return out;
  }, [trades, range, current]);

  const view = useMemo(() => {
    if (pts.length < 2) return null;
    const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
    let lo = Math.min(...pts.map((x) => x.p)), hi = Math.max(...pts.map((x) => x.p));
    // a range too narrow to draw (or equal prices): widen it around the price
    if (hi - lo <= hi * 1e-9) { lo = hi * 0.9; hi *= 1.1; }
    const padP = (hi - lo) * 0.12; lo = Math.max(0, lo - padP); hi += padP;
    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (p: number) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    // a step line: a price holds until the next trade moves it
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].p).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].p).toFixed(1)}`;
    const area = `${d} V${H - PAD.b} H${x(pts[0].t).toFixed(1)} Z`;
    const tk = ticks(lo, hi).filter((v) => v >= lo && v <= hi);
    const step = tk.length > 1 ? tk[1] - tk[0] : hi - lo;
    return { x, y, d, area, ticks: tk, sig: digitsFor(hi, step), t0, t1 };
  }, [pts]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!view || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, dist = Infinity;
    pts.forEach((pt, i) => { const dd = Math.abs(view.x(pt.t) - px); if (dd < dist) { dist = dd; best = i; } });
    setHover(best);
  };

  const h = hover !== null ? pts[hover] : null;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const moved = fmtChange(first && last && first.p > 0 ? (last.p / first.p - 1) * 100 : 0);
  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <p className="muted small">Price (USDC per token)</p>
          <p className="chart-value">{fmtPrice(h ? h.p : current, 4)}{' '}
            {!h && pts.length > 1 && <span className={`small ${moved.cls}`}>{moved.text}</span>}
            {h && <span className="muted small">{h.start ? 'at the start of this range' : h.isBuy === undefined ? 'now' : `${h.isBuy ? 'buy' : 'sell'} · ${ago(h.t)}`}</span>}
          </p>
        </div>
        <div className="chips" role="group" aria-label="Time range">
          {RANGES.map((r) => <button key={r.key} type="button" className={`chip ${range === r.key ? 'on' : ''}`} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>)}
        </div>
      </div>
      {!trades && <div className="chart-empty muted small">Loading trades…</div>}
      {trades && !view && <div className="chart-empty muted small">{failed ? 'Couldn’t load the trades just now: retrying.' : 'No trades in this range yet.'}</div>}
      {view && (
        <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Price from ${fmtPrice(first.p)} to ${fmtPrice(last.p)} over ${pts.length} points; every trade is in the table below`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {view.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={view.y(v)} y2={view.y(v)} className="grid" />
              <text x={W - PAD.r + 8} y={view.y(v) + 4} className="tick">{fmtPrice(v, view.sig)}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 8} className="tick">{new Date(view.t0 * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</text>
          <text x={W - PAD.r} y={H - 8} className="tick" textAnchor="end">now</text>
          <path d={view.area} className="area" />
          <path d={view.d} className="line" />
          <circle cx={view.x(last.t)} cy={view.y(last.p)} r={4} className="end" />
          {h && (
            <g>
              <line x1={view.x(h.t)} x2={view.x(h.t)} y1={PAD.t} y2={H - PAD.b} className="cross" />
              <circle cx={view.x(h.t)} cy={view.y(h.p)} r={4} className="end" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
