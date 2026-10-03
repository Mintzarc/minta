// A creator's controls for their launch: collect the tax, lower it, split it between wallets, change the picture and
// links, and hand the launch to someone else (who accepts it). Each transaction is simulated before the wallet sees it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAddress, zeroAddress, type Address, type Hash } from 'viem';
import { getFaceIdAddresses, getLaunch, sendCall, vyrePadAbi, type Launch, type WalletLike } from '@vyrechain/sdk';
import { vyre } from '../lib/chain';
import { isAddr, pct, short, tokenText } from '../lib/format';
import { addresses, readLaunchFile, type Meta } from '../lib/market';
import { loweredTaxes, refusedForSplit, splitBps, taxSplitProblem } from '../lib/taxsplit';
import { href } from '../lib/router';
import { useEmailCantTrade, useWallet } from '../lib/wallet';
import { AddressLink, ConnectButton, EmailTradeNote, Loading, TokenPic, TxButton } from '../components/ui';
import { LaunchFileFields, emptyLaunchFile, launchFileProblem, type LaunchFileState } from '../components/LaunchFileFields';
import { API_URL, hasContent, saveLaunchFile, withUploadedPicture, type LaunchFile } from '../lib/api';

/** The chain's Face ID wallet contracts the SDK lists (none when the SDK has no list for it) */
function faceIdContracts(): object | null {
  try { return vyre.chain ? getFaceIdAddresses(vyre.chain.id) : null; } catch { return null; }
}

type PadCall =
  | { functionName: 'collectCreatorFees'; args: readonly [Address] }
  | { functionName: 'lowerTaxes'; args: readonly [Address, number, number] }
  | { functionName: 'setTaxWallets'; args: readonly [Address, readonly Address[], readonly number[]] }
  | { functionName: 'setMetadata'; args: readonly [Address, string] }
  | { functionName: 'offerCreator'; args: readonly [Address, Address] }
  | { functionName: 'acceptCreator'; args: readonly [Address, number, number] };

/** Simulates a call on the pad, then sends it and waits for it (a browser wallet's transaction, or a Face ID wallet's operation) */
async function padTx(wallet: WalletLike, call: PadCall): Promise<Hash> {
  const { pad } = addresses();
  const { hash } = await sendCall(wallet, vyre, { address: pad, abi: vyrePadAbi, functionName: call.functionName, args: call.args });
  return hash;
}

export default function Manage({ token }: { token: Address }) {
  const { account, onVyre, confirmHint } = useWallet();
  const emailCantTrade = useEmailCantTrade();
  const [launch, setLaunch] = useState<Launch | null | undefined>(undefined);
  const [wallets, setWallets] = useState<Split | null>(null);
  const [pending, setPending] = useState<Address | null>(null);
  // a read that failed (the RPC busy or unreachable) isn't "not a launch": what was read stays, with a way to try again
  const [readErr, setReadErr] = useState(false);

  const load = useCallback(async () => {
    const { pad } = addresses();
    let l: Launch | null;
    try {
      l = await getLaunch(vyre, token);
    } catch {
      setReadErr(true);
      return;
    }
    setReadErr(false);
    setLaunch(l);
    if (!l) return;
    try {
      const [tw, pc] = await Promise.all([
        vyre.readContract({ address: pad, abi: vyrePadAbi, functionName: 'taxWalletsOf', args: [token] }),
        vyre.readContract({ address: pad, abi: vyrePadAbi, functionName: 'pendingCreator', args: [token] }),
      ]);
      setWallets({ wallets: tw[0], bps: tw[1] });
      setPending(pc === zeroAddress ? null : pc);
    } catch {
      setReadErr(true);
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (launch === undefined) {
    return readErr
      ? <div className="empty"><p>Couldn’t reach VYRE just now, so the launch couldn’t be read.</p><button className="btn btn-line btn-sm" type="button" onClick={() => { setReadErr(false); load(); }}>Try again</button></div>
      : <Loading what="Reading the launch" />;
  }
  if (launch === null) return <p className="err">That address isn’t a launch.</p>;
  const isCreator = !!account && getAddress(account) === getAddress(launch.creator);
  const isOffered = !!account && !!pending && getAddress(account) === getAddress(pending);
  const run = (call: PadCall, text: string) => async (say: (t: string) => void) => {
    const w = await onVyre(); say(confirmHint);
    const hash = await padTx(w, call); load(); return { hash, text };
  };

  return (
    <section className="narrow">
      <div className="token-head">
        <TokenPic uri={launch.metadataURI} symbol={launch.symbol} token={launch.token} size={56} />
        <div>
          <p className="eyebrow">Manage</p>
          <h1 className="token-title"><bdi>{tokenText(launch.name)}</bdi> <span className="muted">$<bdi>{tokenText(launch.symbol)}</bdi></span></h1>
          <p className="small muted">Creator <AddressLink address={launch.creator} /> · <a href={href({ page: 'token', token })}>Trade page</a></p>
        </div>
      </div>

      {readErr && <p className="err small">Couldn’t reach VYRE just now: what’s shown may be out of date. <button className="linkish" type="button" onClick={() => { setReadErr(false); load(); }}>Try again</button></p>}
      {!account && <ConnectButton />}
      {emailCantTrade && <EmailTradeNote />}
      {account && isOffered && (
        <div className="card">
          <h2 className="h3">You’ve been offered this launch</h2>
          <p className="small">Accept to become its creator: its taxes (now {pct(launch.buyTaxBps)} buy, {pct(launch.sellTaxBps)} sell) go to you from then on. Tax earned until now goes where the current creator set it.</p>
          <TxButton label="Accept" run={run({ functionName: 'acceptCreator', args: [token, launch.buyTaxBps, launch.sellTaxBps] }, 'You’re the creator now.')} />
        </div>
      )}
      {account && !isCreator && !isOffered && (
        <p className="muted">Only the creator ({short(launch.creator)}) can change this launch. Anyone can collect its tax for the creator:</p>
      )}

      <div className="card">
        <h2 className="h3">Collect the tax</h2>
        <p className="small">Sends the tax collected so far, in USDC, to {!wallets ? 'the wallets its tax goes to (the creator, unless the tax is split)' : wallets.wallets.length ? 'the tax wallets below' : 'the creator'}. Anyone can press it; the money only goes there.</p>
        {account && <TxButton className="btn btn-line" label="Collect" run={run({ functionName: 'collectCreatorFees', args: [token] }, 'Collected.')} />}
      </div>

      {isCreator && (
        <>
          <LowerTaxes launch={launch} run={run} />
          <TaxWallets launch={launch} current={wallets} failed={readErr} retry={() => { setReadErr(false); load(); }} run={run} />
          <Metadata launch={launch} run={run} />
          <Handover launch={launch} pending={pending} run={run} />
        </>
      )}
    </section>
  );
}

type Runner = (call: PadCall, text: string) => (say: (t: string) => void) => Promise<{ hash: Hash; text: string }>;

function LowerTaxes({ launch, run }: { launch: Launch; run: Runner }) {
  const [b, setB] = useState(String(launch.buyTaxBps / 100));
  const [s, setS] = useState(String(launch.sellTaxBps / 100));
  // an empty field isn't 0%: taxes can never go back up, so nothing is sent until both are filled in, each a plain percent
  // with at most two decimals (read exactly as typed, never rounded)
  const { buy: nb, sell: ns, ok } = loweredTaxes(b, s, launch);
  return (
    <div className="card">
      <h2 className="h3">Lower the tax</h2>
      <p className="small">Now {pct(launch.buyTaxBps)} on buys and {pct(launch.sellTaxBps)} on sells. It can only go down, for good.</p>
      <div className="two">
        <label className="field"><span>Buy tax (%)</span><input inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} /></label>
        <label className="field"><span>Sell tax (%)</span><input inputMode="decimal" value={s} onChange={(e) => setS(e.target.value)} /></label>
      </div>
      <TxButton className="btn btn-line" label={ok ? `Lower to ${pct(nb)} / ${pct(ns)}` : 'Lower it'} disabled={!ok} run={run({ functionName: 'lowerTaxes', args: [launch.token, nb, ns] }, 'Lowered.')} />
    </div>
  );
}

type Split = { wallets: readonly Address[]; bps: readonly number[] };

/** The tax split's card. Saving replaces the whole split, so the editor is shown only once the current split has been read: an
 * editor that started empty because the read failed would let the creator save over a split they never saw. */
function TaxWallets({ launch, current, failed, retry, run }: { launch: Launch; current: Split | null; failed: boolean; retry: () => void; run: Runner }) {
  return (
    <div className="card">
      <h2 className="h3">Split the tax</h2>
      <p className="small">Up to four wallets, each with a share. Tax earned so far is paid out first, the old way. Use wallets you control: tax sent to a contract that can’t move it is lost.</p>
      {current ? <SplitEditor launch={launch} current={current} run={run} />
        : failed ? (
          <div className="split-failed" role="alert">
            <p className="err small">The launch’s current split couldn’t be read just now, so it can’t be changed yet: saving would replace it.</p>
            <p className="small"><button type="button" className="btn btn-line btn-sm" onClick={retry}>Try again</button></p>
          </div>
        ) : <Loading what="Reading the launch’s current split" />}
    </div>
  );
}

/** The editor's rows for a split read from the chain (no split: all of it to the creator) */
const rowsOf = (current: Split, creator: Address): { addr: string; share: string }[] =>
  current.wallets.length ? current.wallets.map((w, i) => ({ addr: w, share: String(current.bps[i] / 100) })) : [{ addr: creator, share: '100' }];

function SplitEditor({ launch, current, run }: { launch: Launch; current: Split; run: Runner }) {
  const [rows, setRows] = useState(() => rowsOf(current, launch.creator));
  // a new read (after a save, or Try again) starts the editor again from what is on the chain
  useEffect(() => { setRows(rowsOf(current, launch.creator)); }, [current, launch.creator]);
  // (refused: every contract the SDK lists for the chain, the chain's Multicall3, this launch's pool and token, and the chain's system addresses)
  const refused = refusedForSplit(addresses(), faceIdContracts(), [vyre.chain?.contracts?.multicall3?.address, launch.pool, launch.token]);
  const bps = splitBps(rows);
  const problem = taxSplitProblem(rows, refused);
  return (
    <>
      {rows.map((r, i) => (
        <div className="split-row" key={i}>
          <input aria-label={`Wallet ${i + 1}`} className="mono" value={r.addr} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, addr: e.target.value.trim() } : x)))} placeholder="0x…" />
          <input aria-label={`Share ${i + 1} (%)`} inputMode="decimal" value={r.share} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))} />
          <span className="muted">%</span>
          <button type="button" className="linkish small" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      {rows.length < 4 && <button type="button" className="linkish small" onClick={() => setRows([...rows, { addr: '', share: '' }])}>Add a wallet</button>}
      {problem && <p className="err small">{problem}</p>}
      <TxButton className="btn btn-line" label={problem ? 'Save the split' : `Save the split: ${bps.map(pct).join(' / ')}`} disabled={!!problem}
        run={(say) => run({ functionName: 'setTaxWallets', args: [launch.token, rows.map((r) => getAddress(r.addr as Address)), bps] }, 'Saved.')(say)} />
    </>
  );
}

function Metadata({ launch, run }: { launch: Launch; run: Runner }) {
  const uri = launch.metadataURI;
  const ours = uri.startsWith(`${API_URL}/m/`);
  // the editor starts from the launch's current file, so it isn't shown until that file has been read: saving replaces the file,
  // and an editor that started empty because a read failed (or typed in before the file arrived) would wipe what's there
  const [read, setRead] = useState<'reading' | 'failed' | 'ready'>('reading');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LaunchFileState>(emptyLaunchFile);
  const [touched, setTouched] = useState(false);
  // the file this editor just saved: when the launch then points at it, the editor already shows it (and its "Saved" stays up)
  const saved = useRef('');
  useEffect(() => {
    // the fields just saved as a new file: "Your own file" no longer starts from the link the launch had before
    if (uri && uri === saved.current) { setState((s) => (s.useOwn ? s : { ...s, own: ours ? '' : uri })); return; }
    let live = true;
    const fromFile = (m: Meta) => {
      const links: LaunchFile['links'] = {};
      for (const l of m.links) links[l.key] = l.url;
      // the picture link as written: one to another site shows as a link MINTA doesn't draw, and a save of the fields leaves it out
      // of the new file (lib/api.ts storable; the picture field says so). A file kept on another site is the creator's own, so
      // "Your own file" starts from its link and saving from there keeps it
      return { file: { description: m.description, image: m.imageLink, links }, own: ours ? '' : uri, useOwn: false };
    };
    // a file that isn't one of ours and can't be read here stays the creator's own: its link is kept as it is
    const asOwn = () => ({ ...emptyLaunchFile(), own: uri, useOwn: true });
    setRead('reading');
    readLaunchFile(uri, attempt > 0).then(
      (m) => { if (!live) return; setState(m ? fromFile(m) : uri && !ours ? asOwn() : emptyLaunchFile()); setRead('ready'); },
      () => { if (!live) return; if (ours) { setRead('failed'); return; } setState(asOwn()); setRead('ready'); },
    );
    return () => { live = false; };
  }, [uri, ours, attempt]);
  // a save that would leave the launch with no file: an emptied own-file link is refused (it would read as no file at all), and
  // fields with nothing in them that a file keeps say so before they're saved
  const emptied = state.useOwn ? !state.own.trim() : !(hasContent(state.file) || state.picture);
  const problem = launchFileProblem(state)
    || (state.useOwn && emptied && uri ? 'Paste the link to your own file. To take the launch’s picture, description and links away, use the fields instead and leave them empty.' : '');
  return (
    <div className="card">
      <h2 className="h3">Picture, description and links</h2>
      {read === 'reading' && <Loading what="Reading the launch’s current picture and links" />}
      {read === 'failed' && (
        <div className="meta-failed" role="alert">
          <p className="err small">The launch’s current file couldn’t be read just now, so it can’t be edited yet: saving would replace what’s in it. Its link: <a className="mono" href={uri} target="_blank" rel="noopener noreferrer">{uri}</a></p>
          <p className="small">
            <button type="button" className="btn btn-line btn-sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button>{' '}
            <button type="button" className="linkish small" onClick={() => { setState(emptyLaunchFile()); setTouched(false); setRead('ready'); }}>Start a new file instead</button>
          </p>
        </div>
      )}
      {read === 'ready' && (
        <>
          {uri && !ours && !state.useOwn && (
            <p className="small muted">This launch’s file is kept on another site ({/^https:\/\//.test(uri)
              ? <a className="mono break" href={uri} target="_blank" rel="noopener noreferrer">{uri}</a>
              : <span className="mono break">{uri}</span>}). Saving the fields puts a new file in its place, kept by the service that keeps launch files; to keep using your own file, change it there and save its link under “Your own file (advanced)”.</p>
          )}
          <LaunchFileFields value={state} onChange={(v) => { setTouched(true); setState(v); }} />
          {uri && !state.useOwn && emptied && <p className="small">Nothing here would be kept in a file, so saving removes the launch’s picture, description and links.</p>}
          {problem && <p className="err small">{problem}</p>}
          <TxButton className="btn btn-line" label="Save" disabled={!!problem || !touched}
            run={async (say) => {
              let next = '';
              if (state.useOwn) next = state.own.trim();
              else if (hasContent(state.file) || state.picture) { say(state.picture ? 'Uploading the picture…' : 'Saving the file…'); next = await saveLaunchFile(await withUploadedPicture(state.file, state.picture)); }
              if (next === uri) return { text: 'Nothing changed.' };
              saved.current = next;
              return run({ functionName: 'setMetadata', args: [launch.token, next] }, 'Saved.')(say);
            }} />
        </>
      )}
    </div>
  );
}

function Handover({ launch, pending, run }: { launch: Launch; pending: Address | null; run: Runner }) {
  const [to, setTo] = useState('');
  const ok = isAddr(to) && to.toLowerCase() !== launch.creator.toLowerCase();
  return (
    <div className="card">
      <h2 className="h3">Hand it over</h2>
      <p className="small">Offer the launch (its taxes and settings) to another wallet. It becomes theirs when they accept on this page.{pending ? ` Offered now to ${short(pending)}.` : ''}</p>
      <label className="field"><span>New creator</span><input className="mono" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" /></label>
      <TxButton className="btn btn-line" label="Offer" disabled={!ok} run={run({ functionName: 'offerCreator', args: [launch.token, to as Address] }, 'Offered.')} />
    </div>
  );
}
