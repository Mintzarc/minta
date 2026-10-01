// Token search: a panel that opens from the search bar or with ⌘K / Ctrl K. It matches a name, a ticker (with or
// without its $) or a full address, shows up to eight matches (arrow keys to move, Enter to open, Escape to close), and
// "View all matches" applies the search to the token list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAddress } from 'viem';
import { isAddr, price, tokenText } from '../lib/format';
import { cacheAge, cachedLaunches, listLaunches, type Listed } from '../lib/market';
import { href } from '../lib/router';
import { TokenPic } from './ui';

export function matches(l: Listed, q: string): boolean {
  const s = tokenText(q).toLowerCase().replace(/^\$/, '');
  if (!s) return true;
  if (isAddr(s)) return l.token.toLowerCase() === s;
  return tokenText(l.symbol).toLowerCase().includes(s) || tokenText(l.name).toLowerCase().includes(s);
}

/** Opens the panel on ⌘K / Ctrl K (and "/" outside a text field) */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); open(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open]);
}

export const shortcutLabel = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K');

export function SearchPanel({ list: given, initial = '', onClose, onViewAll }: {
  list?: Listed[] | null; initial?: string; onClose: () => void; onViewAll?: (q: string) => void;
}) {
  const [q, setQ] = useState(initial);
  // opened from the header, away from the token list: read the newest launches itself
  const [own, setOwn] = useState<Listed[] | null>(cachedLaunches);
  // the launches read so far show at once; unless the newest were read in the last 30 s, they're read again meanwhile
  // (the cache merges them in, newest first)
  useEffect(() => {
    if (given || cacheAge() < 30_000) return;
    let live = true;
    listLaunches(60).then(() => { if (live) setOwn(cachedLaunches()); }).catch(() => { if (live) setOwn((o) => o ?? []); });
    return () => { live = false; };
  }, [given]);
  const list = given ?? own ?? [];
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<Element | null>(null);

  useEffect(() => {
    back.current = document.activeElement;
    input.current?.focus();
    input.current?.select();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; (back.current as HTMLElement | null)?.focus?.(); };
  }, []);

  const found = useMemo(() => list.filter((l) => matches(l, q)), [list, q]);
  const shown = found.slice(0, 8);
  const s = q.trim().replace(/^\$/, '');
  // a full address that isn't among the loaded launches: offer to open it anyway (its page says if it isn't one)
  const direct = isAddr(s) && !found.length ? getAddress(s) : null;
  const count = shown.length + (direct ? 1 : 0) + (q.trim() && found.length ? 1 : 0);
  useEffect(() => setActive(0), [q]);

  const open = (i: number) => {
    if (i < shown.length) { window.location.hash = href({ page: 'token', token: shown[i].token }); onClose(); return; }
    if (direct && i === shown.length) { window.location.hash = href({ page: 'token', token: direct }); onClose(); return; }
    if (onViewAll) onViewAll(q.trim()); else window.location.hash = href({ page: 'explore', q: q.trim() });
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (count ? (a + 1) % count : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (count ? (a - 1 + count) % count : 0)); }
    else if (e.key === 'Enter' && count) { e.preventDefault(); open(active); }
    // still loading: show the matches on the token list instead
    else if (e.key === 'Enter' && q.trim() && !given && !own) { e.preventDefault(); open(shown.length + (direct ? 1 : 0)); }
  };
  const opt = (i: number) => `search-opt-${i}`;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search tokens" onKeyDown={onKey}>
        <div className="search-field">
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ticker or address"
            role="combobox" aria-expanded="true" aria-controls="search-list" aria-autocomplete="list"
            aria-activedescendant={count ? opt(active) : undefined} autoComplete="off" spellCheck={false} />
          <kbd>Esc</kbd>
        </div>
        <ul id="search-list" role="listbox" aria-label="Matches" className="search-list">
          {shown.map((l, i) => (
            <li key={l.token} id={opt(i)} role="option" aria-selected={active === i} className={active === i ? 'on' : ''}
              onMouseEnter={() => setActive(i)} onClick={() => open(i)}>
              <TokenPic uri={l.metadataURI} symbol={l.symbol} token={l.token} size={32} />
              <span className="grow"><b>$<bdi>{tokenText(l.symbol)}</bdi></b> <bdi className="muted">{tokenText(l.name)}</bdi></span>
              <span className="muted small">{l.market ? price(l.market.price) : ''}</span>
            </li>
          ))}
          {direct && (
            <li id={opt(shown.length)} role="option" aria-selected={active === shown.length} className={active === shown.length ? 'on' : ''}
              onMouseEnter={() => setActive(shown.length)} onClick={() => open(shown.length)}>
              <span className="grow">Open <span className="mono">{direct}</span></span>
            </li>
          )}
          {q.trim() && found.length > 0 && (
            <li id={opt(count - 1)} role="option" aria-selected={active === count - 1} className={`view-all ${active === count - 1 ? 'on' : ''}`}
              onMouseEnter={() => setActive(count - 1)} onClick={() => open(count - 1)}>
              View all matches ({found.length})
            </li>
          )}
          {!given && !own && <li className="none muted">Loading tokens…</li>}
          {q.trim() && (given || own) && !found.length && !direct && <li className="none muted">No token matches that. Check the spelling, or paste the full address.</li>}
        </ul>
        <p className="search-hint muted small">↑ ↓ to move · Enter to open · Esc to close. Names can look alike: the address is what identifies a token.</p>
      </div>
    </div>
  );
}
