// The top of the home page: King of the Hill (the launch that most recently reached the milestone) with its price,
// volume, holders and recent price; the contenders, the four launches closest to it; and the top four by USDC in
// their pools.
import { change, iso, price, tokenText, usd, usdOf } from '../lib/format';
import type { Listed } from '../lib/market';
import { href } from '../lib/router';
import { MILESTONE_TEXT, type Stats } from '../lib/stats';
import { TokenPic } from './ui';

const Crown = () => (
  <svg className="ic crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M4 16 3 7l5 4 4-6 4 6 5-4-1 9z" /></svg>
);

/** A small area chart of recent prices, stretched to its box: three recessive gridlines, the line and a faint wash */
function RecentChart({ points, label }: { points: number[]; label: string }) {
  const W = 600, H = 140;
  if (points.length < 2) return <div className="recent-empty muted small">No trades yet.</div>;
  let lo = Math.min(...points), hi = Math.max(...points);
  if (hi - lo <= hi * 1e-9) { lo = hi * 0.9; hi *= 1.1; }
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (p: number) => 10 + (1 - (p - lo) / (hi - lo)) * (H - 20);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg className="recent" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {[0.25, 0.55, 0.9].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="grid" vectorEffect="non-scaling-stroke" />)}
      <path d={`${d} L${W},${H} L0,${H} Z`} className="area" />
      <path d={d} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Status = 'loading' | 'ok' | 'error';
const pending = (status: Status) => (status === 'error' ? 'The figures couldn’t load just now: retrying.' : 'Loading…');

export function KingCard({ king, stats, holders, status }: { king: Listed | null; stats: Map<string, Stats>; holders: Map<string, number | null>; status: Status }) {
  const ks = king ? stats.get(king.pool) : undefined;
  const kch = ks?.change24 != null ? change(ks.change24) : null;
  const h = king ? holders.get(king.token) : null;
  return (
    <section className="koth" aria-labelledby="koth-title">
      <div className="koth-head">
        <h2 id="koth-title" className="koth-title"><Crown />King of the Hill</h2>
        <span className="muted small">Most recent to {MILESTONE_TEXT}</span>
      </div>
      {king ? (
        <a className="koth-king" href={href({ page: 'token', token: king.token })}>
          <div className="koth-id">
            <TokenPic uri={king.metadataURI} symbol={king.symbol} token={king.token} size={60} />
            <div className="grow"><p className="koth-sym">$<bdi>{tokenText(king.symbol)}</bdi></p><p className="muted"><bdi>{tokenText(king.name)}</bdi></p></div>
            <div className="right">
              <p className="koth-cap">{king.market ? usd(king.market.marketCap) : '—'}</p>
              {kch && <p><span className={kch.cls}>{kch.text}</span> <span className="muted">24h</span></p>}
            </div>
          </div>
          <p className="muted koth-label">Recent price</p>
          {ks && <RecentChart points={ks.trend} label={`${iso(king.symbol)}'s recent price, from ${price(ks.trend[0])} to ${price(ks.trend[ks.trend.length - 1])}`} />}
          <dl className="koth-stats">
            <div><dt>Price</dt><dd>{king.market ? price(king.market.price) : '—'}</dd></div>
            <div><dt>24h volume</dt><dd>{ks?.volume24 != null ? usdOf(ks.volume24) : '—'}</dd></div>
            <div><dt>Holders</dt><dd>{h == null ? '—' : h.toLocaleString('en-US')}</dd></div>
          </dl>
        </a>
      ) : status !== 'ok' ? (
        <p className="koth-empty">{pending(status)}</p>
      ) : (
        <p className="koth-empty">No king right now. The next token to reach {MILESTONE_TEXT} of USDC bought in takes the hill.</p>
      )}
    </section>
  );
}

export function Contenders({ rows, stats, status }: { rows: Listed[]; stats: Map<string, Stats>; status: Status }) {
  return (
    <section className="contenders-box" aria-labelledby="contenders-title">
      <div className="koth-head">
        <h2 id="contenders-title" className="h3">Contenders</h2>
        <span className="muted small">Closest to {MILESTONE_TEXT}</span>
      </div>
      {rows.length === 0 && <p className="muted small contenders-none">{status === 'ok' ? 'None yet.' : pending(status)}</p>}
      <ol className="contenders">
        {rows.map((c, i) => {
          const s = stats.get(c.pool);
          const ch = s?.change24 != null ? change(s.change24) : null;
          return (
            <li key={c.token}>
              <a href={href({ page: 'token', token: c.token })}>
                <span className="rank">{i + 1}</span>
                <TokenPic uri={c.metadataURI} symbol={c.symbol} token={c.token} size={46} />
                <span className="grow sym"><bdi>{tokenText(c.symbol)}</bdi></span>
                <span className="right">
                  <span className="block">{c.market ? usd(c.market.marketCap) : '—'} <span className="muted small">mcap</span></span>
                  {ch && <span className="block"><span className={ch.cls}>{ch.text}</span> <span className="muted small">24h</span></span>}
                </span>
                <span className="muted go" aria-hidden="true">↗</span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The four launches with the most USDC in their pools (a market cap alone is a number its creator picked at launch) */
export function TopByLiquidity({ rows, stats, status }: { rows: Listed[]; stats: Map<string, Stats>; status: Status }) {
  return (
    <section className="topcap" aria-labelledby="topcap-title">
      <h2 id="topcap-title" className="eyebrow">Top by liquidity</h2>
      {rows.length === 0 && <p className="muted small">{status === 'ok' ? 'No launches yet.' : pending(status)}</p>}
      <ul>
        {rows.map((t) => {
          const s = stats.get(t.pool);
          const ch = s?.change24 != null ? change(s.change24) : null;
          return (
            <li key={t.token}>
              <a href={href({ page: 'token', token: t.token })}>
                <TokenPic uri={t.metadataURI} symbol={t.symbol} token={t.token} size={50} />
                <span className="grow"><b className="block topcap-sym">$<bdi>{tokenText(t.symbol)}</bdi></b><span className="muted">{t.market ? usd(t.market.marketCap) : '—'}</span></span>
                <span className="right">
                  <span className={`block ${ch?.cls ?? ''}`}>{ch ? ch.text : '—'}</span>
                  <span className="muted small">{s ? usd(s.raised) : '—'} liq</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
