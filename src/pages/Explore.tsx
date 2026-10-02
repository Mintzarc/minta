// The home page: King of the Hill (the launch most recently to the milestone) with its contenders, the top launches
// by liquidity, then every launch under Trending, New (not yet at the milestone) or Graduated, sorted by last trade,
// market cap, creation or the day's volume, as cards or a table. A search from the header can narrow it (?q=).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { getLaunchCount } from '@vyrechain/sdk';
import { oneAtATime, vyre } from '../lib/chain';
import { ago, change, price, searchTerm, tokenText, usd, usdOf } from '../lib/format';
import { listLaunches, marketOf, type Listed } from '../lib/market';
import { loadHolders, loadStats, MILESTONE_TEXT, type Stats } from '../lib/stats';
import { href } from '../lib/router';
import { Loading, TokenPic } from '../components/ui';
import Spark from '../components/Spark';
import TokenCard from '../components/TokenCard';
import { Contenders, KingCard, TopByLiquidity } from '../components/KingOfTheHill';
import { matches } from '../components/Search';

const PAGE = 36;
const TABS = [
  { key: 'trending', label: 'Trending', icon: <path d="M13 3 5 14h6l-1 7 8-11h-6z" /> },
  { key: 'new', label: 'New', icon: <path d="M12 20v-8m0 0c0-4 3-6 8-6 0 4-3 6-8 6Zm0 0C12 8 9.5 6.5 4 6.5c0 3.5 2.5 5.5 8 5.5Z" /> },
  { key: 'graduated', label: 'Graduated', icon: <><circle cx="12" cy="9" r="5" /><path d="m9 13.5-1.5 7L12 18l4.5 2.5-1.5-7" /></> },
] as const;
const SORTS = [
  { key: 'last', label: 'Last trade' },
  { key: 'cap', label: 'Market cap' },
  { key: 'created', label: 'Created' },
  { key: 'volume', label: '24h volume' },
] as const;
type Tab = (typeof TABS)[number]['key'];
type Sort = (typeof SORTS)[number]['key'];

const VIEW = 'vyre.view';
const savedView = (): 'grid' | 'list' => { try { return localStorage.getItem(VIEW) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };

export default function Explore({ q = '' }: { q?: string }) {
  // the search as it may be shown back (a link chooses it: only a plain search is echoed)
  const term = searchTerm(q);
  const [list, setList] = useState<Listed[] | null>(null);
  const [stats, setStats] = useState<Map<Address, Stats>>(new Map());
  const [holders, setHolders] = useState<Map<Address, number | null>>(new Map());
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('new');
  const [sort, setSort] = useState<Sort>('last');
  const [view, setView] = useState<'grid' | 'list'>(savedView);
  const [more, setMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  // the figures' state: loading, loaded, or failed (then the last good ones stay, marked as not current)
  const [statsState, setStatsState] = useState<'loading' | 'ok' | 'error'>('loading');
  const listRef = useRef<Listed[] | null>(null);
  const busy = useRef(false);

  // the day's figures and the holder counts, each one load at a time for the list as it is when the load starts: a
  // tick while one is still running is skipped (so a slow load still lands), and "Older tokens" queues one more after it
  const [loadFigures, loadHolderCounts] = useMemo(() => [
    oneAtATime(async () => {
      if (!listRef.current) return;
      try {
        setStats(await loadStats(listRef.current));
        setStatsState('ok');
      } catch {
        setStatsState('error');
      }
    }),
    oneAtATime(async () => { if (listRef.current) setHolders(await loadHolders(listRef.current)); }),
  ], []);
  const enrich = (queue = false) => { loadFigures(queue); loadHolderCounts(queue); };

  const load = async () => {
    // one load at a time (the public RPC takes one request at a time from each visitor), and none while hidden
    if (busy.current || document.visibilityState === 'hidden') return;
    busy.current = true;
    setErr('');
    try {
      const [n, l] = await Promise.all([getLaunchCount(vyre), listLaunches(PAGE)]);
      setTotal(n);
      // keep older pages the visitor loaded, with their prices refreshed
      const fresh = new Set(l.map((x) => x.token));
      const old = (listRef.current || []).filter((o) => !fresh.has(o.token));
      const prices = new Map(await Promise.all(old.map(async (o) => [o.token, await marketOf(o).catch(() => o.market)] as const)));
      // into the list as it is now: "Older tokens" may have added a page while the prices were read
      const kept = (listRef.current || []).filter((o) => !fresh.has(o.token)).map((o) => (prices.has(o.token) ? { ...o, market: prices.get(o.token) } : o));
      const merged = [...l, ...kept];
      listRef.current = merged;
      setList(merged);
      enrich();
    } catch (e) {
      setErr(listRef.current ? 'Couldn’t refresh the launches just now: showing the last ones read.' : (e as Error).message || 'Couldn’t read the launches.');
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, []);
  const pickView = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem(VIEW, v); } catch { /* private mode */ } };

  const loadMore = async () => {
    const from = listRef.current;
    if (!from?.length) return;
    setMore(true);
    try {
      const older = await listLaunches(PAGE, from[from.length - 1].index - 1);
      // onto the list as it is now (a refresh may have landed meanwhile), each launch once
      const now = listRef.current || [];
      const have = new Set(now.map((x) => x.token));
      const merged = [...now, ...older.filter((x) => !have.has(x.token))];
      listRef.current = merged;
      setList(merged);
      enrich(true);
      setMoreErr(false);
    } catch {
      setMoreErr(true);
    } finally { setMore(false); }
  };

  const st = (l: Listed) => stats.get(l.pool);
  const cap = (l: Listed) => l.market?.marketCap ?? 0;
  const top = useMemo(() => {
    if (!list) return { king: null, contenders: [], byLiquidity: [] };
    const grads = list.filter((l) => st(l)?.graduated);
    const king = grads.sort((a, b) => Number((st(b)!.reachedBlock ?? 0n) - (st(a)!.reachedBlock ?? 0n)))[0] ?? null;
    const contenders = list.filter((l) => st(l) && !st(l)!.graduated).sort((a, b) => st(b)!.progress - st(a)!.progress).slice(0, 4);
    // by the USDC in each pool: a market cap alone is a number its creator picked at launch
    const byLiquidity = list.filter((l) => st(l)).sort((a, b) => st(b)!.raised - st(a)!.raised).slice(0, 4);
    return { king, contenders, byLiquidity };
  }, [list, stats]);

  const rows = useMemo(() => {
    if (!list) return null;
    let r = list.filter((l) => matches(l, q));
    // (until the figures load, nothing is known to be graduated)
    if (tab === 'new') r = r.filter((l) => !st(l)?.graduated);
    if (tab === 'graduated') r = r.filter((l) => st(l)?.graduated);
    const by = tab === 'trending' ? 'volume' : sort;
    const last = (l: Listed) => st(l)?.lastTradeBlock ?? 0n;
    const vol = (l: Listed) => st(l)?.volume24 ?? 0n;
    const cmp = (x: bigint, y: bigint) => (x > y ? 1 : x < y ? -1 : 0);
    return [...r].sort((a, b) =>
      by === 'cap' ? cap(b) - cap(a)
        : by === 'created' ? b.index - a.index
          : by === 'volume' ? cmp(vol(b), vol(a)) || cmp(last(b), last(a))
            : cmp(last(b), last(a)) || b.index - a.index);
  }, [list, stats, q, tab, sort]);

  return (
    <section className="home">
      <h1 className="sr">Tokens on VYRE</h1>
      {err && <p className="err">{err} <button className="linkish" type="button" onClick={load}>Try again</button></p>}
      {!list && !err && <Loading what="Reading the launchpad" />}
      {list && (
        <div className="home-top">
          <div className="home-left">
            <KingCard king={top.king} stats={stats} holders={holders} status={statsState} />
            <Contenders rows={top.contenders} stats={stats} status={statsState} />
          </div>
          <TopByLiquidity rows={top.byLiquidity} stats={stats} status={statsState} />
        </div>
      )}

      {list && (
        <>
          <div className="feed-tabs" role="group" aria-label="Show">
            {TABS.map((t) => (
              <button key={t.key} type="button" className={`${t.key} ${tab === t.key ? 'on' : ''}`} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>{t.label}
              </button>
            ))}
          </div>
          <div className="feed-tools">
            <label className="sel">
              <span className="sr">Sort by</span>
              <select value={tab === 'trending' ? 'volume' : sort} disabled={tab === 'trending'} onChange={(e) => setSort(e.target.value as Sort)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <div className="viewtoggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => pickView('grid')} aria-label="Cards">
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
              </button>
              <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')} aria-label="Table">
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
          </div>
          {q && <p className="small filter-note">Showing tokens matching {term ? <>“<bdi>{term}</bdi>”</> : 'your search'}. <a href={href({ page: 'explore' })}>Clear</a></p>}
          {tab !== 'trending' && <p className="muted small milestone-note">Milestone: {MILESTONE_TEXT} of USDC bought into a token’s pool, net of sales (a testnet figure). Graduated shows the tokens at or above it now.</p>}
          {statsState === 'error' && <p className="err small">The 24-hour figures couldn’t load just now: retrying. Figures shown may be out of date.</p>}
        </>
      )}

      {rows && rows.length === 0 && (
        <div className="empty"><p>{q ? 'No token matches that.' : tab === 'graduated' ? (statsState === 'ok' ? 'No token is at the milestone right now.' : statsState === 'error' ? 'The figures couldn’t load: retrying.' : 'Loading the figures…') : 'No tokens here yet.'}</p><a className="btn btn-line btn-sm" href={href({ page: 'launch' })}>Create a token</a></div>
      )}
      {rows && rows.length > 0 && view === 'grid' && (
        <ul className="cards">{rows.map((l) => <li key={l.token}><TokenCard l={l} s={st(l)} /></li>)}</ul>
      )}
      {rows && rows.length > 0 && view === 'list' && <TokenTable rows={rows} stats={stats} holders={holders} />}
      {list && list.length > 0 && list[list.length - 1].index > 0 && (
        <div className="more">
          <button className="btn btn-line btn-sm" type="button" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Older tokens (${Math.max(0, total - list.length)} more)`}</button>
          {moreErr && !more && <p className="err small">Couldn’t read older tokens just now: try again in a moment.</p>}
        </div>
      )}
    </section>
  );
}

function TokenTable({ rows, stats, holders }: { rows: Listed[]; stats: Map<Address, Stats>; holders: Map<Address, number | null> }) {
  return (
    <div className="table-wrap tokens-wrap">
      <table className="tokens">
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col" className="num">Price</th>
            <th scope="col" className="num">24h</th>
            <th scope="col" className="num col-vol">24h volume</th>
            <th scope="col" className="num col-cap">Market cap</th>
            <th scope="col" className="num col-holders">Holders</th>
            <th scope="col" className="col-trend">Trend</th>
            <th scope="col" className="num col-age">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const s = stats.get(l.pool);
            const h = holders.get(l.token);
            const ch = s?.change24 != null ? change(s.change24) : null;
            const link = href({ page: 'token', token: l.token });
            return (
              <tr key={l.token} onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) window.location.hash = link; }}>
                <td>
                  <a className="tok" href={link}>
                    <TokenPic uri={l.metadataURI} symbol={l.symbol} token={l.token} size={36} />
                    <span className="tok-name"><b>$<bdi>{tokenText(l.symbol)}</bdi></b><bdi className="muted">{tokenText(l.name)}</bdi></span>
                  </a>
                </td>
                <td className="num">{l.market ? price(l.market.price) : '—'}</td>
                <td className={`num ${ch?.cls ?? ''}`}>{ch ? ch.text : '—'}</td>
                <td className="num col-vol">{s?.volume24 != null ? usdOf(s.volume24) : '—'}</td>
                <td className="num col-cap">{l.market ? usd(l.market.marketCap) : '—'}</td>
                <td className="num col-holders">{h == null ? '—' : h.toLocaleString('en-US')}</td>
                <td className="col-trend">{s ? <Spark points={s.trend} up={ch?.cls !== 'down'} /> : null}</td>
                <td className="num col-age muted">{ago(l.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
