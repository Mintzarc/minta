// What the connected wallet holds on VYRE: USDC, and every launch token it has, at the pools' prices; and the launches
// it created.
import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { getLaunchCount } from '@vyrechain/sdk';
import { vyre } from '../lib/chain';
import { amount, price, tokenText, usd } from '../lib/format';
import { listLaunches, tokenBalance, usdcBalance, type Listed } from '../lib/market';
import { href } from '../lib/router';
import { useWallet } from '../lib/wallet';
import { ConnectButton, Loading, TokenPic } from '../components/ui';

// how many launches to look through (newest first); a later version reads balances from the explorer's index instead
const SCAN = 200;

interface Holding { launch: Listed; balance: bigint; value: number }

export default function Portfolio() {
  const { account } = useWallet();
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [mine, setMine] = useState<Listed[]>([]);
  const [scanned, setScanned] = useState({ seen: 0, total: 0 });
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (!account) return;
    let live = true;
    (async () => {
      setFailed('');
      setUsdc(await usdcBalance(account));
      const [total, list] = await Promise.all([getLaunchCount(vyre), listLaunches(SCAN)]);
      // a balance that couldn't be read is said so, not counted as none
      const balances = await Promise.all(list.map((l) => tokenBalance(l.token, account as Address).catch(() => null)));
      if (!live) return;
      setScanned({ seen: list.length, total });
      const missed = balances.filter((b) => b === null).length;
      if (missed) setFailed(`${missed} token balance${missed === 1 ? '' : 's'} couldn’t be read just now; reload to try again.`);
      setHoldings(list.map((l, i) => ({ launch: l, balance: balances[i] ?? 0n, value: l.market ? (Number((balances[i] ?? 0n) / 10n ** 12n) / 1e6) * l.market.price : 0 }))
        .filter((h) => h.balance > 0n).sort((a, b) => b.value - a.value));
      setMine(list.filter((l) => l.creator.toLowerCase() === account.toLowerCase()));
    })().catch(() => { if (live) { setFailed('Couldn’t read your holdings just now; reload to try again.'); setHoldings((h) => h ?? null); } });
    return () => { live = false; };
  }, [account]);

  if (!account) return <section className="narrow"><h1 className="display">Your <em>portfolio.</em></h1><p className="lede">Connect a wallet to see what you hold on VYRE.</p><ConnectButton /></section>;
  const total = (usdc ? Number(usdc / 10n ** 12n) / 1e6 : 0) + (holdings || []).reduce((a, h) => a + h.value, 0);
  return (
    <section>
      <p className="eyebrow">Portfolio</p>
      <h1 className="display">{usd(total)}</h1>
      <p className="muted small">USDC plus your tokens at the pools’ current prices. Selling pays fees and moves the price, so a sale returns less, most of all for a large holding.</p>
      {failed && <p className="err small">{failed}</p>}

      <div className="card row-between">
        <div><p className="muted small">USDC on VYRE</p><p className="big">{usdc === null ? '…' : amount(usdc)}</p></div>
        <a className="btn btn-line btn-sm" href={href({ page: 'wallet' })}>Add USDC</a>
      </div>

      <h2 className="h2">Tokens</h2>
      {!holdings && !failed && <Loading what="Looking through the launches" />}
      {holdings && holdings.length === 0 && <p className="muted">No launch tokens yet. <a href={href({ page: 'explore' })}>Explore launches</a></p>}
      {holdings && holdings.length > 0 && (
        <ul className="list">
          {holdings.map((h) => (
            <li key={h.launch.token}>
              <a className="row-link" href={href({ page: 'token', token: h.launch.token })}>
                <TokenPic uri={h.launch.metadataURI} symbol={h.launch.symbol} token={h.launch.token} size={36} />
                <span className="grow"><b><bdi>{tokenText(h.launch.symbol)}</bdi></b> <span className="muted small">{amount(h.balance, 2)}</span></span>
                <span className="right"><b>{usd(h.value)}</b><br /><span className="muted small">{h.launch.market ? price(h.launch.market.price) : ''}</span></span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {scanned.total > scanned.seen && <p className="muted small">Looked through the newest {scanned.seen} of {scanned.total} launches.</p>}

      {mine.length > 0 && (
        <>
          <h2 className="h2">Your launches</h2>
          <ul className="list">
            {mine.map((l) => (
              <li key={l.token}>
                <a className="row-link" href={href({ page: 'manage', token: l.token })}>
                  <TokenPic uri={l.metadataURI} symbol={l.symbol} token={l.token} size={36} />
                  <span className="grow"><b><bdi>{tokenText(l.symbol)}</bdi></b> <bdi className="muted small">{tokenText(l.name)}</bdi></span>
                  <span className="right small">Manage →</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
