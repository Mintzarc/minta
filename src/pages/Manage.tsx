// A creator's controls for their launch: collect the tax, lower it, split it between wallets, change the picture and
// links, and hand the launch to someone else (who accepts it). Each transaction is simulated before the wallet sees it.
import { useCallback, useEffect, useState } from 'react';
import { getAddress, zeroAddress, type Address, type Hash } from 'viem';
import { getFaceIdAddresses, getLaunch, sendCall, vyrePadAbi, type Launch, type WalletLike } from '@vyrechain/sdk';
import { vyre } from '../lib/chain';
import { isAddr, pct, short, tokenText } from '../lib/format';
import { addresses } from '../lib/market';
import { loweredTaxes, refusedForSplit, splitBps, taxSplitProblem } from '../lib/taxsplit';
import { href } from '../lib/router';
import { useEmailCantTrade, useWallet } from '../lib/wallet';
import { AddressLink, ConnectButton, EmailTradeNote, Loading, TokenPic, TxButton, useMeta } from '../components/ui';
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
  const [wallets, setWallets] = useState<{ wallets: readonly Address[]; bps: readonly number[] } | null>(null);
  const [pending, setPending] = useState<Address | null>(null);

  const load = useCallback(async () => {
    const { pad } = addresses();
    const l = await getLaunch(vyre, token).catch(() => null);
    setLaunch(l);
    if (!l) return;
    const [tw, pc] = await Promise.all([
      vyre.readContract({ address: pad, abi: vyrePadAbi, functionName: 'taxWalletsOf', args: [token] }),
      vyre.readContract({ address: pad, abi: vyrePadAbi, functionName: 'pendingCreator', args: [token] }),
    ]);
    setWallets({ wallets: tw[0], bps: tw[1] });
    setPending(pc === zeroAddress ? null : pc);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (launch === undefined) return <Loading what="Reading the launch" />;
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
        <p className="small">Sends the tax collected so far, in USDC, to {wallets && wallets.wallets.length ? 'the tax wallets below' : 'the creator'}. Anyone can press it; the money only goes there.</p>
        {account && <TxButton className="btn btn-line" label="Collect" run={run({ functionName: 'collectCreatorFees', args: [token] }, 'Collected.')} />}
      </div>

      {isCreator && (
        <>
          <LowerTaxes launch={launch} run={run} />
          <TaxWallets launch={launch} current={wallets} run={run} />
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

function TaxWallets({ launch, current, run }: { launch: Launch; current: { wallets: readonly Address[]; bps: readonly number[] } | null; run: Runner }) {
  const [rows, setRows] = useState<{ addr: string; share: string }[]>([]);
  useEffect(() => {
    if (current) setRows(current.wallets.length ? current.wallets.map((w, i) => ({ addr: w, share: String(current.bps[i] / 100) })) : [{ addr: launch.creator, share: '100' }]);
  }, [current, launch.creator]);
  // (refused: every contract the SDK lists for the chain, the chain's Multicall3, this launch's pool and token, and the chain's system addresses)
  const refused = refusedForSplit(addresses(), faceIdContracts(), [vyre.chain?.contracts?.multicall3?.address, launch.pool, launch.token]);
  const bps = splitBps(rows);
  const problem = taxSplitProblem(rows, refused);
  return (
    <div className="card">
      <h2 className="h3">Split the tax</h2>
      <p className="small">Up to four wallets, each with a share. Tax earned so far is paid out first, the old way. Use wallets you control: tax sent to a contract that can’t move it is lost.</p>
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
    </div>
  );
}

function Metadata({ launch, run }: { launch: Launch; run: Runner }) {
  const current = useMeta(launch.metadataURI);
  const [state, setState] = useState<LaunchFileState>(emptyLaunchFile);
  const [touched, setTouched] = useState(false);
  // start from what the launch shows now (or its own file's link, if it isn't one of ours)
  useEffect(() => {
    if (touched) return;
    const ours = launch.metadataURI.startsWith(`${API_URL}/m/`);
    if (launch.metadataURI && !ours && !current) { setState({ ...emptyLaunchFile(), own: launch.metadataURI, useOwn: true }); return; }
    if (current) {
      const links: LaunchFile['links'] = {};
      for (const l of current.links) links[l.key] = l.url;
      setState({ file: { description: current.description, image: current.image, links }, own: '', useOwn: false });
    }
  }, [current, launch.metadataURI, touched]);
  const problem = launchFileProblem(state);
  return (
    <div className="card">
      <h2 className="h3">Picture, description and links</h2>
      <LaunchFileFields value={state} onChange={(v) => { setTouched(true); setState(v); }} />
      {problem && <p className="err small">{problem}</p>}
      <TxButton className="btn btn-line" label="Save" disabled={!!problem || !touched}
        run={async (say) => {
          let uri = '';
          if (state.useOwn) uri = state.own.trim();
          else if (hasContent(state.file) || state.picture) { say(state.picture ? 'Uploading the picture…' : 'Saving the file…'); uri = await saveLaunchFile(await withUploadedPicture(state.file, state.picture)); }
          if (uri === launch.metadataURI) return { text: 'Nothing changed.' };
          return run({ functionName: 'setMetadata', args: [launch.token, uri] }, 'Saved.')(say);
        }} />
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
