// A line across the very top of MINTA that moves: the latest buys and sales, new launches and a few totals, each a link to
// its token (the same tokens are all on the launchpad, so the links aren't tab stops: the Pause button is). It scrolls on its own,
// stops while the pointer is on it, has a Pause button, and doesn't move at all for anyone who asks their device for less motion
// (they get the same items in a line they can scroll). Real trades only (see
// lib/feed.ts); on a failure or with nothing to show it says what MINTA is rather than showing nothing.
import { useEffect, useRef, useState } from 'react';
import { feedItems, loadFeed, type FeedItem, type FeedState } from '../lib/feed';
import { ago, tokenText, usd } from '../lib/format';
import { href } from '../lib/router';

const POLL_MS = 20_000;
const SECONDS_PER_ITEM = 5;

function Item({ it }: { it: FeedItem }) {
  const tab = -1;
  if (it.kind === 'stat') return <span className="tk-item tk-stat"><span className="muted">{it.label}</span> <b>{it.value}</b></span>;
  const link = href({ page: 'token', token: it.token });
  if (it.kind === 'launch') {
    return (
      <a className="tk-item tk-launch" href={link} tabIndex={tab}>
        <span className="tk-tag">New</span> <b>$<bdi>{tokenText(it.symbol)}</bdi></b> <span className="muted">launched{it.time ? ` · ${ago(it.time)}` : ''}</span>
      </a>
    );
  }
  return (
    <a className={`tk-item tk-${it.side}`} href={link} tabIndex={tab}>
      <span className="tk-dot" aria-hidden="true" /> <span>{it.side === 'buy' ? 'Bought' : 'Sold'}</span> <b>{usd(it.usdc)}</b> <span>of</span> <b>$<bdi>{tokenText(it.symbol)}</bdi></b>
      {it.time ? <span className="muted"> · {ago(it.time)}</span> : null}
    </a>
  );
}

export default function Ticker() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const state = useRef<FeedState | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let busy = false; // (this run's own: a restarted effect never inherits another run's)
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    const tick = async () => {
      if (!live) return;
      if (busy || document.visibilityState === 'hidden') { timer = setTimeout(tick, POLL_MS); return; }
      busy = true;
      try {
        state.current = await loadFeed(state.current);
        const next = await feedItems(state.current);
        fails = 0;
        if (live) setItems(next);
      } catch {
        fails++; // the bar keeps what it has; it asks again, less often each time it fails
      } finally {
        busy = false;
        if (live) timer = setTimeout(tick, Math.min(POLL_MS * 2 ** fails, 300_000));
      }
    };
    void tick();
    const vis = () => { if (document.visibilityState === 'visible' && !busy) { clearTimeout(timer); void tick(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);

  const dur = Math.max(30, items.length * SECONDS_PER_ITEM);
  return (
    <div className={`ticker${paused ? ' paused' : ''}`} role="region" aria-label="Latest activity on MINTA">
      <span className="tk-live" title="Real trades on the VYRE testnet, made with test USDC"><span className="tk-pulse" aria-hidden="true" />Live<span className="tk-testnet"> · testnet</span></span>
      <div className="tk-view">
        {items.length === 0 ? (
          <p className="tk-empty muted">Buys, sales and new launches show here as they happen. Test USDC, no real money.</p>
        ) : (
          <div className="tk-track" style={{ ['--tk-dur' as string]: `${dur}s` }}>
            <div className="tk-run">{items.map((it) => <Item key={it.id} it={it} />)}</div>
            <div className="tk-run" aria-hidden="true">{items.map((it) => <Item key={`c-${it.id}`} it={it} />)}</div>
          </div>
        )}
      </div>
      {items.length > 0 && (
        <button type="button" className="tk-pause" onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label="Pause the moving line">
          {paused
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>}
        </button>
      )}
    </div>
  );
}
