// The top of the home page: the four launches with the most USDC in their pools (a market cap alone is a number its creator picked at
// launch), each with its market cap, 24-hour change and liquidity.
import { change, tokenText, usd } from '../lib/format';
import type { Listed } from '../lib/market';
import { href } from '../lib/router';
import type { Stats } from '../lib/stats';
import { TokenPic } from './ui';

type Status = 'loading' | 'ok' | 'error';
const pending = (status: Status) => (status === 'error' ? 'The figures couldn’t load just now: retrying.' : 'Loading…');

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
