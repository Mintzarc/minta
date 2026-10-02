// A token's page: who it is (ticker, name, address, creator, links), how it's trading (price, 24-hour change and
// volume, market cap, holders, the chart and the latest trades), its settings (taxes and where they go), and the
// buy/sell panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { buy, getLaunch, getPromoter, getTaxWallets, quoteBuy, quoteSell, sell, setPromoter, vyreTokenAbi, type Launch, type TaxWallets } from '@vyrechain/sdk';
import { EXPLORER, oneAtATime, vyre } from '../lib/chain';
import { ago, amount, amountProblem, change, exact, iso, parse, pct, plainText, price, short, tokenText, usd, usdOf } from '../lib/format';
import { addresses, marketOf, recentTrades, tokenBalance, usdcBalance, type Market, type Trade } from '../lib/market';
import { loadHolders, loadStats, MILESTONE_TEXT, type Stats } from '../lib/stats';
import { clearRef, href, storedRef, storedRefCode } from '../lib/router';
import { promoterWallet } from '../lib/api';
import { useEmailCantTrade, useWallet } from '../lib/wallet';
import { sendVyreTx, type EmailSession } from '../lib/circle';
import { AddressLink, ConnectButton, EmailTradeNote, Loading, TokenPic, TxButton, useMeta } from '../components/ui';
import PriceChart from '../components/PriceChart';

// kept back from a "max" buy so the wallet can still pay gas
const GAS_RESERVE = 10n ** 16n; // 0.01 USDC
const FEE_ROOM = 5n * 10n ** 15n; // 0.005 USDC: less than this left, a buy can't pay its fee

/**
 * A trade from an email wallet, once Circle signs for VYRE (the server's switch; until then the panel shows
 * EmailTradeNote): the server builds and simulates each transaction, the user signs it in Circle's window. A sale
 * first approves exactly its amount to the app router, if the allowance is short.
 */
async function emailTrade(withEmail: <T>(fn: (s: EmailSession) => Promise<T>) => Promise<T>, side: 'buy' | 'sell', token: Address,
  value: bigint, minOut: bigint, account: Address, say: (t: string) => void): Promise<string> {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  if (minOut <= 0n) throw new Error(side === 'buy' ? 'This buy would get no tokens.' : 'The pool would pay nothing for this sale now.');
  if (side === 'buy') {
    return withEmail((s) => sendVyreTx(s, { kind: 'buy', token, usdcIn: value.toString(), minTokensOut: minOut.toString(), deadline }, vyre, say));
  }
  const { appRouter } = addresses();
  const allowance = await vyre.readContract({ address: token, abi: vyreTokenAbi, functionName: 'allowance', args: [account, appRouter] });
  if (allowance < value) await withEmail((s) => sendVyreTx(s, { kind: 'approve', token, amount: value.toString() }, vyre, say));
  return withEmail((s) => sendVyreTx(s, { kind: 'sell', token, amountIn: value.toString(), minUsdcOut: minOut.toString(), deadline }, vyre, say));
}

// (The page is keyed by its token in App, so each token starts with fresh state.)
export default function Token({ token }: { token: Address }) {
  const { account, onVyre } = useWallet();
  const [launch, setLaunch] = useState<Launch | null | undefined>(undefined);
  const [market, setMarket] = useState<Market | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [bal, setBal] = useState<{ usdc: bigint; tokens: bigint } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [holders, setHolders] = useState<number | null>(null);
  const [split, setSplit] = useState<TaxWallets | null>(null);
  // a read that failed (the RPC busy or unreachable): the last good figures stay up, with a note
  const [readErr, setReadErr] = useState('');
  const [tradesErr, setTradesErr] = useState(false);
  const [statsErr, setStatsErr] = useState(false);
  const meta = useMeta(launch?.metadataURI);
  // the launch and its price as last read, which the slower reads work from
  const latest = useRef<{ l: Launch; m: Market } | null>(null);
  // a refresh that must land (after a trade, or "Try again"): runs once more if one is already running
  const soon = useRef(false);
  const gone = useRef(false);

  // the trades, the day's figures and the holders: one set at a time, so a slow one still lands
  const slow = useMemo(() => oneAtATime(async () => {
    const x = latest.current;
    if (!x || gone.current) return;
    const { l, m } = x;
    await Promise.all([
      recentTrades(l, m.quoteIsToken0, undefined, 300).then((t) => { setTrades(t); setTradesErr(false); }).catch(() => setTradesErr(true)),
      loadStats([{ ...l, index: 0, market: m }]).then((s) => { setStats(s.get(l.pool) ?? null); setStatsErr(false); }).catch(() => setStatsErr(true)),
      loadHolders([l]).then((h) => setHolders(h.get(l.token) ?? null)).catch(() => {}),
    ]);
  }), [token]);

  // the launch and its price (one read at a time, none while the tab is hidden), then the slower reads
  const main = useMemo(() => oneAtATime(async () => {
    if (gone.current || document.visibilityState === 'hidden') return;
    const queue = soon.current;
    soon.current = false;
    let l: Launch | null;
    try {
      l = await getLaunch(vyre, token);
    } catch {
      setReadErr('Couldn’t reach VYRE just now: retrying.');
      return;
    }
    setLaunch(l);
    if (!l) { setReadErr(''); return; }
    let m: Market;
    try {
      m = await marketOf(l);
    } catch {
      setReadErr('Couldn’t read the price just now: retrying.');
      // no price yet means no trades either: say so rather than "Loading" for good
      if (!latest.current) setTradesErr(true);
      return;
    }
    setReadErr('');
    setMarket(m);
    latest.current = { l, m };
    getTaxWallets(vyre, l.token).then(setSplit).catch(() => {});
    slow(queue);
  }), [token, slow]);
  const refresh = useCallback((queue = false) => { if (queue) soon.current = true; main(queue); }, [main]);

  const refreshBalances = useCallback(async () => {
    if (!account) { setBal(null); return; }
    const [usdc, tokens] = await Promise.all([usdcBalance(account), tokenBalance(token, account)]);
    setBal({ usdc, tokens });
  }, [account, token]);

  useEffect(() => {
    gone.current = false;
    refresh();
    const t = setInterval(() => refresh(), 20_000);
    // back from a hidden tab: at once, not at the next tick
    const back = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { gone.current = true; clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);
  useEffect(() => { refreshBalances().catch(() => {}); }, [refreshBalances]);

  if (launch === undefined) {
    return readErr
      ? <div className="empty"><p>{readErr}</p><button className="btn btn-line btn-sm" type="button" onClick={() => refresh(true)}>Try again</button></div>
      : <Loading what="Reading the launch" />;
  }
  if (launch === null) return <div className="empty"><p>No token at this address on MINTA. Check the full link and address. Just launched it? Check the transaction in your wallet: a missing page doesn’t mean the launch failed.</p><a href={href({ page: 'explore' })}>Back to all tokens</a></div>;

  const after = () => { refresh(true); refreshBalances().catch(() => {}); };
  const sym = tokenText(launch.symbol);
  return (
    <section className="token-page">
      <div className="token-head">
        <TokenPic uri={launch.metadataURI} symbol={launch.symbol} token={launch.token} size={64} />
        <div>
          <h1 className="token-title">$<bdi>{sym}</bdi> <bdi className="muted">{tokenText(launch.name)}</bdi></h1>
          <p className="muted small id-line"><CopyAddress address={launch.token} /> · created {ago(launch.createdAt)} by <AddressLink address={launch.creator} /></p>
          {meta?.links?.length ? (
            <p className="links">{meta.links.map((l) => (
              <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.url}>{l.label} <span className="host">({l.host})</span></a>
            ))}</p>
          ) : null}
        </div>
        {account && account.toLowerCase() === launch.creator.toLowerCase() && (
          <a className="btn btn-line btn-sm" href={href({ page: 'manage', token })}>Manage</a>
        )}
      </div>
      {meta?.description && plainText(meta.description) && <p className="description" dir="auto">{plainText(meta.description)}</p>}

      <dl className="stat-strip">
        <div><dt>Price</dt><dd>{market ? price(market.price) : '—'}</dd></div>
        <div><dt>24h</dt><dd className={stats?.change24 != null ? change(stats.change24).cls : ''}>{stats?.change24 != null ? change(stats.change24).text : '—'}</dd></div>
        <div><dt>24h volume</dt><dd>{stats?.volume24 != null ? usdOf(stats.volume24) : '—'}</dd></div>
        <div><dt>Market cap</dt><dd>{market ? usd(market.marketCap) : '—'}</dd></div>
        <div><dt>Holders</dt><dd>{holders == null ? '—' : holders.toLocaleString('en-US')}</dd></div>
      </dl>
      {statsErr && <p className="err small">{stats ? 'The 24-hour figures couldn’t refresh just now: showing the last ones read.' : 'The 24-hour figures couldn’t load just now: retrying.'}</p>}
      {stats && (
        <div className="milestone">
          {stats.graduated
            ? <p className="small"><b className="up">Graduated</b> <span className="muted">· {usd(stats.raised)} of USDC bought in, net of sales: at or above the {MILESTONE_TEXT} milestone.</span></p>
            : <p className="small"><b>{Math.min(99.9, stats.progress * 100).toFixed(1)}% of milestone</b> <span className="muted">· {usd(stats.raised)} of {MILESTONE_TEXT} of USDC bought in, net of sales</span></p>}
          <div className="bar" role="img" aria-label={`${Math.min(100, stats.progress * 100).toFixed(1)}% of the milestone`}><span style={{ width: `${Math.min(100, stats.progress * 100)}%` }} /></div>
        </div>
      )}

      <div className="token-grid">
        <div className="left-col">
        {readErr && <p className="err small">{readErr}{market ? ' The figures shown are the last ones read.' : ''}</p>}
        <PriceChart trades={tradesErr && !trades ? [] : trades} current={market?.price ?? 0} failed={tradesErr && !trades} />
        <div className="stats-card">
          <h2 className="h3 span-all">Settings</h2>
          <div><span>Buy tax</span><b>{pct(launch.buyTaxBps)}</b></div>
          <div><span>Sell tax</span><b>{pct(launch.sellTaxBps)}</b></div>
          <div><span>Platform fee</span><b>1% buy and sell</b></div>
          {launch.partner && <div><span>Partner fee</span><b>{pct(launch.partnerFeeBps)} (<AddressLink address={launch.partner} />)</b></div>}
          <div><span>Supply</span><b>{amount(launch.totalSupply, 0)}</b></div>
          <div><span>Liquidity</span><b>Locked for good</b></div>
          <div className="span-all"><span>Tax goes to</span>
            {split === null ? <b>—</b> : split.wallets.length === 0 ? <b>The creator (<AddressLink address={launch.creator} />)</b> : (
              <ul className="split-list">{split.wallets.map((w, i) => <li key={w}><AddressLink address={w} /> <b>{pct(split.bps[i])}</b></li>)}</ul>
            )}
          </div>
          <p className="muted small">The tax and fees are paid in USDC. The creator can lower the tax, never raise it. The price shown is the pool’s, before fees.</p>
        </div>
        </div>
        <TradePanel launch={launch} bal={bal} onVyre={onVyre} account={account} onDone={after} />
      </div>

      <h2 className="h2">Latest trades</h2>
      {!trades && !tradesErr && <Loading />}
      {!trades && tradesErr && <p className="err small">Couldn’t load the trades just now: retrying.</p>}
      {trades && tradesErr && <p className="err small">Couldn’t refresh the trades just now: showing the last ones read.</p>}
      {trades && trades.length === 0 && <p className="muted">No trades yet.</p>}
      {trades && trades.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Side</th><th>USDC</th><th><bdi>{sym}</bdi></th><th>Price</th><th>When</th></tr></thead>
          <tbody>
            {trades.slice(0, 25).map((t) => (
              <tr key={`${t.hash}-${t.tokens}`}>
                <td className={t.isBuy ? 'buy' : 'sell'}>{t.isBuy ? 'Buy' : 'Sell'}</td>
                <td>{amount(t.usdc, 4)}</td>
                <td>{amount(t.tokens, 0)}</td>
                <td>{price(t.price)}</td>
                <td><a href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noopener noreferrer">{t.time ? ago(t.time) : `block ${t.block}`}</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

function TradePanel({ launch, bal, account, onVyre, onDone }: {
  launch: Launch; bal: { usdc: bigint; tokens: bigint } | null; account: Address | null;
  onVyre: ReturnType<typeof useWallet>['onVyre']; onDone: () => void;
}) {
  const { email, withEmail, faceId, confirmHint } = useWallet();
  const emailCantTrade = useEmailCantTrade();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [input, setInput] = useState('');
  const [quote, setQuote] = useState<{ out: bigint; for: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [quoteErr, setQuoteErr] = useState('');
  const [slippage, setSlippage] = useState(200);
  const value = parse(input);
  // a buy leaves a little for its network fee (a Face ID wallet sets its fee aside before it runs)
  const tooMuch = !!(bal && value && (side === 'buy' ? value + FEE_ROOM > bal.usdc : value > bal.tokens));

  // a fresh quote a moment after the amount stops changing, and again every 15 s while it's shown; an answer for an
  // earlier amount or side (they can come back late) is dropped
  const key = `${side}:${input}`;
  useEffect(() => { setQuote(null); setQuoteErr(''); }, [key, launch.token]);
  useEffect(() => {
    if (!value) return;
    let live = true;
    const t = setTimeout(() => {
      (side === 'buy' ? quoteBuy(vyre, { token: launch.token, usdcIn: value }) : quoteSell(vyre, { token: launch.token, amountIn: value }))
        .then((out) => { if (live) { setQuote({ out, for: key }); setQuoteErr(''); } })
        .catch(() => { if (live) { setQuote(null); setQuoteErr(side === 'sell' ? 'The pool can’t price that sale.' : 'Couldn’t price that.'); } });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, launch.token, tick]);
  useEffect(() => { if (!value) return; const t = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(t); }, [key]);
  const shown = quote && quote.for === key ? quote : null;

  const max = () => {
    if (!bal) return;
    const v = side === 'buy' ? (bal.usdc > GAS_RESERVE ? bal.usdc - GAS_RESERVE : 0n) : bal.tokens;
    setInput(amount(v, 18).replace(/,/g, ''));
  };
  // the minimum shown is the minimum sent: the trade reverts rather than fill below it
  const min = shown ? (shown.out * BigInt(10_000 - slippage)) / 10_000n : 0n;
  // the ticker in plain strings, isolated so right-to-left letters in it can't reorder the words around it
  const sym = iso(launch.symbol);
  const outSym = side === 'buy' ? sym : 'USDC';
  const typo = amountProblem(input);
  // the amount as it was read, on the button itself, so a misread shows before anything is signed
  const label = tooMuch ? 'Not enough balance'
    : side === 'buy' ? (value ? `Buy with ${exact(value)} USDC` : `Buy ${sym}`)
    : (value ? `Sell ${exact(value)} ${sym}` : `Sell ${sym}`);

  return (
    <div className="trade-card">
      <div className="seg" role="tablist" aria-label="Buy or sell">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={`${s} ${side === s ? 'on' : ''}`} onClick={() => { setSide(s); setInput(''); }}>{s === 'buy' ? 'Buy' : 'Sell'}</button>
        ))}
      </div>
      <label className="field">
        <span>{side === 'buy' ? 'You pay (USDC)' : `You sell (${sym})`}</span>
        <div className="input-row">
          <input inputMode="decimal" autoComplete="off" placeholder="0.0" value={input} onChange={(e) => setInput(e.target.value)} aria-invalid={!!typo} />
          {bal && <button type="button" className="linkish small" onClick={max}>Max</button>}
        </div>
        {bal && <span className="muted small">Balance: {side === 'buy' ? `${amount(bal.usdc)} USDC` : `${amount(bal.tokens, 2)} ${sym}`}</span>}
      </label>
      <div className="quote">
        {typo && <p className="err small" role="alert">{typo}</p>}
        {!value && !typo && <p className="muted small">Enter an amount to see what you’d get.</p>}
        {value && !shown && !quoteErr && <p className="muted small">Pricing…</p>}
        {quoteErr && <p className="err small">{quoteErr}</p>}
        {value && shown && (
          <>
            <p>You get about <b>{amount(shown.out, side === 'buy' ? 2 : 6)} {outSym}</b></p>
            <p className="muted small">At least {amount(min, side === 'buy' ? 2 : 6)} {outSym}, or the trade doesn’t go through ({(slippage / 100).toFixed(1)}% leeway for other trades landing first), after the creator’s tax ({pct(side === 'buy' ? launch.buyTaxBps : launch.sellTaxBps)}), VYRE’s 1%{launch.partner ? ` and the partner’s ${pct(launch.partnerFeeBps)}` : ''}.</p>
          </>
        )}
        <p className="small slip">Leeway: {[100, 200, 500].map((s) => <button key={s} type="button" className={`chip ${slippage === s ? 'on' : ''}`} onClick={() => setSlippage(s)}>{s / 100}%</button>)}</p>
      </div>
      {!email && <PromoterNote account={account} onVyre={onVyre} />}
      {!account ? <ConnectButton /> : emailCantTrade ? <EmailTradeNote /> : (
        <TxButton
          label={label}
          disabled={!value || !shown || min <= 0n || tooMuch}
          // a trade whose result couldn't be read is kept for this tab (leaving the page or reloading still shows Check it); a trade is
          // sent to the router, so anything else held was the approval before a sale
          keepAs={`trade:${launch.token.toLowerCase()}:${account.toLowerCase()}`}
          finalTo={addresses().appRouter}
          onDone={() => { setInput(''); onDone(); }}
          run={async (say) => {
            if (email) {
              const hash = await emailTrade(withEmail, side, launch.token, value!, min, account, say);
              return { hash, text: side === 'buy' ? `Bought ${sym}.` : `Sold ${sym}.` };
            }
            const wallet = await onVyre();
            say(confirmHint);
            if (side === 'buy') {
              const r = await buy(wallet, vyre, { token: launch.token, usdcIn: value!, minTokensOut: min });
              return { hash: r.hash, text: `Bought ${amount(r.tokensOut, 2)} ${sym}.` };
            }
            const r = await sell(wallet, vyre, { token: launch.token, amountIn: value!, minUsdcOut: min });
            return { hash: r.hash, text: `Sold for ${amount(r.usdcOut, 4)} USDC.` };
          }}
        />
      )}
      {side === 'sell' && <p className="muted small">{faceId
        ? 'Selling approves exactly this amount, in the same step as the sale (one Face ID), never an open-ended amount.'
        : 'Selling signs a permit for exactly this amount (or asks for an exact approval if your wallet can’t), never an open-ended one.'}</p>}
    </div>
  );
}

/** If the visitor came by a promoter's link and hasn't named a promoter yet, offer to name them (once, for good) */
function PromoterNote({ account, onVyre }: { account: Address | null; onVyre: ReturnType<typeof useWallet>['onVyre'] }) {
  const { confirmHint } = useWallet();
  const [ref, setRef] = useState(storedRef);
  const [code, setCode] = useState(storedRefCode);
  // a code link looked up after this drew, or a newer link: show the promoter stored now
  useEffect(() => {
    const on = () => { setRef(storedRef()); setCode(storedRefCode()); };
    window.addEventListener('vyre-ref', on);
    return () => window.removeEventListener('vyre-ref', on);
  }, []);
  // a code is checked again: a promoter removed since isn't offered (if the list can't be read, it stays)
  useEffect(() => {
    if (!code || !ref) return;
    let live = true;
    promoterWallet(code).then((p) => {
      if (live && (!p || p.wallet.toLowerCase() !== ref.toLowerCase())) { clearRef(); setRef(null); setCode(null); }
    }).catch(() => { /* busy: keep it */ });
    return () => { live = false; };
  }, [code, ref]);
  const [current, setCurrent] = useState<Address | null | undefined>(undefined);
  useEffect(() => { if (account) getPromoter(vyre, account).then(setCurrent).catch(() => setCurrent(undefined)); }, [account]);
  if (!account || !ref || current !== null || ref.toLowerCase() === account.toLowerCase()) return null;
  return (
    <div className="note">
      <p className="small">You came by {code ? <><b>{code}</b>’s link ({short(ref)})</> : <>{short(ref)}’s link</>}. Name them as your promoter? It’s one small transaction, set once and never changed; it costs you nothing on your trades.</p>
      <div className="row">
        <TxButton className="btn btn-line btn-sm" label="Name promoter" onDone={() => setCurrent(ref)}
          run={async (say) => { const w = await onVyre(); say(confirmHint); const r = await setPromoter(w, vyre, ref); clearRef(); return { hash: r.hash, text: 'Done.' }; }} />
        <button type="button" className="linkish small" onClick={() => { clearRef(); setCurrent(ref); }}>No thanks</button>
      </div>
    </div>
  );
}

function CopyAddress({ address }: { address: Address }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-addr">
      <AddressLink address={address} />
      <button type="button" className="linkish small" aria-label="Copy the token’s address"
        onClick={() => navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}
