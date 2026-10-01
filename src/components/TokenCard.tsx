// A launch as a card: its picture square on top with its 24-hour change and its milestone progress (or a Graduated
// badge) over it, then its ticker, name and market cap, and its creator and age.
import { useState } from 'react';
import { ago, change, tokenText, usd } from '../lib/format';
import type { Listed } from '../lib/market';
import { href } from '../lib/router';
import type { Stats } from '../lib/stats';
import { useMeta } from './ui';
import Avatar from './Avatar';
import TokenArt from './TokenArt';

/** The launch's picture filling a square, or art drawn from its address when it has none (never a bare ticker tile) */
export function TokenImage({ uri, symbol, token, className = '' }: { uri?: string; symbol: string; token?: string; className?: string }) {
  const m = useMeta(uri);
  const [broken, setBroken] = useState(false);
  if (m?.image && !broken) return <img className={`tok-img ${className}`} src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  return <TokenArt className={`tok-img ${className}`} seed={token || symbol} />;
}

const Medal = () => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5" /><path d="m9 13.5-1.5 7L12 18l4.5 2.5-1.5-7" /></svg>
);

export default function TokenCard({ l, s }: { l: Listed; s?: Stats }) {
  const ch = s?.change24 != null ? change(s.change24) : null;
  return (
    <a className="tcard" href={href({ page: 'token', token: l.token })}>
      <div className="tcard-pic">
        <TokenImage uri={l.metadataURI} symbol={l.symbol} token={l.token} />
        {s?.graduated && <span className="pill pill-tl" title="Graduated: at or above the milestone now"><Medal /><span className="sr">Graduated</span></span>}
        {ch && <span className={`pill pill-tr ${ch.cls}`}>{ch.text}{!s?.graduated && <span className="muted"> 24h</span>}</span>}
        {s && <span className="pill pill-bl">{s.graduated ? 'Milestone reached' : `${Math.min(99.9, s.progress * 100).toFixed(1)}% of milestone`}</span>}
      </div>
      <div className="tcard-body">
        <p className="tcard-sym">$<bdi>{tokenText(l.symbol)}</bdi></p>
        <p className="tcard-row"><bdi className="muted tcard-name">{tokenText(l.name)}</bdi><b>{l.market ? usd(l.market.marketCap) : '—'}</b></p>
        <p className="tcard-row muted small">
          <span className="tcard-by"><Avatar address={l.creator} size={24} /><span aria-hidden="true">·</span><time className="dotted" dateTime={new Date(l.createdAt * 1000).toISOString()} title={new Date(l.createdAt * 1000).toLocaleString()}>{ago(l.createdAt)}</time></span>
          <span className="quote-coin" title="Trades against USDC" aria-label="USDC pair"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.3 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6.2v1.6m0 8.4v1.6" /></svg></span>
        </p>
      </div>
    </a>
  );
}
