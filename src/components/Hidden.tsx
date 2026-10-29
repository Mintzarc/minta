// Tokens and creators hidden on this device (src/lib/hidden.ts), and the list MINTA's team keeps (public/blocklist.json): the
// lists as hooks, the "Hide this token" and "Hide everything from this creator" buttons, "Show all", and the notice a blocked
// token's page shows.
import { useEffect, useState } from 'react';
import { VYRE_CHAIN } from '../lib/chain';
import { BLOCKLIST_WAIT_MS, MAX_HIDDEN, NO_BLOCKS, hideToken, isHidden, loadHidden, parseBlocklist, showAllTokens, showToken, type Blocklist } from '../lib/hidden';
import { href } from '../lib/router';
import { storeKey } from '../lib/storeKey';

const KEY = storeKey('minta.hidden', VYRE_CHAIN.id);
const KEY_CREATORS = storeKey('minta.hiddenCreators', VYRE_CHAIN.id);
const EVENT = 'minta-hidden-changed';
const store = () => { try { return window.localStorage; } catch { return null; } };
const announce = () => window.dispatchEvent(new Event(EVENT));

function useList(key: string): string[] {
  const [list, setList] = useState<string[]>(() => loadHidden(store(), key));
  useEffect(() => {
    const on = () => setList(loadHidden(store(), key));
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, [key]);
  return list;
}
/** The hidden token addresses, kept current across the page's parts and other tabs */
export const useHidden = () => useList(KEY);
/** The hidden creator addresses */
export const useHiddenCreators = () => useList(KEY_CREATORS);

export const hide = (token: string) => { hideToken(store(), KEY, token); announce(); };
export const hideCreator = (creator: string) => { hideToken(store(), KEY_CREATORS, creator); announce(); };
export const show = (token: string) => { showToken(store(), KEY, token); announce(); };
export const showCreator = (creator: string) => { showToken(store(), KEY_CREATORS, creator); announce(); };
export const showAll = () => { showAllTokens(store(), KEY); showAllTokens(store(), KEY_CREATORS); announce(); };

// MINTA's own list: a file next to the pages, so reading it asks nobody else. Read when the app starts, again when the app comes back to
// the foreground (at most once a minute) and every 30 minutes while it stays open. A first reading that fails (no file, not the right
// shape) shows everything; a later one that fails keeps the last good list.
const BLOCKLIST_EVENT = 'minta-blocklist-changed';
const REFRESH_EVERY_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;
let blocklist: Promise<Blocklist> | null = null;
let loaded: Blocklist | null = null;
let lastRead = 0;
let refreshing = false;
async function readBlocklist(): Promise<Blocklist | null> {
  try {
    const r = await fetch('/blocklist.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const v = await r.json();
    return v && typeof v === 'object' && (v as { version?: unknown }).version === 1 ? parseBlocklist(v) : null;
  } catch { return null; }
}
function loadBlocklist(): Promise<Blocklist> {
  blocklist ??= readBlocklist().then((b) => {
    lastRead = Date.now();
    loaded = b ?? NO_BLOCKS;
    startRefresh();
    return loaded;
  });
  return blocklist;
}
async function refreshBlocklist(force = false) {
  if (refreshing || !loaded || (!force && Date.now() - lastRead < MIN_GAP_MS)) return;
  refreshing = true;
  try {
    const b = await readBlocklist();
    lastRead = Date.now();
    if (b && JSON.stringify(b) !== JSON.stringify(loaded)) { loaded = b; window.dispatchEvent(new Event(BLOCKLIST_EVENT)); }
  } finally { refreshing = false; }
}
let started = false;
function startRefresh() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshBlocklist(); });
  setInterval(() => { if (document.visibilityState === 'visible') void refreshBlocklist(true); }, REFRESH_EVERY_MS);
}
/**
 * The tokens and creators MINTA's team hides, and whether the first reading is over. Until `ready` the lists, token pages and ticker
 * show nothing of the tokens, so a blocked token is never drawn for a moment; `ready` comes when the file has loaded or failed (a
 * failure shows everything) or after 1.5 seconds, so a slow file never blanks the app (a late file is applied when it arrives).
 */
export function useBlocklistState(): { block: Blocklist; ready: boolean } {
  const [s, setS] = useState<{ block: Blocklist; ready: boolean }>(() => (loaded ? { block: loaded, ready: true } : { block: NO_BLOCKS, ready: false }));
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { if (live) setS((p) => (p.ready ? p : { ...p, ready: true })); }, BLOCKLIST_WAIT_MS);
    loadBlocklist().then((b) => { if (live) setS({ block: b, ready: true }); });
    const changed = () => { if (live && loaded) setS({ block: loaded, ready: true }); };
    window.addEventListener(BLOCKLIST_EVENT, changed);
    return () => { live = false; clearTimeout(t); window.removeEventListener(BLOCKLIST_EVENT, changed); };
  }, []);
  return s;
}
/** The tokens and creators MINTA's team hides (nothing until the file is read, or if it can't be) */
export const useBlocklist = (): Blocklist => useBlocklistState().block;

/**
 * The one gate every page that shows a token by its address goes through (token page, manage page, a launch just made): `ready` once the
 * team's list has been read, and `blocked(launch)` for a token or creator on it. Local Hide choices don't block a page: they only
 * thin the lists, and the token page says "Hidden on this device".
 */
export function useTokenGate(): { ready: boolean; blocked: (l: { token: string; creator: string }) => boolean } {
  const { block, ready } = useBlocklistState();
  return { ready, blocked: (l) => isHidden(l, [], [], block) };
}

/** "Hide this token" and "Hide everything from this creator" on a token's page or card; "Show it again" once hidden: only on this device */
export function HideToken({ token, creator, card = false }: { token: string; creator: string; card?: boolean }) {
  const tokenHidden = useHidden().includes(token.toLowerCase());
  const creatorHidden = useHiddenCreators().includes(creator.toLowerCase());
  const cls = card ? 'linkish small hide-card' : 'linkish small hide-token';
  return (
    <div className={card ? 'hide-row' : 'hide-row hide-row-page'}>
      {tokenHidden
        ? <p className="small muted hide-token">Hidden on this device. <button type="button" className="linkish" onClick={() => show(token)}>Show it again</button></p>
        : <button type="button" className={cls} onClick={() => hide(token)}>Hide this token</button>}
      {creatorHidden
        ? <p className="small muted hide-token">Everything from this creator is hidden on this device. <button type="button" className="linkish" onClick={() => showCreator(creator)}>Show it again</button></p>
        : <button type="button" className={cls} onClick={() => hideCreator(creator)}>Hide everything from this creator</button>}
    </div>
  );
}

/** "N tokens hidden on this device. Show all": nothing when none are hidden */
export function HiddenNote() {
  const tokens = useHidden().length, creators = useHiddenCreators().length;
  const n = tokens + creators;
  if (n === 0) return null;
  const full = tokens >= MAX_HIDDEN || creators >= MAX_HIDDEN;
  return <p className="small muted hidden-note">{n} {n === 1 ? 'token or creator is' : 'tokens or creators are'} hidden on this device. <button type="button" className="linkish" onClick={showAll}>Show all</button>{full ? ` The list is full (${MAX_HIDDEN}): hiding more drops the oldest.` : ''}</p>;
}

/** What a token's page shows instead of the token when MINTA's team hides it */
export function BlockedToken() {
  return (
    <div className="empty" role="status">
      <p><b>MINTA hides this token because it was reported.</b></p>
      <p className="muted small">Its record on the blockchain stays; MINTA just doesn’t show it.</p>
      <p><a className="btn btn-line btn-sm" href={href({ page: 'explore' })}>Back to all tokens</a></p>
    </div>
  );
}
