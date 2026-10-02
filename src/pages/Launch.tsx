// Create a token: the identity (name, ticker, picture, description, links), the tax, the supply and opening price,
// and an optional first buy, with a live preview beside the form. "Review" opens a summary to check before one
// transaction launches it; the dialog then follows it through the wallet to the token's page.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { LAUNCH_LIMITS, SentButUnconfirmedError, checkLaunchParams, getLaunch, launch, operationIn, vyrePadAbi, type LaunchParams } from '@vyrechain/sdk';
import { getAddress, isAddress, isAddressEqual, parseEventLogs, type Hash, type TransactionReceipt } from 'viem';
import { EXPLORER, reason, vyre } from '../lib/chain';
import { amountProblem, exact, iso, parse, pct, percentBps, plainText, price, short, tokenText, usd } from '../lib/format';
import { href } from '../lib/router';
import { useEmailCantTrade, useWallet } from '../lib/wallet';
import { addresses } from '../lib/market';
import { forgetLaunch, kept, mayTakePlace, onLaunchMemory, placeOf, recentLaunch, resolveEarlier, type Place } from '../lib/faceid';
import { ConnectButton, EmailTradeNote } from '../components/ui';
import { MintaMark, VyreGlyph } from '../components/Brand';
import { LaunchFileFields, emptyLaunchFile, hasPicture, launchFileProblem, type LaunchFileState } from '../components/LaunchFileFields';
import { hasContent, saveLaunchFile, withUploadedPicture } from '../lib/api';

/** USDC (18 decimals): every launch opens at this market cap, a rule of VyrePad itself (the project's call, 2026-09-30) */
const OPENING_MARKET_CAP = LAUNCH_LIMITS.openingMarketCap;

const E18 = 10n ** 18n;
const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
/**
 * The launch a transaction made for `creator`: for a Face ID wallet's operation (`op`), only in that operation's own
 * logs (a bundle can carry other operations, the same wallet's too)
 */
function launchIn(receipt: TransactionReceipt, creator: Address | null, op?: Hash) {
  const logs = op ? operationIn(receipt, ENTRY_POINT, op)?.logs ?? [] : receipt.logs;
  return parseEventLogs({ abi: vyrePadAbi, eventName: 'LaunchCreated', logs })
    .find((e) => isAddressEqual(e.address, addresses().pad) && (!creator || isAddressEqual(e.args.creator, creator)));
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
/** A typed tax as it will be sent ("2.5%"), or a dash while it isn't a plain percent with at most two decimals */
const taxText = (s: string) => (Number.isInteger(percentBps(s)) ? pct(percentBps(s)) : '—');
const TAX_PROBLEM = 'Set a tax on buys and on sells: 0 to 10%, with at most two decimals (like 2.5).';
/** 1,000,000,000 as 1B (a whole-token count from an 18-decimal amount), for a small box */
const compact = (v: bigint) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(v / E18));
const TOOK_PLACE = 'That launch didn’t run: another transaction from your wallet took its place, so nothing was created by it. Check Portfolio for your launches before creating it again.';
const STILL_WAITING = {
  device: 'Still waiting? You can close this. Your wallet’s next transaction from this device looks for this one first, and after two minutes can take its place, so it can’t launch twice from here.',
  page: 'Still waiting? Keep this page open: this browser isn’t keeping site data right now, so only this page knows to look for it first. Your wallet’s next transaction from here does, and after two minutes can take its place.',
  no: 'Still waiting? Check it again in a moment, and look at your wallet on the explorer before creating it again.',
} as const;
const BEHIND = 'That launch was sent before the test network was reset, so it isn’t on the chain now. You can create it again.';
const FAILED = 'That launch failed on chain. Nothing was created; you can try again.';
const PRESETS = [
  { key: 'none', label: 'No tax', buy: '0', sell: '0' },
  { key: 'low', label: '1% / 1%', buy: '1', sell: '1' },
  { key: 'mid', label: '3% / 3%', buy: '3', sell: '3' },
  { key: 'high', label: '5% / 5%', buy: '5', sell: '5' },
  { key: 'custom', label: 'Custom', buy: '', sell: '' },
] as const;
type PresetKey = (typeof PRESETS)[number]['key'];

/**
 * A launch sent but not confirmed yet: its transaction, and the ticker it was sent with. For a Face ID wallet, the
 * operation's hash and where to look for it (`op`): its wallet, its place in the wallet's sequence, a block from before
 */
type Op = { sender: string; nonce: string; fromBlock: string };
type Sent = { hash: string; symbol: string; op?: Op };
// kept while the app is open (leaving this page and coming back still shows it), so it's checked rather than sent twice
let unconfirmed: Sent | null = null;
/** A launch confirmed while the app is open (kept like `unconfirmed`), and whether one is waiting in the wallet: the form
 * asks before sending another, so closing the dialog or leaving the page can't lead to a second launch by mistake */
type Launched = { token: Address; hash: string; symbol: string };
let launched: Launched | null = null;
let inWallet = false;
/** A Face ID launch put aside on this page (checked from another wallet): it may still go through, so the form says so
 * and asks before launching again */
type Aside = { symbol: string; sender: string };
let aside: Aside | null = null;
// all three are kept for this tab across a reload too (checked field by field when read back)
const KEEP = 'vyre.launch';
function keep(): void {
  try { sessionStorage.setItem(KEEP, JSON.stringify({ unconfirmed, launched, aside })); } catch { /* private mode */ }
}
try {
  const k = JSON.parse(sessionStorage.getItem(KEEP) || 'null') as { unconfirmed?: Partial<Sent>; launched?: Partial<Launched>; aside?: Partial<Aside> } | null;
  const hash = (h: unknown): h is string => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
  const sym = (x: unknown): x is string => typeof x === 'string' && x.length <= 64;
  const o = k?.unconfirmed?.op as Partial<Op> | undefined;
  const op = o && typeof o.sender === 'string' && isAddress(o.sender, { strict: false }) && /^\d{1,78}$/.test(String(o.nonce)) && /^\d{1,20}$/.test(String(o.fromBlock))
    ? { sender: getAddress(o.sender), nonce: String(o.nonce), fromBlock: String(o.fromBlock) } : undefined;
  if (k?.unconfirmed && hash(k.unconfirmed.hash) && sym(k.unconfirmed.symbol)) unconfirmed = { hash: k.unconfirmed.hash, symbol: k.unconfirmed.symbol, ...(op ? { op } : {}) };
  if (k?.launched && hash(k.launched.hash) && sym(k.launched.symbol) && typeof k.launched.token === 'string' && isAddress(k.launched.token, { strict: false })) {
    launched = { token: getAddress(k.launched.token), hash: k.launched.hash, symbol: k.launched.symbol };
  }
  if (k?.aside && sym(k.aside.symbol) && typeof k.aside.sender === 'string' && isAddress(k.aside.sender, { strict: false })) {
    aside = { symbol: k.aside.symbol, sender: getAddress(k.aside.sender) };
  }
} catch { /* nothing kept */ }

export default function Launch() {
  const { account, faceId } = useWallet();
  const emailCantTrade = useEmailCantTrade();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [preset, setPreset] = useState<PresetKey>('low');
  const [buyTax, setBuyTax] = useState('1');
  const [sellTax, setSellTax] = useState('1');
  const [firstBuy, setFirstBuy] = useState('');
  const [meta, setMeta] = useState<LaunchFileState>(emptyLaunchFile);
  const [reviewing, setReviewing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [sent, setSentState] = useState<Sent | null>(unconfirmed);
  const setSent = (s: Sent | null) => { unconfirmed = s; keep(); setSentState(s); };
  // (a Face ID wallet's launch found by its next transaction, on any page or tab of this device, counts too)
  const [recent, setRecent] = useState<Launched | null>(() => launched ?? (faceId ? recentLaunch(faceId.address) : null));
  // what the dialog said as it closed (a launch that didn't run, with the form's details gone): shown on the form
  const [notice, setNotice] = useState('');
  const [waiting, setWaiting] = useState(inWallet);
  const [asideState, setAside] = useState<Aside | null>(aside);
  // what the dialog left behind (it may have finished after this page was left and opened again)
  const sync = () => { setRecent(launched ?? (faceId ? recentLaunch(faceId.address) : null)); setSentState(unconfirmed); setWaiting(inWallet); setAside(aside); };
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (!inWallet) sync(); }, 1000);
    return () => clearInterval(t);
  }, [waiting]);
  // a launch found from another tab, or another wallet signed in: the form catches up
  useEffect(() => onLaunchMemory(sync), [faceId?.address]);
  useEffect(() => { sync(); }, [faceId?.address]);

  const pick = (k: PresetKey) => {
    setPreset(k);
    const p = PRESETS.find((x) => x.key === k)!;
    if (k !== 'custom') { setBuyTax(p.buy); setSellTax(p.sell); }
  };
  const params: LaunchParams | null = useMemo(() => {
    const totalSupply = parse(supply), fb = firstBuy.trim() ? parse(firstBuy) : 0n;
    if (totalSupply === null || fb === null) return null;
    return {
      // without bidi controls or hidden characters (they'd only disguise it: every page shows it without them)
      name: tokenText(name), symbol: tokenText(symbol), totalSupply, startingMarketCap: OPENING_MARKET_CAP,
      buyTaxBps: percentBps(buyTax), sellTaxBps: percentBps(sellTax),
      firstBuyUsdc: fb || undefined,
    };
  }, [name, symbol, supply, buyTax, sellTax, firstBuy]);

  const problem = useMemo(() => {
    if (!params) {
      const bad = ([['Supply', supply], ['Dev buy', firstBuy]] as const).find(([, v]) => amountProblem(v));
      return bad ? `${bad[0]}: ${amountProblem(bad[1])}` : 'Fill in the supply.';
    }
    if (!params.name) return 'Give it a name.';
    if (!params.symbol) return 'Give it a ticker.';
    if (bytes(params.name) > LAUNCH_LIMITS.maxNameBytes) return `The name is too long (${LAUNCH_LIMITS.maxNameBytes} bytes at most).`;
    if (bytes(params.symbol) > LAUNCH_LIMITS.maxSymbolBytes) return `The ticker is too long (${LAUNCH_LIMITS.maxSymbolBytes} bytes at most).`;
    if (!Number.isInteger(params.buyTaxBps) || !Number.isInteger(params.sellTaxBps)) return TAX_PROBLEM;
    const fileProblem = launchFileProblem(meta);
    if (fileProblem) return fileProblem;
    try { checkLaunchParams(params); } catch (e) { return (e as Error).message; }
    return '';
  }, [params, meta, supply, firstBuy]);

  // USDC per token; as floats, which keep their digits for a quadrillion tokens at $100 (integer math at 1e12 didn't)
  const openPrice = params && params.totalSupply > 0n ? Number(OPENING_MARKET_CAP) / Number(params.totalSupply) : 0;

  // The form is five steps. Each step's own problem (what "Next" checks) is worked out apart from `problem` above, which
  // stays the one check made before anything is sent
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [tried, setTried] = useState<number[]>([]);
  const stepProblems = useMemo<string[]>(() => {
    const nm = tokenText(name), sy = tokenText(symbol);
    const s0 = !nm ? 'Give it a name.' : !sy ? 'Give it a ticker.'
      : bytes(nm) > LAUNCH_LIMITS.maxNameBytes ? `The name is too long (${LAUNCH_LIMITS.maxNameBytes} bytes at most).`
      : bytes(sy) > LAUNCH_LIMITS.maxSymbolBytes ? `The ticker is too long (${LAUNCH_LIMITS.maxSymbolBytes} bytes at most).`
      : launchFileProblem(meta, 'info');
    const s1 = amountProblem(firstBuy) ? `Dev buy: ${amountProblem(firstBuy)}` : '';
    let s2 = '';
    const ts = parse(supply);
    if (ts === null) s2 = amountProblem(supply) ? `Supply: ${amountProblem(supply)}` : 'Fill in the supply.';
    else if (!Number.isInteger(percentBps(buyTax)) || !Number.isInteger(percentBps(sellTax))) s2 = TAX_PROBLEM;
    else if (ts < LAUNCH_LIMITS.minSupply || ts > LAUNCH_LIMITS.maxSupply) s2 = 'The supply must be 1,000 to 1,000,000,000,000,000 tokens.';
    else if (percentBps(buyTax) < 0 || percentBps(sellTax) < 0 || percentBps(buyTax) > LAUNCH_LIMITS.maxTaxBps || percentBps(sellTax) > LAUNCH_LIMITS.maxTaxBps) s2 = 'Taxes can be 0 to 10%.';
    else {
      try { checkLaunchParams({ name: 'x', symbol: 'x', totalSupply: ts, startingMarketCap: OPENING_MARKET_CAP, buyTaxBps: percentBps(buyTax), sellTaxBps: percentBps(sellTax) }); } catch (e) { s2 = (e as Error).message; }
    }
    return [s0, s1, s2, launchFileProblem(meta, 'own'), ''];
  }, [name, symbol, supply, buyTax, sellTax, firstBuy, meta]);
  const firstBad = stepProblems.findIndex((x) => x);
  const goTo = (i: number) => {
    // forwards only as far as the first step that still has a problem
    const to = firstBad >= 0 && i > firstBad ? firstBad : i;
    if (to < i) setTried((t) => (t.includes(to) ? t : [...t, to]));
    setStep(to);
    setReached((r) => Math.max(r, to));
  };
  const next = () => {
    if (stepProblems[step]) { setTried((t) => (t.includes(step) ? t : [...t, step])); return; }
    goTo(step + 1);
  };
  // a launch waiting, sent or made: the last step (where the notices and the button are) comes up
  useEffect(() => { if (sent || waiting || recent || asideState) { setStep(STEP_LABELS.length - 1); setReached(STEP_LABELS.length - 1); } }, [!!sent, waiting, !!recent, !!asideState]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in a field moves to the next step; only the last step sends anything to the review
    if (step < STEP_LABELS.length - 1) { next(); return; }
    // a launch already sent and not confirmed: the dialog checks it, never sends another
    setNotice('');
    if (sent) { if (account) setReviewing(true); return; }
    if (waiting) return;
    // after a launch (or one put aside), "Launch another" first clears it: the same details are never sent twice by a
    // stray click
    if (recent || asideState) {
      launched = null; aside = null; keep(); if (faceId) forgetLaunch(faceId.address); setRecent(null); setAside(null); return;
    }
    setTouched(true);
    if (firstBad >= 0) { setTried((t) => (t.includes(firstBad) ? t : [...t, firstBad])); return; }
    if (!problem && account) setReviewing(true);
  };
  const showProblem = (i: number) => (tried.includes(i) && stepProblems[i] ? <p className="err small" role="alert">{stepProblems[i]}</p> : null);

  const isLast = step === STEP_LABELS.length - 1;
  const ready = !problem && reached >= STEP_LABELS.length - 1;
  const imgSet = meta.useOwn ? !!meta.own.trim() : hasPicture(meta);
  const linkCount = meta.useOwn ? 0 : Object.values(meta.file.links || {}).filter((v) => v?.trim()).length;
  const linkSet = linkCount > 0;
  const checks: [string, boolean][] = [
    ['Token details filled in', !!tokenText(name) && !!tokenText(symbol) && !stepProblems[0]],
    ['Logo added', imgSet],
    ['Social links added', linkSet || (meta.useOwn && !!meta.own.trim())],
    ['Launch settings configured', reached >= 2 && !stepProblems[1]],
    ['Tokenomics set', reached >= 3 && !stepProblems[2]],
    ['Ready to launch', ready],
  ];

  return (
    <section className="create">
      <div className="create-bg" aria-hidden="true" />
      <div className="create-grid">
        <div className="create-main">
          <p className="eyebrow accent">Create a launch</p>
          <h1 className="display">Bring your idea<br />to <em>VYRE.</em></h1>
          <p className="lede">Launch your token on MINTA in a few steps.<br />One transaction, live at once, with locked liquidity.</p>
        <form className="wz" onSubmit={submit} noValidate>
          <ol className="wz-steps" aria-label="Steps">
            {STEP_LABELS.map(([title, sub], i) => (
              <li key={title} className={i === step ? 'now' : i < reached && !stepProblems[i] ? 'done' : ''}>
                <button type="button" onClick={() => goTo(i)} aria-current={i === step ? 'step' : undefined}>
                  <span className="wz-dot" aria-hidden="true">{i < step && !stepProblems[i] ? '✓' : i + 1}</span>
                  <span className="wz-label"><b>{title}</b><small>{sub}</small></span>
                </button>
              </li>
            ))}
          </ol>

          <div className="wz-panel">
            {/* (a launch sent, waiting, made or put aside is said on every step) */}
            {notice && !sent && <p className="err small" role="alert">{notice}</p>}
            {sent && (
              <p className="note small" role="status">Your launch of $<bdi>{tokenText(sent.symbol)}</bdi> was sent and isn’t confirmed yet. Check it before creating another: {sent.op
                ? <a href={`${EXPLORER}/address/${sent.op.sender}`} target="_blank" rel="noopener noreferrer">see your wallet on the explorer</a>
                : <a href={`${EXPLORER}/tx/${sent.hash}`} target="_blank" rel="noopener noreferrer">see it on the explorer</a>}.</p>
            )}
            {!sent && waiting && (
              <p className="note small" role="status">{faceId
                ? 'A launch is waiting for your Face ID: confirm or cancel it first.'
                : <>A launch is on its way to your wallet: confirm or reject it there first. Nothing in your wallet? <button type="button" className="linkish" onClick={() => window.location.reload()}>Reload the page</button> to start again.</>}</p>
            )}
            {!sent && !waiting && recent && (
              <p className="note small" role="status">You launched $<bdi>{tokenText(recent.symbol)}</bdi>: <a href={href({ page: 'token', token: recent.token })}>open its page</a>. To launch another token, press Launch another.</p>
            )}
            {!sent && !waiting && !recent && asideState && (
              <p className="note small" role="status">Your launch of $<bdi>{tokenText(asideState.symbol)}</bdi> from the Face ID wallet {short(asideState.sender)} was put aside, and it may still go through: <a href={`${EXPLORER}/address/${asideState.sender}`} target="_blank" rel="noopener noreferrer">see that wallet on the explorer</a>. To launch a token anyway, press Launch another.</p>
            )}

            {step === 0 && (
              <fieldset className="wz-step">
                <legend className="h3">Token info <span className="muted small">Set up the basic information for your token.</span></legend>
                <div className="two">
                  <label className="field"><span>Token name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="My Token" /></label>
                  <label className="field"><span>Token symbol</span>
                    <div className="prefix"><span aria-hidden="true">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/^\$/, '').toUpperCase())} maxLength={16} placeholder="MYT" /></div>
                  </label>
                </div>
                <LaunchFileFields value={meta} onChange={setMeta} part="info" />
                {showProblem(0)}
              </fieldset>
            )}

            {step === 1 && (
              <fieldset className="wz-step">
                <legend className="h3">Launch settings <span className="muted small">How your launch works.</span></legend>
                <dl className="setting-cards">
                  <div><dt>Launch type</dt><dd>Instant</dd><small>One transaction; trading opens at once, with no approval or waiting.</small></div>
                  <div><dt>Opening market cap</dt><dd>{usd(Number(OPENING_MARKET_CAP / E18))}</dd><small>The same for every launch on MINTA.</small></div>
                  <div><dt>Liquidity</dt><dd>Locked</dd><small>The whole supply goes into the pool, and its liquidity can’t be removed.</small></div>
                </dl>
                <label className="field"><span>Dev buy <span className="muted">(optional, USDC)</span></span>
                  <input inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} placeholder="0" />
                  <small className="muted">Bought in the launch transaction, before anyone else can trade, at your own tax plus the 1% platform fee. Leave it at 0 for none.</small>
                </label>
                {showProblem(1)}
              </fieldset>
            )}

            {step === 2 && (
              <fieldset className="wz-step">
                <legend className="h3">Tokenomics <span className="muted small">Supply and tax.</span></legend>
                <div className="two">
                  <label className="field"><span>Supply (tokens)</span><input inputMode="decimal" value={supply} onChange={(e) => setSupply(e.target.value)} /><small className="muted">1,000 to 1,000,000,000,000,000.</small></label>
                  <div className="field"><span>Price at launch</span><b className="block">{price(openPrice)}</b><small className="muted">Supply sets the price: {usd(Number(OPENING_MARKET_CAP / E18))} market cap divided by the supply.</small></div>
                </div>
                <div className="field"><span>Your tax on each buy and sale</span>
                  <small className="muted">Paid to you in USDC, 0 to 10% each. You can lower it later, never raise it. Every trade also pays the 1% platform fee.</small>
                </div>
                <div className="tabs presets" role="group" aria-label="Tax preset">
                  {PRESETS.map((p) => <button key={p.key} type="button" className={preset === p.key ? 'on' : ''} aria-pressed={preset === p.key} onClick={() => pick(p.key)}>{p.label}</button>)}
                </div>
                {preset === 'custom' && (
                  <div className="two">
                    <label className="field"><span>Buy tax (%)</span><input inputMode="decimal" value={buyTax} onChange={(e) => setBuyTax(e.target.value)} placeholder="0 to 10" /></label>
                    <label className="field"><span>Sell tax (%)</span><input inputMode="decimal" value={sellTax} onChange={(e) => setSellTax(e.target.value)} placeholder="0 to 10" /></label>
                  </div>
                )}
                <p className="small muted">After launch you can split the tax between up to 4 wallets, on the token’s Manage page.</p>
                {showProblem(2)}
              </fieldset>
            )}

            {step === 3 && (
              <fieldset className="wz-step">
                <legend className="h3">Media &amp; links <span className="muted small">Brand your project.</span></legend>
                <dl className="brand-summary">
                  <div><dt>Logo</dt><dd>{imgSet ? 'Added' : 'Not added'}</dd><button type="button" className="linkish small" onClick={() => goTo(0)}>Edit</button></div>
                  <div><dt>Links</dt><dd>{linkCount} of 4</dd><button type="button" className="linkish small" onClick={() => goTo(0)}>Edit</button></div>
                </dl>
                <p className="small muted">They show on the token’s page. Everything here is optional, and you can change them later on its Manage page.</p>
                <LaunchFileFields value={meta} onChange={setMeta} part="own" />
                {showProblem(3)}
              </fieldset>
            )}

            {step === 4 && (
              <fieldset className="wz-step">
                <legend className="h3">Review &amp; launch <span className="muted small">Final check.</span></legend>
                <dl className="review-list">
                  <div><dt>Token</dt><dd><b>$<bdi>{tokenText(symbol) || '—'}</bdi></b> <bdi>{tokenText(name)}</bdi></dd></div>
                  <div><dt>Supply</dt><dd>{params ? `${exact(params.totalSupply)} tokens` : '—'}</dd></div>
                  <div><dt>Opening market cap</dt><dd>{usd(Number(OPENING_MARKET_CAP / E18))} ({price(openPrice)} a token)</dd></div>
                  <div><dt>Buy / sell tax</dt><dd>{taxText(buyTax)} / {taxText(sellTax)}, plus the 1% platform fee each way</dd></div>
                  <div><dt>Dev buy</dt><dd>{params?.firstBuyUsdc ? `${exact(params.firstBuyUsdc)} USDC` : 'None'}</dd></div>
                  <div><dt>Picture and links</dt><dd>{meta.useOwn ? (meta.own ? 'Your own file' : 'None') : hasContent(meta.file) || meta.picture ? 'Saved with the launch' : 'None (add them any time)'}</dd></div>
                </dl>
                {touched && problem && !sent && <p className="err small" role="alert">{problem}{firstBad >= 0 && <> <button type="button" className="linkish" onClick={() => goTo(firstBad)}>Go to that step</button>.</>}</p>}
                {!account ? <ConnectButton /> : emailCantTrade ? <EmailTradeNote /> : (
                  <button className="btn btn-accent btn-wide" type="submit" disabled={!sent && waiting}>{sent ? 'Check it' : recent || asideState ? 'Launch another' : 'Review'}</button>
                )}
                <p className="small muted">You’ll see every detail once more, then confirm in your wallet.</p>
              </fieldset>
            )}

            <div className="wz-actions">
              {step > 0 && <button type="button" className="btn btn-line" onClick={() => goTo(step - 1)}>Back</button>}
              {!isLast && <button type="button" className="btn btn-accent wz-next" onClick={next}>Next step <span aria-hidden="true">→</span></button>}
            </div>
            {!isLast && <p className="small muted wz-hint">You’ll set the rest of the details in the next steps.</p>}
          </div>
        </form>
        </div>

        <aside className="create-side" aria-label="Preview">
          <Preview name={name} symbol={symbol} meta={meta} params={params} buyTax={buyTax} sellTax={sellTax} openPrice={openPrice} checks={checks} />
        </aside>
      </div>

      {/* (once open, it stays up until closed, even if the details change or a sent launch is confirmed meanwhile) */}
      {reviewing && account && (
        <Review params={problem ? null : params} meta={meta} creator={account} openPrice={openPrice} sent={sent} onSent={setSent}
          onClose={(why) => { setReviewing(false); sync(); setNotice(why || ''); if (why) setTouched(true); }} />
      )}
    </section>
  );
}

const STEP_LABELS: [string, string][] = [
  ['Token info', 'Basic details'],
  ['Launch settings', 'How it launches'],
  ['Tokenomics', 'Supply & tax'],
  ['Media & links', 'Brand your project'],
  ['Review & launch', 'Final check'],
];

const LINK_ICONS: Record<string, string> = {
  website: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M4 12h16M12 4c2.5 2.2 3.5 5 3.5 8s-1 5.8-3.5 8c-2.5-2.2-3.5-5-3.5-8s1-5.8 3.5-8',
  x: 'M5 4l14 16M19 4 5 20',
  telegram: 'M20 5 3.5 11.5l5 1.8L10 19l3-3.5 4.5 3.3z M8.5 13.3 17 8',
  discord: 'M8 8c2.5-1 5.5-1 8 0 1.3 2.2 2 4.4 2.2 6.8-1.3 1-2.6 1.6-4 2l-.9-1.7M8 8c-1.3 2.2-2 4.4-2.2 6.8 1.3 1 2.6 1.6 4 2l.9-1.7M9.5 12.5h.01M14.5 12.5h.01',
};

function Preview({ name, symbol, meta, params, buyTax, sellTax, openPrice, checks }: {
  name: string; symbol: string; meta: LaunchFileState; params: LaunchParams | null; buyTax: string; sellTax: string; openPrice: number;
  checks: [string, boolean][];
}) {
  const img = meta.useOwn ? '' : meta.picture?.preview || (/^(https:\/\/|ipfs:\/\/)\S+$/.test(meta.file.image?.trim() || '') ? meta.file.image!.trim().replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/') : '');
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [img]);
  const links = meta.useOwn ? {} : meta.file.links || {};
  const desc = !meta.useOwn && meta.file.description && plainText(meta.file.description) ? plainText(meta.file.description) : '';
  const blank = meta.useOwn && meta.own ? 'Picture and links from your own file.' : 'Tell the community about your project…';
  return (
    <div className="preview">
      <div className="preview-head"><span className="pv-live"><span className="dot on" aria-hidden="true" />Live Preview</span><span className="chain-chip"><VyreGlyph size={16} />VYRE CHAIN</span></div>
      <div className="pv-banner">
        <span className="pv-logo">
          {img && !broken
            ? <img src={img} alt="" width={132} height={132} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
            : <MintaMark size={78} />}
        </span>
        <div className="pv-id">
          <b className="pv-name"><bdi>{tokenText(name) || 'My Token'}</bdi></b>
          <span className="pv-sym"><bdi>{tokenText(symbol) || 'MYT'}</bdi></span>
          <p className={desc ? 'pv-desc-line' : 'pv-desc-line muted'} dir="auto">{desc || blank}</p>
          <span className="pv-socials" aria-label="Links">
            {Object.keys(LINK_ICONS).map((k) => (
              <span key={k} className={links[k as keyof typeof links]?.trim() ? 'on' : ''} title={k}><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={LINK_ICONS[k]} /></svg></span>
            ))}
          </span>
        </div>
      </div>
      <dl className="pv-stats">
        <div><dt>Total supply</dt><dd title={params ? exact(params.totalSupply) : undefined}>{params ? compact(params.totalSupply) : '—'}</dd><small>{tokenText(symbol) || 'MYT'}</small></div>
        <div><dt>Launch type</dt><dd>Instant</dd><small>MINTA</small></div>
        <div><dt>Chain</dt><dd className="pv-chain"><VyreGlyph size={22} />VYRE</dd></div>
      </dl>
      <div className="pv-box">
        <b>Token Description</b>
        <p className={desc ? 'small' : 'small muted'} dir="auto">{desc || blank}</p>
        <dl className="facts">
          <div><dt>Price</dt><dd>{price(openPrice)}</dd></div>
          <div><dt>Market cap</dt><dd>{usd(Number(OPENING_MARKET_CAP / E18))}</dd></div>
          <div><dt>Buy / sell tax</dt><dd>{taxText(buyTax)} / {taxText(sellTax)}</dd></div>
          <div><dt>Liquidity</dt><dd>Locked</dd></div>
        </dl>
      </div>
      <div className="pv-box checklist">
        <h2 className="pv-check-title"><span className="tick on" aria-hidden="true">✓</span>Launch Checklist</h2>
        <ul>{checks.map(([label, ok]) => <li key={label} className={ok ? 'ok' : ''}><span className="tick" aria-hidden="true">✓</span>{label}</li>)}</ul>
      </div>
    </div>
  );
}

type Step = 'review' | 'confirm' | 'wait' | 'ready';
const STEPS: { key: Step; label: string }[] = [
  { key: 'review', label: 'Review' },
  { key: 'confirm', label: 'Confirm' },
  { key: 'wait', label: 'Wait' },
  { key: 'ready', label: 'Ready' },
];

const UNREAD = 'The launch was sent; its result isn’t readable yet. Check again in a moment: checking doesn’t send anything.';

/**
 * The launch dialog. `sent` is a launch already sent and not confirmed (kept by the page): then the dialog only checks
 * it, and it can't be dismissed by Escape or a click outside, so the hash is never lost and nothing is sent twice.
 */
function Review({ params, meta, creator, openPrice, sent, onSent, onClose }: {
  params: LaunchParams | null; meta: LaunchFileState; creator: Address; openPrice: number;
  sent: Sent | null; onSent: (s: Sent | null) => void; onClose: (why?: string) => void;
}) {
  const { account, onVyre, faceId } = useWallet();
  const [step, setStep] = useState<Step>(sent ? 'wait' : 'review');
  const [note, setNote] = useState(sent ? 'Sent. Waiting for it to be confirmed…' : '');
  const [err, setErr] = useState('');
  // an earlier Face ID transaction found to have gone through: its link, beside the message
  const [earlierHash, setEarlierHash] = useState('');
  // the picture-and-links file couldn't be saved: offer to launch without it (the API never holds a launch up)
  const [fileFailed, setFileFailed] = useState(false);
  // a check found no receipt yet: offer to start over, for a launch that never reached the chain
  const [checked, setChecked] = useState(false);
  // the check found its place in the wallet's sequence taken, but couldn't read by what: never offered again then
  const [taken, setTaken] = useState(false);
  // `said`: how it came to be shown, when it isn't the launch just sent (one that went through earlier, or in its place)
  const [done, setDone] = useState<{ token: Address; hash: string; symbol: string; said?: string } | null>(null);
  // the review is for a launch taking the place of the one sent (`sent`, kept until the new one is sent)
  const [replacing, setReplacing] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [stay, setStay] = useState(false);
  const [secs, setSecs] = useState(4);
  const box = useRef<HTMLDivElement>(null);
  const switched = !!account && account.toLowerCase() !== creator.toLowerCase();
  // in the wallet, going through, or sent and not confirmed: Escape and clicks outside don't close it
  const locked = step === 'confirm' || (step === 'wait' && (!err || (!!sent && !done)));

  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onClose(); };
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [locked, onClose]);

  // opened on a launch sent earlier: check it at once
  useEffect(() => { if (sent) checkSent(sent); }, []);

  // once the page is ready, open it after a few seconds unless the creator chose to stay
  useEffect(() => {
    if (!pageReady || stay || !done) return;
    if (secs <= 0) { window.location.hash = href({ page: 'token', token: done.token }); return; }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [pageReady, stay, secs, done]);

  // back to the review (or the form, with the message, if its details were changed or are gone: the page was left
  // and opened again), with the page's hash cleared
  const startOver = (why: string) => {
    onSent(null);
    setChecked(false);
    if (!params) { onClose(why); return; }
    setStep('review');
    setErr(why);
  };
  const shown = (token: Address, hash: string, symbol: string, said?: string) => {
    setDone({ token, hash, symbol, said });
    launched = { token, hash, symbol };
    keep();
    onSent(null);
  };

  // a launch sent but not yet confirmed (the RPC didn't answer in time): find its token from the transaction's receipt
  const checkSent = async (s: Sent) => {
    setErr('');
    setNote('Checking the launch…');
    let tookPlace = false, wentThrough = false;
    try {
      let txHash = s.hash as `0x${string}`;
      if (s.op) {
        // a Face ID wallet's operation: what took its place in the wallet's sequence, read from the chain. This launch
        // (or a launch sent in its place) is shown and what's written down for that place crossed out; anything else
        // that took the place is left written down, for the wallet's next transaction to report (it went through)
        const sender = s.op.sender as Address, nonce = BigInt(s.op.nonce);
        const p = await placeOf(sender, nonce, BigInt(s.op.fromBlock));
        if (p.state === 'pending') throw new Error('not mined yet');
        if (p.state === 'behind') { resolveEarlier(sender, nonce); startOver(BEHIND); return; }
        if (!p.op || !p.hash) { startOver(TOOK_PLACE); return; }
        const mine = p.op.toLowerCase() === s.hash.toLowerCase();
        tookPlace = !mine;
        wentThrough = mine;
        if (mine && !p.success) { resolveEarlier(sender, nonce); startOver(FAILED); return; }
        const receipt = await vyre.getTransactionReceipt({ hash: p.hash });
        // (a receipt that doesn't hold the operation is taken as unreadable, never as "no launch")
        if (!operationIn(receipt, ENTRY_POINT, p.op)) throw new Error('unreadable');
        const created = p.success ? launchIn(receipt, sender, p.op) : undefined;
        if (!created && !mine) { startOver(TOOK_PLACE); return; }
        resolveEarlier(sender, nonce);
        if (!created) { onSent(null); setErr('It went through but made no launch. Check it on the explorer.'); return; }
        shown(created.args.token, p.hash, created.args.symbol, mine ? undefined : 'A launch sent for the same place in your wallet’s sequence went through: this one.');
        await checkPage(created.args.token);
        return;
      }
      const receipt = await vyre.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') { startOver('That launch transaction failed on chain. Nothing was created; you can try again.'); return; }
      const created = launchIn(receipt, null);
      if (!created) { onSent(null); setErr('It went through but made no launch. Check it on the explorer.'); return; }
      // (the ticker from the chain: what ran is what's shown)
      shown(created.args.token, txHash, created.args.symbol);
      await checkPage(created.args.token);
    } catch {
      setChecked(true);
      setTaken((t) => t || tookPlace || wentThrough); // (a taken place never opens again)
      setNote(tookPlace || wentThrough ? 'Checking the launch…' : 'Sent. Waiting for it to be confirmed…');
      setErr(wentThrough ? 'Your launch went through, but its details couldn’t be read just now. Check again in a moment: checking doesn’t send anything.'
        : tookPlace ? 'Something from your wallet took this launch’s place, but it couldn’t be read just now. Check again in a moment: checking doesn’t send anything.' : UNREAD);
    }
  };

  const checkPage = async (token: Address) => {
    setErr('');
    const l = await getLaunch(vyre, token).catch(() => null);
    if (l) { setPageReady(true); setStep('ready'); }
    else setErr('The token page isn’t showing yet. Check again in a moment: checking doesn’t create another token.');
  };

  const create = async (withFile = true) => {
    if (!params || inWallet) return;
    // with a launch sent and not confirmed, only one taking its place (and only from the wallet that sent it)
    const place = replacing && sent?.op ? { sender: sent.op.sender as Address, nonce: BigInt(sent.op.nonce), fromBlock: BigInt(sent.op.fromBlock) } : null;
    if (sent && !place) return;
    setErr('');
    setEarlierHash('');
    setFileFailed(false);
    if (place && (!faceId || !account || !isAddressEqual(account, place.sender))) {
      setErr(`Sign in with the Face ID wallet that sent the first launch (${short(place.sender)}). Nothing was sent.`);
      return;
    }
    // a launch by this wallet found meanwhile (by another tab's next transaction): shown on the form, nothing sent
    const found = faceId && !place ? recentLaunch(faceId.address) : null;
    if (found) { onClose(`Nothing was sent: this wallet launched $${tokenText(found.symbol)} a moment ago (below).`); return; }
    // from here until it settles (saving the file, switching networks, the wallet), the form won't offer another launch
    inWallet = true;
    keep();
    try {
      setStep('confirm');
      if (place && sent) {
        // the first launch, looked for once more: if anything took its place meanwhile, that's shown and nothing sent
        setNote('Checking the first launch…');
        let p: Place;
        try { p = await placeOf(place.sender, place.nonce, place.fromBlock); } catch {
          setStep('review');
          setErr('The first launch couldn’t be checked just now, so nothing was sent. Try again in a moment.');
          return;
        }
        if (p.state !== 'pending') { setReplacing(false); setStep('wait'); await checkSent(sent); return; }
      }
      let metadataURI: string | undefined;
      if (meta.useOwn) metadataURI = meta.own.trim() || undefined;
      else if (withFile && (hasContent(meta.file) || meta.picture)) {
        setNote(meta.picture ? 'Uploading the picture…' : 'Saving the picture and links…');
        try {
          metadataURI = await saveLaunchFile(await withUploadedPicture(meta.file, meta.picture));
        } catch (e) {
          // nothing sent: back to the review, with the choice to launch without them now
          setStep('review');
          setFileFailed(true);
          setErr(reason(e));
          return;
        }
      }
      const w = await onVyre(place ? { sender: place.sender, nonce: place.nonce } : undefined);
      setNote(faceId ? 'Confirm the launch with Face ID.' : 'Approve the launch in your wallet.');
      const r = await launch(w, vyre, { ...params, metadataURI });
      launched = { token: r.token, hash: r.hash, symbol: params.symbol };
      inWallet = false;
      keep();
      // (in the first one's place: it can't run now, and the record of that place was crossed out when this was mined)
      onSent(null);
      setReplacing(false);
      setDone({ token: r.token, hash: r.hash, symbol: params.symbol });
      setStep('wait');
      setNote('Launched. Opening the token page…');
      await checkPage(r.token);
    } catch (e) {
      if (e instanceof SentButUnconfirmedError) {
        // it was sent: never offer to send it again, only to check it (the page keeps it too, if this closes)
        // (in the first one's place: the same place in the sequence, so checking this one finds whichever ran)
        const o = e.userOperation ? e.operation : undefined;
        // (a replacement looks from the first launch's block: whichever of the two ran, it's found)
        const fromBlock = o && place && place.fromBlock < o.fromBlock ? place.fromBlock : o?.fromBlock;
        onSent({ hash: e.hash, symbol: params.symbol, ...(o ? { op: { sender: o.sender, nonce: o.nonce.toString(), fromBlock: fromBlock!.toString() } } : {}) });
        setReplacing(false);
        setStep('wait');
        setNote('Sent. Waiting for it to be confirmed…');
        setErr(UNREAD);
        return;
      }
      // before the transaction was sent: back to the review, details kept
      const x = e as { earlier?: unknown; hash?: unknown; launch?: { token?: unknown; symbol?: unknown } } | null;
      if (place && sent && x && x.earlier === true) {
        // the first launch (or something in its place) went through meanwhile: the page's own check shows what ran
        setReplacing(false);
        setStep('wait');
        await checkSent(sent);
        return;
      }
      setStep((s) => (s === 'wait' ? s : 'review'));
      setErr(reason(e));
      if (x && x.earlier === true && typeof x.hash === 'string') {
        setEarlierHash(x.hash);
        // it was a launch (from another tab, say): shown rather than another created (read before it was crossed out)
        const l = x.launch;
        if (l && typeof l.token === 'string' && isAddress(l.token, { strict: false }) && typeof l.symbol === 'string') {
          shown(getAddress(l.token), x.hash, l.symbol, 'Your earlier launch went through, so nothing new was sent.');
          setErr('');
          setStep('wait');
          await checkPage(getAddress(l.token));
        }
      }
    } finally {
      inWallet = false;
      keep();
    }
  };

  const at = STEPS.findIndex((s) => s.key === step);
  const rows: [string, React.ReactNode][] = params ? [
    ['Creator wallet', <span className="mono" title={creator}>{short(creator)}</span>],
    ['Network', 'VYRE Testnet'],
    ['Token', <><b>$<bdi>{params.symbol}</bdi></b> <bdi>{params.name}</bdi></>],
    ['Supply', `${exact(params.totalSupply)} tokens`],
    ['Opening market cap', `about ${usd(Number(OPENING_MARKET_CAP / E18))} (${price(openPrice)} a token; the pool opens within about 1% of it)`],
    ['Buy / sell tax', `${pct(params.buyTaxBps)} / ${pct(params.sellTaxBps)}, plus the 1% platform fee each way`],
    ['Dev buy', params.firstBuyUsdc ? `${exact(params.firstBuyUsdc)} USDC` : 'None'],
    ['Picture and links', meta.useOwn ? (meta.own ? 'Your own file' : 'None') : !(hasContent(meta.file) || meta.picture) ? 'None (add them any time)'
      : fileFailed ? 'Couldn’t be saved just now (add them any time)' : 'Saved with the launch (change them any time)'],
  ] : [];
  // the dev buy's amount as it was read, on the button that sends it
  const devBuy = params?.firstBuyUsdc ? ` with a ${exact(params.firstBuyUsdc)} USDC dev buy` : '';
  // a Face ID operation not yet mined has no transaction to link (its wallet is linked instead)
  const sentHash = done ? done.hash : sent && !sent.op ? sent.hash : undefined;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="review-title" tabIndex={-1} ref={box}>
        <h2 className="h3" id="review-title">{step === 'ready' ? 'Your token is live' : 'Review your token'}</h2>
        <ol className="steps" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s.key} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>{s.label}</li>)}
        </ol>

        {step === 'review' && (
          <>
            {params && <dl className="review-list">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
            {replacing && sent && <p className="note small">This takes the place of your launch of $<bdi>{tokenText(sent.symbol)}</bdi> that hasn’t gone through: the same place in your wallet’s sequence, so only one of the two can ever run.</p>}
            <p className="small muted">The taxes can be lowered later, never raised. The liquidity is locked for good. Check the details before you create it.</p>
            {switched && <p className="err small" role="alert">Your wallet changed to {short(account!)}. Go back and review again with the wallet you mean to create it from.</p>}
            {err && <p className="err small" role="alert">{err}{fileFailed || faceId ? '' : ' If your wallet shows the launch as sent, check it on the explorer before trying again.'}
              {earlierHash && <> <a href={`${EXPLORER}/tx/${earlierHash}`} target="_blank" rel="noopener noreferrer">See what went through</a>.</>}</p>}
            {fileFailed && <p className="small">You can create it now without them, and add the picture, description and links later on its Manage page.</p>}
            <div className="row dialog-actions">
              <button type="button" className="btn btn-line" onClick={() => onClose()}>Back to details</button>
              {fileFailed && <button type="button" className="btn btn-line" onClick={() => create(false)} disabled={switched || !params}>Create without picture and links{devBuy}</button>}
              <button type="button" className="btn btn-accent" onClick={() => create()} disabled={switched || !params}>{replacing ? 'Create it in its place' : err && !earlierHash ? 'Try again' : 'Create token'}{devBuy}</button>
            </div>
          </>
        )}

        {(step === 'confirm' || step === 'wait') && (
          <div className="progress" role="status" aria-live="polite">
            <p>{note}</p>
            {sentHash && <p className="small"><a href={`${EXPLORER}/tx/${sentHash}`} target="_blank" rel="noopener noreferrer">See the transaction</a></p>}
            {!done && sent?.op && <p className="small"><a href={`${EXPLORER}/address/${sent.op.sender}`} target="_blank" rel="noopener noreferrer">See your wallet on the explorer</a></p>}
            {err && (
              <>
                <p className="err small">{err}</p>
                <div className="row">
                  {(done || sent) && <button type="button" className="btn btn-line btn-sm" onClick={() => (done ? checkPage(done.token) : checkSent(sent!))}>Check again</button>}
                  {/* closing keeps the hash on the page, with "Check it" in place of Review */}
                  {!done && sent && <button type="button" className="linkish small" onClick={() => onClose()}>Close (it stays on this page to check)</button>}
                </div>
                {!done && sent && checked && !sent.op && (
                  <p className="small muted">Not on the explorer after a few minutes? It never reached the chain: <button type="button" className="linkish small" onClick={() => startOver('')}>start over</button>.</p>
                )}
                {!done && sent?.op && checked && !taken && (!faceId || !account || !isAddressEqual(account, sent.op.sender as Address)
                  ? <p className="small muted">It was sent from the Face ID wallet {short(sent.op.sender)}: sign in with that wallet to create it in its place (checking works from any wallet).{kept(sent.op.sender as Address, BigInt(sent.op.nonce)) === 'device' && <> Or <button type="button" className="linkish small" onClick={() => { aside = { symbol: sent.symbol, sender: sent.op!.sender }; onSent(null); onClose(); }}>put it aside on this page</button>: that wallet still looks for it first on this device.</>}</p>
                  : !mayTakePlace(sent.op.sender as Address, BigInt(sent.op.nonce))
                    ? <p className="small muted">{STILL_WAITING[kept(sent.op.sender as Address, BigInt(sent.op.nonce))]}</p>
                    : params
                      ? <p className="small muted">Still not through after two minutes? <button type="button" className="linkish small" onClick={() => { setReplacing(true); setChecked(false); setErr(''); setStep('review'); }}>Create it in this one’s place</button>: it takes the same place in your wallet’s sequence, so only one of the two can ever run.</p>
                      : <p className="small muted">Still not through after two minutes? To create it in its place, close this, fill in the token’s details again, and press Check it.</p>)}
              </>
            )}
            {step === 'confirm' && (faceId
              ? <p className="small muted">Keep this open while it goes through.</p>
              : <p className="small muted">Keep this open while it goes through. Nothing in your wallet? <button type="button" className="linkish" onClick={() => window.location.reload()}>Reload the page</button> to start again.</p>)}
          </div>
        )}

        {step === 'ready' && done && (
          <div className="progress" role="status" aria-live="polite">
            {done.said && <p>{done.said}</p>}
            <p>${iso(done.symbol)} is trading. {stay ? '' : `Opening its page in ${secs} s.`}</p>
            <div className="row dialog-actions">
              <a className="btn btn-accent" href={href({ page: 'token', token: done.token })}>View token</a>
              {!stay && <button type="button" className="btn btn-line" onClick={() => setStay(true)}>Stay here</button>}
              {stay && <a className="btn btn-line" href={href({ page: 'manage', token: done.token })}>Manage it</a>}
            </div>
            <p className="small"><a href={`${EXPLORER}/tx/${done.hash}`} target="_blank" rel="noopener noreferrer">See the transaction</a></p>
          </div>
        )}
      </div>
    </div>
  );
}
