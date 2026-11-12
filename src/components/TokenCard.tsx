// A launch as a card: its picture square on top with its 24-hour change (a plain number) and how much USDC has been
// bought in over it, then its ticker, name and market cap, and its creator and age.
import { useState } from 'react';
import { ago, change, tickerText, tokenText, usd } from '../lib/format';
import { NotThat } from './ui';
import type { Listed } from '../lib/market';
import { href } from '../lib/router';
import { MILESTONE_TEXT, type Stats } from '../lib/stats';
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

export default function TokenCard({ l, s }: { l: Listed; s?: Stats }) {
  const ch = s?.change24 != null ? change(s.change24) : null;
  return (
    <a className="tcard" href={href({ page: 'token', token: l.token })}>
      <div className="tcard-pic">
        <TokenImage uri={l.metadataURI} symbol={l.symbol} token={l.token} />
        {ch && <span className="pill pill-tr">{ch.text}<span className="muted"> 24h</span></span>}
        {s && <span className="pill pill-bl">{s.graduated ? `At least ${MILESTONE_TEXT} bought in` : `${usd(s.raised)} of ${MILESTONE_TEXT} bought in`}</span>}
      </div>
      <div className="tcard-body">
        <p className="tcard-sym">$<bdi>{tickerText(l.symbol, l.token)}</bdi> <NotThat l={l} /></p>
        <p className="tcard-row"><bdi className="muted tcard-name">{tokenText(l.name)}</bdi><b>{l.market ? usd(l.market.marketCap) : '—'}</b></p>
        <p className="tcard-row muted small">
          <span className="tcard-by"><Avatar address={l.creator} size={24} /><span aria-hidden="true">·</span><time className="dotted" dateTime={new Date(l.createdAt * 1000).toISOString()} title={new Date(l.createdAt * 1000).toLocaleString()}>{ago(l.createdAt)}</time></span>
          <span className="quote-coin" title="Trades against USDC" aria-label="USDC pair"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.3 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6.2v1.6m0 8.4v1.6" /></svg></span>
        </p>
      </div>
    </a>
  );
}
