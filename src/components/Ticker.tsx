// A line across the very top of MINTA that moves: the latest buys and sales, new launches and a few totals, each a link to
// its token (the same tokens are all on the launchpad, so the links aren't tab stops: the Pause button is). It scrolls on its own,
// stops while the pointer is on it, has a Pause button, and doesn't move at all for anyone who asks their device for less motion
// (they get the same items in a line they can scroll). Real trades only (see
// lib/feed.ts); on a failure or with nothing to show it says what MINTA is rather than showing nothing.
import { useEffect, useRef, useState } from 'react';
import { feedItems, loadFeed, type FeedItem, type FeedState } from '../lib/feed';
import { ago, tokenText, usd } from '../lib/format';
import { href } from '../lib/router';
import { NETWORK } from '../lib/network';
import type { Address } from 'viem';
import { cachedLaunches } from '../lib/market';
import { getLaunch } from '../lib/pad';
import { vyre } from '../lib/chain';
import { hidesByCreator, visibleFeed } from '../lib/hidden';
import { useBlocklistState, useHidden, useHiddenCreators } from './Hidden';

/** token (lowercase) -> creator (lowercase), for the tokens the line shows: from the launches already read, else looked up */
const creators = new Map<string, string>();
function creatorKnown(token: string): string | undefined {
  const t = token.toLowerCase();
  return creators.get(t) ?? cachedLaunches()?.find((l) => l.token.toLowerCase() === t)?.creator.toLowerCase();
}

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
  const [all, setItems] = useState<FeedItem[]>([]);
  const hiddenTokens = useHidden();
  const hiddenCreators = useHiddenCreators();
  const { block, ready } = useBlocklistState();
  // A token's creator is needed only when a creator is hidden or blocked. Each token in the line is then looked up (once, kept), and
  // an item whose creator isn't known yet is held back: it appears when its creator is known and allowed (fail closed).
  const byCreator = hidesByCreator(hiddenCreators, block);
  const [, setSeen] = useState(0);
  useEffect(() => {
    if (!byCreator) return;
    let live = true;
    const todo = [...new Set(all.filter((i) => 'token' in i).map((i) => (i as { token: string }).token.toLowerCase()))].filter((t) => !creatorKnown(t));
    (async () => {
      for (let i = 0; i < todo.length && live; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async (t) => {
          try { const l = await getLaunch(vyre, t as Address); if (l) creators.set(t, l.creator.toLowerCase()); } catch { /* stays held back; asked again when the line changes */ }
        }));
        if (live) setSeen((n) => n + 1);
      }
    })();
    return () => { live = false; };
  }, [all, byCreator]);
  // nothing is drawn until the team's list has been read (at most 1.5 s)
  const items = ready ? visibleFeed(all, creatorKnown, hiddenTokens, hiddenCreators, block) : [];
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
      <span className="tk-live" title={NETWORK.testnet ? 'Real trades on the VYRE testnet, made with test USDC' : 'Trades on VYRE Mainnet, made with USDC'}><span className="tk-pulse" aria-hidden="true" />Live<span className="tk-testnet"> · {NETWORK.testnet ? 'testnet' : 'mainnet'}</span></span>
      <div className="tk-view">
        {items.length === 0 ? (
          <p className="tk-empty muted">Buys, sales and new launches show here as they happen.{NETWORK.testnet ? ' Test USDC, no real money.' : ''}</p>
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
