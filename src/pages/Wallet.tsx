// Getting USDC onto VYRE (the faucet, a card where this build offers it, USDC from another chain through Arc, or a deposit
// from Arc testnet) and the visitor's promoter link. With an email wallet (Circle's), the card delivers to it on Arc and
// "Move to VYRE" runs through Circle's window.
import { useEffect, useRef, useState } from 'react';
import {
  CCTP_SOURCES, CctpBurnRevertedError, CctpDeliveryError, SentButUnconfirmedError, TransactionReplacedError, burnToArc, cctpNetworkFor, cctpSource, claimWithdrawal,
  depositFromArc, getAddresses, getCctpFees, feeCapFor, getConfirmedCount, getFaucetStatus, getPromoter, getWithdrawals, isApprovedPromoter, maxFeeFor,
  mintOnArc, outboxAbi, requestTestUsdc, sendUsdc, toNativeUsdc, FAUCET_ADDRESS, waitForArcMint, withdrawToArc,
  type CctpFees, type CctpStatus, type FaucetStatus, type Withdrawal,
} from '@vyrechain/sdk';
import { erc20Abi, getAddress, isAddress, zeroAddress, type Address, type EIP1193Provider, type Hash } from 'viem';
import { ARC_CHAIN, VYRE_CHAIN, arc, reason, sourceClient, switchTo, vyre, walletOn } from '../lib/chain';
import { ago, amount, amountProblem, exact, parse, short } from '../lib/format';
import { usdcBalance } from '../lib/market';
import { LOOK_BACK_BLOCKS, LOOK_PAGE_BLOCKS, fromBlockOf, keepMove, loadMoves, type Move } from '../lib/moves';
import { burnSentError } from '../lib/fromchain';
import { arrival, depositArrived, heldDeposit } from '../lib/deposit';
import { addPending, loadPending, removePending, type PendingTransfer } from '../lib/pending';
import { useWallet } from '../lib/wallet';
import { AddressLink, ConnectButton, EmailTradeNote, TxButton, txUrl } from '../components/ui';
import { promoterStatus, topupLink } from '../lib/api';
import { moveToVyre } from '../lib/circle';
import { cardTopupOffered } from '../lib/features';
const FEE_ROOM = 5n * 10n ** 15n; // 0.005 USDC kept for the network fee
/** Whether this build offers the card checkout: on the test network unless VITE_CARD_TOPUP=0, elsewhere only with VITE_CARD_TOPUP=1 */
const CARD_TOPUP = cardTopupOffered(import.meta.env.VITE_CARD_TOPUP, vyre.chain?.testnet === true);

// the SDK refuses a deposit from an address with code on Arc (VYRE would credit it to an aliased address); the app
// says so plainly and never offers the SDK's override
const CONTRACT_WALLET = 'This wallet is a contract on VYRE, which may not own the same address on Arc, so MINTA won’t move its USDC there. Move it with a plain wallet, or with the SDK’s withdrawToArc and a destination you control.';
const SMART_ACCOUNT = 'This wallet is a smart account on Arc; deposits from it would arrive at a different address on VYRE. Move USDC from a plain wallet instead.';

const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
const entryPointAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

/** Kept on Arc for the move to VYRE's gas when an arrival is put into "Move to VYRE" (0.01 USDC) */
const GAS_ON_ARC = 10n ** 16n;
/** From the app's 18-decimal amounts to the source chains' 6 */
const TO_SIX = 10n ** 12n;
/** USDC in the source chains' units (6 decimals), for people */
const usdc6 = (units: bigint) => amount(toNativeUsdc(units), 6);
/** Past this, a transfer from another chain is taking longer than usual (they take seconds to a few minutes) */
const SLOW_MS = 10 * 60_000;

export default function Wallet() {
  const { account, provider, email, withEmail, faceId } = useWallet();
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [onArc, setOnArc] = useState<bigint | null>(null);
  const [faucet, setFaucet] = useState<FaucetStatus | null>(null);
  const [amountIn, setAmountIn] = useState('');

  const load = async () => {
    getFaucetStatus().then(setFaucet).catch(() => setFaucet(null));
    if (!account) return;
    usdcBalance(account).then(setUsdc).catch(() => {});
    // a Face ID wallet's address on Arc isn't a wallet of its own (yet): nothing to show there
    if (faceId) setOnArc(null);
    else arc.getBalance({ address: account }).then(setOnArc).catch(() => setOnArc(null));
  };
  useEffect(() => { load(); }, [account]);

  // USDC that just arrived on Arc from another chain: into "Move to VYRE", less a little for that move's gas on Arc
  const fromArcInput = useRef<HTMLInputElement>(null);
  const prefillMove = async (arrived: bigint) => {
    if (!account) return;
    const onArcNow = await arc.getBalance({ address: account }).catch(() => onArc);
    if (onArcNow !== null) setOnArc(onArcNow);
    const room = onArcNow !== null && onArcNow > GAS_ON_ARC ? onArcNow - GAS_ON_ARC : 0n;
    const v = arrived < room ? arrived : room;
    if (v > 0n) setAmountIn(exact(v));
    document.getElementById('from-arc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fromArcInput.current?.focus({ preventScroll: true });
  };

  const value = parse(amountIn);
  return (
    <section className="narrow">
      <p className="eyebrow">Wallet</p>
      <h1 className="display">Your <em>USDC.</em></h1>
      <p className="lede">{faceId ? 'Get USDC into your Face ID wallet, send it, or move it to Arc.' : 'Add USDC to VYRE, or move it back to Arc.'} USDC pays for everything on VYRE: gas and trades. On the testnet it’s test money with no value.</p>
      {!account && <ConnectButton />}
      {account && (
        <div className="card row-between">
          <div><p className="muted small">On VYRE</p><p className="big">{usdc === null ? '…' : amount(usdc)} USDC</p></div>
          {!faceId && <div className="right"><p className="muted small">On Arc testnet</p><p>{onArc === null ? '—' : `${amount(onArc)} USDC`}</p></div>}
        </div>
      )}

      {email && account && <EmailWalletCard account={account} emailAddress={email.email} />}
      {faceId && account && <FaceIdWalletCard account={account} />}

      {CARD_TOPUP && account && !faceId && <CardTopup account={account} onArc={onArc} />}

      <div className="card">
        <h2 className="h3">The faucet</h2>
        <p className="small">{faucet ? `${faucet.drip} test USDC per wallet and per network, every ${faucet.cooldownHours} hours${faucet.returnCooldownHours ? `, or every ${faucet.returnCooldownHours} if you’ve sent back at least ${faucet.drip} since your last one` : ''}. ${faucet.open ? '' : 'It’s being refilled right now.'}` : 'Free test USDC once a day.'}</p>
        {faucet?.open && faucet.dripsLeftToday === 0 && <p className="small">Today’s test USDC is all given out. More: Circle’s faucet gives 20 at a time on Arc, and <a href="https://vyrechain.com/faucet/" target="_blank" rel="noopener noreferrer">the faucet page</a> brings it here{faceId ? ' (with a browser wallet)' : ''}.</p>}
        {email && <p className="small muted">It sends test USDC on VYRE, which an email wallet can’t use yet: for now get test USDC on Arc from Circle’s faucet (below).</p>}
        {account && !email && (
          <TxButton className="btn btn-line" label="Get test USDC" disabled={faucet ? !faucet.open : false} onDone={load}
            run={async () => { const r = await requestTestUsdc(account); return { hash: r.tx, text: `Sent ${r.amount} test USDC.` }; }} />
        )}
        {account && !email && faucet && <SendBack faucet={faucet} held={usdc} onDone={load} />}
      </div>

      {!faceId && <FromChain account={account} provider={provider} email={!!email} onLanded={load} onMove={prefillMove} />}

      {!faceId && <div className="card" id="from-arc">
        <h2 className="h3">Bring it from Arc</h2>
        <p className="small">Get 20 test USDC at a time from <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">Circle’s faucet</a> (pick Arc Testnet), then move it here. It arrives in about 3 seconds.</p>
        {email && <p className="note small">With an email wallet you confirm the move in Circle’s window, and Circle sends it on Arc. The USDC arrives at the same address on VYRE, where it stays for now: trading it, or moving it back, with an email wallet opens when Circle supports VYRE.</p>}
        {account && (
          <>
            <label className="field"><span>Amount (USDC)</span><input ref={fromArcInput} inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="5" aria-invalid={!!amountProblem(amountIn)} /></label>
            {amountProblem(amountIn) && <p className="err small" role="alert">{amountProblem(amountIn)}</p>}
            <TxButton label={value ? `Move ${exact(value)} USDC to VYRE` : 'Move to VYRE'} disabled={!value || (onArc !== null && value >= onArc)} onDone={load} keepAs={`to-vyre:${account.toLowerCase()}`}
              arrived={(d) => depositArrived(vyre, d)}
              run={async (say) => {
                if (email) {
                  const before = await vyre.getBalance({ address: account });
                  const r = await withEmail((s) => moveToVyre(s, exact(value!).replace(/,/g, ''), say));
                  say('Sent on Arc. Waiting for it on VYRE…');
                  const secs = await arrival(vyre, ARC_CHAIN.id, account, before, value!, r.arcTx);
                  return { text: `Arrived on VYRE in ${secs.toFixed(1)} s.${r.arcTx ? ` (Arc transaction ${short(r.arcTx)})` : ''}` };
                }
                if (!provider) throw new Error('Connect a wallet first.');
                say('Switching your wallet to Arc testnet…');
                await switchTo(provider, ARC_CHAIN);
                const before = await vyre.getBalance({ address: account });
                say('Confirm in your wallet…');
                const r = await depositFromArc(walletOn(provider, account, ARC_CHAIN), arc, { amount: value! }).catch((e: unknown) => {
                  // sent, but its receipt on Arc couldn't be read: held as Check it, which looks for it on VYRE too once it went through
                  if (e instanceof SentButUnconfirmedError) throw heldDeposit(e, account, before, value!);
                  throw /is a smart account or contract on Arc/.test((e as Error)?.message || '') ? new Error(SMART_ACCOUNT) : e;
                });
                say('Sent on Arc. Waiting for it on VYRE…');
                const secs = await arrival(vyre, ARC_CHAIN.id, account, before, value!, r.hash);
                return { text: `Arrived on VYRE in ${secs.toFixed(1)} s. (Arc transaction ${short(r.hash)})` };
              }} />
            {value && onArc !== null && value >= onArc && <p className="err small">You have {amount(onArc)} USDC on Arc testnet; keep a little for its gas.</p>}
          </>
        )}
      </div>}

      {account && !email && <SendUsdc account={account} held={usdc} faceId={!!faceId} onDone={load} />}

      {account && !faceId && <CashOut account={account} provider={provider} isEmail={!!email} onDone={load} />}
      {account && faceId && <MoveOut account={account} held={usdc} onDone={load} />}

      {account && <Promoter account={account} />}
    </section>
  );
}

/**
 * USDC from another chain to Arc, through Circle's CCTP: the browser wallet burns it there (after an exact approval if
 * needed), Circle mints it to the same address on Arc and pays that gas, and the arrival goes into "Move to VYRE".
 * Each transfer sent is kept in this browser until it arrives (lib/pending.ts), so a reload keeps following it.
 */
function FromChain({ account, provider, email, onLanded, onMove }: {
  account: Address | null; provider: EIP1193Provider | null; email: boolean; onLanded: () => void; onMove: (arrived: bigint) => void;
}) {
  const [chainId, setChainId] = useState(CCTP_SOURCES[1]!.id); // Base Sepolia: Circle signs its transfers in about 8 s
  const src = cctpSource(chainId);
  // the transfer is sent to Circle's contract: anything else held was the approval before it
  const messenger = (() => { try { return cctpNetworkFor(src.arcChainId).tokenMessenger; } catch { return undefined; } })();
  const [amountIn, setAmountIn] = useState('');
  const [fees, setFees] = useState<CctpFees | null>(null);
  const [feeErr, setFeeErr] = useState('');
  const [feeTick, setFeeTick] = useState(0);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balFailed, setBalFailed] = useState(false);
  const [balTick, setBalTick] = useState(0);
  const [transfers, setTransfers] = useState<PendingTransfer[]>(() => loadPending());
  const [unsaved, setUnsaved] = useState(false);

  // Circle's fees for the chosen chain, read again every 15 s (its delivery fee moves every few seconds with Arc's gas)
  useEffect(() => {
    let live = true;
    const get = () => getCctpFees(chainId)
      .then((f) => { if (live) { setFees(f); setFeeErr(''); } })
      .catch((e) => { if (live) { setFees(null); setFeeErr(reason(e)); } });
    get();
    const t = setInterval(get, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [chainId, feeTick]);

  // the wallet's USDC on the chosen chain
  useEffect(() => {
    let live = true;
    setBalance(null);
    setBalFailed(false);
    if (account) {
      sourceClient(chainId).readContract({ address: cctpSource(chainId).usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
        .then((b) => { if (live) setBalance(b); }).catch(() => { if (live) setBalFailed(true); });
    }
    return () => { live = false; };
  }, [chainId, account, balTick]);

  // the typed amount, in the source chain's 6 decimals, and what it costs and delivers
  const value = parse(amountIn);
  const problem = amountProblem(amountIn) || (value !== null && value % TO_SIX !== 0n ? 'USDC on these chains has 6 decimals: at most 6 digits after the point.' : '');
  const units = value !== null && !problem && value > 0n ? value / TO_SIX : null;
  // Circle's fees now (what a burn sent now pays), and the most accepted: the fees move between the quote and the burn
  const fee = units !== null && fees ? maxFeeFor(units, fees) : null;
  const maxFee = units !== null && fees ? feeCapFor(units, fees) : null;
  const tooSmall = units !== null && maxFee !== null && maxFee >= units;
  const tooMuch = units !== null && balance !== null && units > balance;

  const keep = (t: PendingTransfer) => {
    setUnsaved(!addPending(t));
    setTransfers((l) => [...l.filter((x) => x.hash !== t.hash), t]);
  };
  const forget = (hash: Hash) => {
    removePending(hash);
    setTransfers((l) => l.filter((x) => x.hash !== hash));
  };

  const send = async (say: (t: string) => void) => {
    if (!provider || !account) throw new Error('Connect a wallet first.');
    if (units === null || maxFee === null) throw new Error('Type an amount first.');
    // what the user saw: this chain, this amount, fees up to this
    const from = src, burned = units, limit = maxFee;
    say(`Switching your wallet to ${from.name}…`);
    await switchTo(provider, from.chain);
    const sent: { hash: Hash | null } = { hash: null };
    try {
      const r = await burnToArc(walletOn(provider, account, from.chain), sourceClient(from.id), {
        amount: burned, maxFee: limit, recipient: account, arcClient: arc,
        onProgress: (step, hash, replaces) => {
          if (step === 'approve') say(`Confirm in your wallet: an approval for exactly ${usdc6(burned)} USDC, for Circle’s transfer contract…`);
          else if (step === 'burn') say('Confirm the transfer in your wallet…');
          else if (hash) {
            // sped up in the wallet: the same transfer under a new hash, followed instead of the old one
            if (replaces) forget(replaces.toLowerCase() as Hash);
            // kept before anything else can go wrong: from here on, it's followed below whatever happens
            sent.hash = hash.toLowerCase() as Hash;
            keep({ hash: sent.hash, chainId: from.id, account, amount: burned, maxFee: limit, at: Date.now() });
            say(`Sent. Waiting for ${from.name} to confirm it…`);
          }
        },
      });
      return { hash: r.hash, chainId: from.id, text: `Sent from ${from.name}. Circle is moving it to Arc: follow it below.` };
    } catch (e) {
      const m = (e as Error | null)?.message || '';
      // cancelled or swapped for another transaction in the wallet: nothing was burned, and there's nothing to follow
      if (e instanceof TransactionReplacedError) {
        if (sent.hash) forget(sent.hash);
        throw new Error(e.reason === 'cancelled' ? 'Cancelled in your wallet: nothing was burned.' : 'Your wallet sent a different transaction in its place: nothing was burned.');
      }
      // sent: held as Check it unless its receipt says it failed, so a second press can't burn again
      if (sent.hash) throw burnSentError(e, sent.hash, from);
      if (/fees went up/.test(m)) {
        setFeeTick((n) => n + 1);
        throw new Error('Circle’s fees just went up. The new fees are shown above: check them and press again (an approval already made is kept for it).');
      }
      if (/is a contract on Arc/.test(m)) throw new Error('Your address is a contract on Arc, so USDC minted to it could be stuck there. Use a plain wallet.');
      if (/may not be yours/.test(m)) throw new Error(`This is a smart-contract wallet on ${from.name}; the same address on Arc may not be yours, so MINTA won’t send there. Use a plain wallet.`);
      if (/has no ETH on/.test(m)) throw new Error(`You need a little Sepolia ETH on ${from.name} to pay for gas.`);
      throw e;
    }
  };

  const list = transfers.length > 0 && (
    <ul className="list withdrawals">
      {transfers.map((t) => (
        <Transfer key={t.hash} t={t} account={account} provider={provider} onLanded={onLanded} onMove={onMove} onForget={() => forget(t.hash)} />
      ))}
    </ul>
  );

  // Circle's wallets can't sign on these chains in this app yet: no form, but transfers already sent are still followed
  if (email) {
    return (
      <>
        <p className="small muted" role="note">Bringing USDC from another chain needs a browser wallet for now: an email wallet can’t sign on those chains here yet.</p>
        {list && <div className="card"><h2 className="h3">From another chain</h2>{list}</div>}
      </>
    );
  }
  return (
    <div className="card" id="from-chain">
      <h2 className="h3">From another chain</h2>
      <p className="small">Bring USDC from Ethereum Sepolia, Base Sepolia or Arbitrum Sepolia. Circle’s CCTP burns it there and mints it to your address on Arc, paying Arc’s gas itself, usually within a minute; then move it to VYRE below. You pay a little Sepolia ETH for gas on the chain it leaves. Test USDC for those chains: <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">Circle’s faucet</a>.</p>
      {!account ? <ConnectButton /> : (
        <>
          <label className="field"><span>From</span>
            <span className="sel"><select value={chainId} onChange={(e) => { setChainId(Number(e.target.value)); setFees(null); setFeeErr(''); }}>
              {CCTP_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></span>
          </label>
          <p className="small muted">On {src.name}: {balance !== null ? `${usdc6(balance)} USDC` : balFailed ? `couldn’t be read (${src.name}’s public RPC didn’t answer)` : '…'}</p>
          <label className="field"><span>Amount (USDC)</span><input inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="10" aria-invalid={!!problem} /></label>
          {problem && <p className="err small" role="alert">{problem}</p>}
          {!fees && <p className="small muted">{feeErr ? `Couldn’t get Circle’s fees (${feeErr}). Trying again shortly.` : 'Getting Circle’s fees…'}</p>}
          {fees && units !== null && fee !== null && maxFee !== null && (
            <div className="quote">
              <div className="row-between"><span className="muted">Circle’s fees</span><span>about {usdc6(fee)} USDC</span></div>
              <div className="row-between"><span className="muted">You receive about</span><b>{tooSmall ? '—' : `${usdc6(units - fee)} USDC on Arc`}</b></div>
              {!tooSmall && <p className="small muted">Sending pays Circle’s fees at that moment: a fast-transfer fee of {(fees.fastFeeBps / 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}% and about {usdc6(fees.forwardFee)} USDC for its delivery on Arc, whose gas moves from moment to moment. Never more than {usdc6(maxFee)} USDC, so at least {usdc6(units - maxFee)} USDC arrives.</p>}
            </div>
          )}
          {tooSmall && <p className="err small">That doesn’t cover Circle’s fees (up to {usdc6(maxFee!)} USDC): send more.</p>}
          {tooMuch && <p className="err small">You have {usdc6(balance!)} USDC on {src.name}.</p>}
          <TxButton label={units !== null ? `Send ${usdc6(units)} USDC to Arc` : 'Send to Arc'} disabled={units === null || maxFee === null || tooSmall || tooMuch || !provider}
            keepAs={`from-chain:${account.toLowerCase()}`} finalTo={messenger}
            onDone={() => { setAmountIn(''); setBalTick((n) => n + 1); }} run={send} />
          {unsaved && <p className="note small" role="note">This browser isn’t keeping a record of transfers (a private window, or blocked site data). If you leave this page before it arrives, keep the transfer’s hash (below) to check it later.</p>}
        </>
      )}
      {list}
    </div>
  );
}

type Ending =
  | { kind: 'arrived'; mint: Hash; received: bigint }
  | { kind: 'reverted' }
  | { kind: 'failed'; status: CctpStatus }
  | { kind: 'error'; text: string };

const delay = (why: string | null) => why === 'insufficient_fee'
  ? ' Its fee missed Circle’s fast lane, so it’s taking the standard route: 15 to 19 minutes.'
  : why ? ' Circle’s fast lane is full right now, so it’s taking the standard route: 15 to 19 minutes.' : '';

/** One transfer from another chain, followed until it's on Arc (and after a reload too) */
function Transfer({ t, account, provider, onLanded, onMove, onForget }: {
  t: PendingTransfer; account: Address | null; provider: EIP1193Provider | null; onLanded: () => void; onMove: (arrived: bigint) => void; onForget: () => void;
}) {
  const src = cctpSource(t.chainId);
  const [st, setSt] = useState<CctpStatus | null>(null);
  const [end, setEnd] = useState<Ending | null>(null);
  const [tick, setTick] = useState(0);
  const watch = useRef<AbortController | null>(null);

  const arrived = (mint: Hash, received: bigint) => {
    watch.current?.abort();
    removePending(t.hash);
    setEnd({ kind: 'arrived', mint, received });
    onLanded();
  };
  useEffect(() => {
    const stop = new AbortController();
    watch.current = stop;
    setEnd(null);
    waitForArcMint(t.chainId, t.hash, { signal: stop.signal, timeoutMs: Infinity, recipient: t.account, onStatus: setSt, sourceClient: sourceClient(t.chainId), arcClient: arc })
      // what Circle says arrived, or at least the amount less the fees it could take
      .then((m) => arrived(m.forwardTxHash, m.received ?? t.amount - t.maxFee))
      .catch((e) => {
        if (stop.signal.aborted) return;
        if (e instanceof CctpBurnRevertedError) { removePending(t.hash); setEnd({ kind: 'reverted' }); }
        else if (e instanceof CctpDeliveryError) setEnd({ kind: 'failed', status: e.status });
        else setEnd({ kind: 'error', text: reason(e) });
      });
    return () => stop.abort();
  }, [t.hash, tick]);

  const late = !end && Date.now() - t.at > SLOW_MS;
  // Circle's signed message, for minting it on Arc by hand when Circle's own delivery failed or stalls
  const signed = end?.kind === 'failed' ? end.status : st;
  const canFinish = !!provider && !!account && !!signed?.message && !!signed.attestation && (end?.kind === 'failed' || (late && st?.stage === 'attested'));
  const stop = () => {
    const why = end?.kind === 'failed'
      ? `Stop following this transfer here? Circle’s delivery failed, and once it’s gone from this list MINTA can’t finish it on Arc for you. Keep its hash (${t.hash}) to ask Circle’s support.`
      : 'Stop following this transfer here? It doesn’t cancel it: Circle still delivers it to its address on Arc.';
    if (window.confirm(why)) onForget();
  };

  let text: string;
  if (end?.kind === 'arrived') text = `Arrived on Arc: ${usdc6(end.received)} USDC.`;
  else if (end?.kind === 'reverted') text = `The transfer failed on ${src.name}: nothing was burned (only its gas was spent).`;
  else if (end?.kind === 'failed') text = 'Circle couldn’t deliver it on Arc. It isn’t lost: finish it on Arc yourself (a little Arc gas), or contact Circle’s support with the transfer’s hash.';
  else if (end?.kind === 'error') text = `Couldn’t check this transfer: ${end.text}`;
  else if (!st) text = 'Checking…';
  else if (st.stage === 'unseen') text = st.burnMined ? `Confirmed on ${src.name}. Waiting for Circle to pick it up…` : `Waiting for ${src.name} to confirm the transfer…`;
  else if (st.stage === 'confirming') text = `Circle is waiting for ${src.name}’s confirmations…${delay(st.delayReason)}`;
  else text = 'Circle has signed it and is delivering it on Arc…';

  return (
    <li>
      <div className="row-between">
        <span><b>{usdc6(t.amount)} USDC</b> <span className="muted small">from {src.name} · {ago(Math.floor(t.at / 1000))}{account && t.account !== account ? ` · to ${short(t.account)}` : ''}</span></span>
        <a className="small" href={txUrl(t.hash, t.chainId)} target="_blank" rel="noopener noreferrer">The transfer on {src.name}</a>
      </div>
      <p className={`status ${end?.kind === 'arrived' ? 'ok' : end ? 'err' : 'busy'}`} role="status" aria-live="polite">
        {text}{' '}
        {end?.kind === 'arrived' && <a href={txUrl(end.mint, ARC_CHAIN.id)} target="_blank" rel="noopener noreferrer">See it on Arc</a>}
      </p>
      {late && (st?.stage === 'unseen' && st.burnMined === false ? (
        <p className="small muted">{src.name} still hasn’t confirmed this transfer. Check it in your wallet or on the explorer: if it was dropped or replaced there, nothing was burned. This page keeps checking.</p>
      ) : (
        <p className="small muted">Taking longer than usual. It isn’t lost: this page keeps checking, and picks it up again after a reload. If it hasn’t arrived within an hour, contact Circle’s support with the transfer’s hash: <span className="mono break">{t.hash}</span></p>
      ))}
      <div className="row">
        {end?.kind === 'arrived' && account === t.account && <button type="button" className="btn btn-accent btn-sm" onClick={() => onMove(toNativeUsdc(end.received))}>Move it to VYRE</button>}
        {canFinish && (
          <TxButton className="btn btn-line btn-sm" label="Finish it on Arc yourself"
            run={async (say) => {
              if (!provider || !account || !signed?.message || !signed.attestation) throw new Error('Circle hasn’t given its signature for this transfer yet.');
              say('Switching your wallet to Arc testnet…');
              await switchTo(provider, ARC_CHAIN);
              say('Confirm in your wallet…');
              const r = await mintOnArc(walletOn(provider, account, ARC_CHAIN), arc, { message: signed.message, attestation: signed.attestation });
              arrived(r.hash, signed.received ?? t.amount - t.maxFee);
              return { hash: r.hash, chainId: ARC_CHAIN.id, text: 'Minted on Arc.' };
            }} />
        )}
        {end?.kind === 'error' && <button type="button" className="btn btn-line btn-sm" onClick={() => setTick((n) => n + 1)}>Check again</button>}
        {end && end.kind !== 'error' && end.kind !== 'failed'
          ? <button type="button" className="linkish small" onClick={onForget}>Done</button>
          : <button type="button" className="linkish small" onClick={stop}>Stop following</button>}
      </div>
    </li>
  );
}

/** Test USDC back to the faucet, from any wallet (a Face ID wallet's fee comes out of the same balance: some is left for it) */
function SendBack({ faucet, held, onDone }: { faucet: FaucetStatus; held: bigint | null; onDone: () => void }) {
  const { account, onVyre, confirmHint } = useWallet();
  const room = held !== null && held > FEE_ROOM ? held - FEE_ROOM : 0n;
  // one drip's worth by default, or all but the fee if that's less (a gift that close to a drip still qualifies)
  const drip = parse(faucet.drip) ?? 0n;
  const [amountIn, setAmountIn] = useState<string | null>(null);
  const shown = amountIn ?? (held === null ? faucet.drip : exact((drip < room ? drip : room) / 10n ** 14n * 10n ** 14n));
  const value = parse(shown);
  // the faucet's address is fixed here, never taken from the server's answer
  const wrongFaucet = faucet.address.toLowerCase() !== FAUCET_ADDRESS.toLowerCase();
  const problem = wrongFaucet ? 'The faucet named a different address than VYRE’s; nothing will be sent. Reload and try again later.'
    : amountProblem(shown) || (value !== null && held !== null && value > room ? 'That’s more than you can send (keep a little for the network fee).' : '');
  return (
    <div className="sendback">
      <p className="small">Done testing? Send it back: it goes to the next person{faucet.returnCooldownHours ? `, and about ${faucet.drip} or more gets you your next drip after ${faucet.returnCooldownHours} hours` : ''}. <a href="https://vyrechain.com/faucet/#givers-title" target="_blank" rel="noopener noreferrer">Top givers</a>.</p>
      <label className="field"><span>Amount to send back (USDC)</span><input inputMode="decimal" value={shown} onChange={(e) => setAmountIn(e.target.value)} aria-invalid={!!problem} /></label>
      <div className="row">
        <TxButton className="btn btn-line" label={value ? `Send back ${exact(value)} USDC` : 'Send back'} disabled={!value || !!problem || held === null} onDone={onDone} keepAs={`send-back:${account?.toLowerCase() ?? ''}`}
          run={async (say) => {
            const w = await onVyre();
            say(confirmHint);
            const r = await sendUsdc(w, vyre, { to: FAUCET_ADDRESS, amount: value! });
            return { hash: r.hash, text: `Sent back ${exact(value!)} USDC. Thank you.` };
          }} />
      </div>
      {problem && <p className="small err">{problem}</p>}
    </div>
  );
}

/** A Face ID wallet: what it is, how it's backed up, and what isn't open to it yet */
function FaceIdWalletCard({ account }: { account: Address }) {
  // gas paid ahead and not used stays with the wallet at the EntryPoint, and pays for its next transaction first
  const [held, setHeld] = useState<bigint | null>(null);
  useEffect(() => {
    vyre.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: 'balanceOf', args: [account] }).then(setHeld).catch(() => setHeld(null));
  }, [account]);
  return (
    <div className="card">
      <h2 className="h3">Your Face ID wallet</h2>
      <p className="small">Your phone’s Face ID (or fingerprint, or your computer’s lock) holds this wallet’s key. There’s no app and no seed phrase, and nobody else, VYRE included, can move its money.</p>
      <p className="small mono break">{account}</p>
      <p className="small"><b>This address is on VYRE only.</b> Don’t send USDC to it on Arc or any other chain: there’s no wallet there to spend it.</p>
      {held !== null && held > 0n && <p className="small muted">Also {amount(held, 6)} USDC set aside for network fees, used by your next transaction.</p>}
      <p className="small"><b>A new or lost phone:</b> the passkey is saved in your Apple or Google account’s passwords, so it comes back on any phone signed in to that account. Open MINTA there and tap <b>Sign in with Face ID</b>. On a computer, sign in with the phone (your browser shows a code to scan).</p>
      <p className="small muted">Each transaction asks for Face ID once and pays its own gas, a fraction of a cent, in USDC. Card top-ups come to Face ID wallets later; to take USDC out, send it on VYRE or move it to an Arc address (below).</p>
    </div>
  );
}

function EmailWalletCard({ account, emailAddress }: { account: Address; emailAddress: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card">
      <h2 className="h3">Your email wallet</h2>
      <p className="small">Signed in as {emailAddress}. Your wallet has the same address on Arc and on VYRE. For free test USDC on Arc, paste it into Circle’s faucet.</p>
      <div className="copy-row">
        <input readOnly value={account} aria-label="Your wallet’s address" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-line btn-sm" onClick={() => { navigator.clipboard?.writeText(account).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <EmailTradeNote />
    </div>
  );
}

function CardTopup({ account, onArc }: { account: Address; onArc: bigint | null }) {
  const [usd, setUsd] = useState('50');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(usd);
  const ok = isFinite(n) && n >= 1 && n <= 10000;
  const open = async () => {
    setMsg(''); setBusy(true);
    // opened now, in the click, so a popup blocker lets it through; it's pointed at the checkout once the link is made
    const win = window.open('', '_blank');
    try {
      const url = await topupLink(account, n);
      if (win) { win.opener = null; win.location.href = url; } else window.location.href = url;
      setMsg('The checkout is open in a new tab. When it’s done, the USDC arrives on Arc; move it to VYRE below.');
    } catch (e) {
      win?.close();
      setMsg((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2 className="h3">Card or Apple Pay</h2>
      <p className="small">Buy USDC with a card or Apple Pay through Transak, delivered to your address on Arc; then move it to VYRE in one step. On the testnet it’s Transak’s test mode: use their test card, no real money moves.</p>
      <label className="field"><span>Amount (USD)</span><input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} /></label>
      <div className="tx"><button className="btn btn-accent" type="button" disabled={!ok || busy} onClick={open}>{busy ? 'Opening…' : 'Buy USDC'}</button></div>
      {msg && <p className="status busy" role="status">{msg}</p>}
      {onArc !== null && onArc > 0n && <p className="small muted">On Arc now: {amount(onArc)} USDC.</p>}
    </div>
  );
}

function Promoter({ account }: { account: Address }) {
  const [mine, setMine] = useState<Address | null | undefined>(undefined);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [app, setApp] = useState<{ code: string; status: string } | null | undefined | 'unread'>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    getPromoter(vyre, account).then(setMine).catch(() => setMine(undefined));
    isApprovedPromoter(vyre, account).then(setApproved).catch(() => setApproved(null));
    promoterStatus(account).then(setApp).catch(() => setApp('unread'));
  }, [account]);
  // an approved code gets the short link; otherwise the wallet link still works (it pays once the wallet is approved)
  const coded = app && app !== 'unread' && app.status === 'approved' && approved;
  const link = `${window.location.origin}/?ref=${coded ? app.code : account}`;
  return (
    <div className="card">
      <h2 className="h3">Your promoter link</h2>
      <p className="small">People who arrive by your link can name you as their promoter. Once you’ve signed up and been approved, you’re paid 30% of the 1% platform fee on their trades on MINTA, in USDC, in the same transaction. On the testnet that’s test USDC; the paid program opens on mainnet. Not available in the UK, the EU, Australia or Singapore.</p>
      <div className="copy-row">
        <input readOnly value={link} aria-label="Your link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-line btn-sm" onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="small muted">
        You as a promoter: {approved === null || app === undefined ? '…'
          : app === 'unread' ? (approved ? 'approved' : 'couldn’t check your application just now')
          : approved ? (app && app.status === 'approved' ? `approved, code ${app.code}` : 'approved')
          : !app ? <>not signed up yet (<a href="https://vyrechain.com/promote/" target="_blank" rel="noopener noreferrer">sign up</a> for a short link)</>
          : app.status === 'pending' ? `applied as ${app.code}, waiting for approval`
          : app.status === 'declined' ? <>your application ({app.code}) wasn’t approved</>
          : `approval removed (the code ${app.code} stays yours)`}.
        {' '}Your own promoter: {mine === undefined ? '…' : mine ? <AddressLink address={mine} /> : 'none'}.
      </p>
    </div>
  );
}

type Row = Withdrawal & { state?: 'waiting' | 'ready' | 'claimed' };

/** Moving USDC back to Arc: start it on VYRE, then claim it on Arc once VYRE's state covering it is confirmed there */
function CashOut({ account, provider, isEmail, onDone }: { account: Address; provider: EIP1193Provider | null; isEmail: boolean; onDone: () => void }) {
  const { onVyre } = useWallet();
  const [amountIn, setAmountIn] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const value = parse(amountIn);

  // the account's withdrawals, and for each whether it's waiting, ready to claim or paid out (one confirmed-count read
  // for all of them, then the Outbox's isSpent for each)
  const load = async () => {
    try {
      // the ones this wallet started (anyone can start one paying to any address): filtered as the SDK pages back, so
      // others' can't crowd these out
      // (from about 10 days back, in a few big pages: on a busy chain a look from the first block would be hundreds of queries)
      const head = await vyre.getBlockNumber();
      const list: Row[] = await getWithdrawals(vyre, { destination: account, caller: account, limit: 10, fromBlock: head > LOOK_BACK_BLOCKS ? head - LOOK_BACK_BLOCKS : 0n, pageBlocks: LOOK_PAGE_BLOCKS });
      setRows(list);
      if (!list.length) return;
      const outbox = getAddresses(VYRE_CHAIN.id).rollup!.outbox!;
      const [confirmed, spent] = await Promise.all([
        getConfirmedCount(vyre, arc),
        Promise.all(list.map((w) => arc.readContract({ address: outbox, abi: outboxAbi, functionName: 'isSpent', args: [w.position] }))),
      ]);
      setRows(list.map((w, i) => ({ ...w, state: spent[i] ? 'claimed' : w.position < confirmed ? 'ready' : 'waiting' })));
    } catch { setRows((r) => r ?? []); }
  };
  useEffect(() => { load(); }, [account]);
  // check again every minute while one is waiting
  const waiting = !!rows?.some((w) => w.state === 'waiting');
  useEffect(() => { if (!waiting) return; const t = setInterval(load, 60_000); return () => clearInterval(t); }, [waiting, account]);

  return (
    <div className="card">
      <h2 className="h3">Move to Arc</h2>
      <p className="small">Moves USDC from VYRE back to your address on Arc through VYRE’s own bridge, in two steps: start it here, then claim it on Arc once VYRE’s state covering it is confirmed there (usually under half an hour on the testnet).</p>
      {isEmail ? <EmailTradeNote /> : (
        <>
          <label className="field"><span>Amount (USDC)</span><input inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="1" aria-invalid={!!amountProblem(amountIn)} /></label>
          {amountProblem(amountIn) && <p className="err small" role="alert">{amountProblem(amountIn)}</p>}
          <TxButton label={value ? `Move ${exact(value)} USDC to Arc` : 'Start the move'} disabled={!value} keepAs={`to-arc:${account.toLowerCase()}`}
            onDone={() => { setAmountIn(''); load(); onDone(); }}
            run={async (say) => {
              const w = await onVyre();
              say('Confirm in your wallet…');
              const r = await withdrawToArc(w, vyre, { amount: value! }).catch((e) => {
                throw /is a contract on VYRE/.test((e as Error)?.message || '') ? new Error(CONTRACT_WALLET) : e;
              });
              return { hash: r.hash, text: `Started: ${amount(r.withdrawal.value)} USDC. Claim it on Arc below once it’s ready.` };
            }} />
        </>
      )}
      {rows && rows.length > 0 && (
        <ul className="list withdrawals">
          {rows.map((w) => (
            <li key={`${w.hash}-${w.position}`} className="row-between">
              <span><b>{amount(w.value)} USDC</b> <span className="muted small">· started {ago(Number(w.timestamp))}</span></span>
              {w.state === 'claimed' && <span className="muted small">Paid out on Arc</span>}
              {w.state === 'waiting' && <span className="muted small">Waiting to be confirmed on Arc</span>}
              {w.state === undefined && <span className="muted small">Checking…</span>}
              {w.state === 'ready' && !isEmail && (
                <TxButton className="btn btn-accent btn-sm" label="Claim on Arc" onDone={() => { load(); onDone(); }}
                  run={async (say) => {
                    if (!provider) throw new Error('Connect a wallet first.');
                    say('Switching your wallet to Arc testnet…');
                    await switchTo(provider, ARC_CHAIN);
                    say('Confirm in your wallet…');
                    const r = await claimWithdrawal(walletOn(provider, account, ARC_CHAIN), arc, vyre, w);
                    return { text: `Paid out on Arc (transaction ${short(r.hash)}).` };
                  }} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A VYRE address typed or pasted: checksummed if it's mixed case (a typo then fails), never zero */
function addressProblem(input: string, self: Address): string {
  const a = input.trim();
  if (!a) return '';
  if (!isAddress(a)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? 'That address has a typo (its capital letters don’t check out).' : 'That isn’t an address (0x and 40 characters).';
  if (getAddress(a) === zeroAddress) return 'That address can’t receive USDC.';
  if (getAddress(a) === getAddress(self)) return 'That’s this wallet’s own address.';
  return '';
}

/** Sending USDC to another address on VYRE: from a browser wallet a plain transfer, from a Face ID wallet one operation */
function SendUsdc({ account, held, faceId, onDone }: { account: Address; held: bigint | null; faceId: boolean; onDone: () => void }) {
  const { onVyre, confirmHint } = useWallet();
  const [to, setTo] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const value = parse(amountIn);
  const room = held === null ? null : faceId ? (held > FEE_ROOM ? held - FEE_ROOM : 0n) : held;
  const problem = addressProblem(to, account) || amountProblem(amountIn)
    || (value !== null && value <= 0n ? 'Send more than 0 USDC.' : '')
    || (value !== null && room !== null && value > room ? (faceId ? 'That’s more than you can send (keep a little for the network fee).' : 'That’s more than this wallet holds.') : '');
  const ready = !problem && !!to.trim() && value !== null;
  return (
    <div className="card">
      <h2 className="h3">Send USDC on VYRE</h2>
      <p className="small">To another address on VYRE: a friend’s MINTA wallet, say. It arrives in about a second. <b>Only to a VYRE address:</b> exchanges don’t take USDC on VYRE; to take it off VYRE, move it to Arc (below).</p>
      <label className="field"><span>To (a VYRE address)</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={!!addressProblem(to, account)} /></label>
      <label className="field"><span>Amount (USDC)</span><input inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="1" aria-invalid={!!amountProblem(amountIn)} /></label>
      {problem && <p className="err small" role="alert">{problem}</p>}
      {ready && <p className="small">Sends {exact(value!)} USDC to <span className="mono break">{getAddress(to.trim())}</span> on VYRE. It can’t be undone.</p>}
      <TxButton label={ready ? `Send ${exact(value!)} USDC` : 'Send'} disabled={!ready} keepAs={`send:${account.toLowerCase()}`}
        onDone={() => { setAmountIn(''); onDone(); }}
        run={async (say) => {
          const dest = getAddress(to.trim());
          const w = await onVyre();
          say(confirmHint);
          const r = await sendUsdc(w, vyre, { to: dest, amount: value! });
          return { hash: r.hash, text: `Sent ${exact(value!)} USDC to ${short(dest)}.` };
        }} />
    </div>
  );
}

/** The smallest move to Arc that is paid out there for you (to an address with no code there; the page says the rest) */
const CLAIMED_FOR_YOU = 10n ** 18n;
/** Solady's ERC-1967 proxy: a VYRE Face ID wallet's code on VYRE (as the claimer and the bundler check it) */
const FACE_ID_PROXY = '0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';
/** After this long confirmed and not paid out, MINTA says to claim it yourself */
const CLAIM_YOURSELF_AFTER = 24 * 3600;
/** A browser wallet in this browser (MetaMask, Rabby…), if there is one: to claim a move on Arc yourself */
const injected = () => (typeof window !== 'undefined' ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined);

/**
 * A Face ID wallet's move to Arc: the USDC goes to an Arc address the person controls (a Face ID wallet has no key on
 * Arc), through VYRE's own bridge. Once it's confirmed on Arc, VYRE's claimer pays it out there (at least 1 USDC).
 */
function MoveOut({ account, held, onDone }: { account: Address; held: bigint | null; onDone: () => void }) {
  const { onVyre, confirmHint } = useWallet();
  const [to, setTo] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [dests, setDests] = useState<Move[]>(() => loadMoves(account));
  const [lookFor, setLookFor] = useState('');
  const [lookMsg, setLookMsg] = useState('');
  const [looking, setLooking] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tick, setTick] = useState(0);
  const value = parse(amountIn);
  const room = held === null ? null : held > FEE_ROOM ? held - FEE_ROOM : 0n;
  const problem = addressProblem(to, account) || amountProblem(amountIn)
    || (value !== null && value < CLAIMED_FOR_YOU ? 'Move at least 1 USDC (smaller moves aren’t paid out for you on Arc).' : '')
    || (value !== null && room !== null && value > room ? 'That’s more than you can move (keep a little for the network fee).' : '');
  const ready = !problem && !!to.trim() && value !== null;

  const load = async () => {
    try {
      const head = await vyre.getBlockNumber();
      const list = (await Promise.all(dests.map((m) => getWithdrawals(vyre, { destination: m.dest, caller: account, limit: 5, fromBlock: fromBlockOf(m, head), pageBlocks: LOOK_PAGE_BLOCKS })))).flat()
        .sort((a, b) => (a.position < b.position ? 1 : -1)).slice(0, 10) as Row[];
      setRows(list);
      if (!list.length) return;
      const outbox = getAddresses(VYRE_CHAIN.id).rollup!.outbox!;
      const [confirmed, spent] = await Promise.all([
        getConfirmedCount(vyre, arc),
        Promise.all(list.map((w) => arc.readContract({ address: outbox, abi: outboxAbi, functionName: 'isSpent', args: [w.position] }))),
      ]);
      setRows(list.map((w, i) => ({ ...w, state: spent[i] ? 'claimed' : w.position < confirmed ? 'ready' : 'waiting' })));
    } catch { setRows((r) => r ?? []); }
  };
  useEffect(() => { load(); }, [account, dests.map((m) => m.dest).join(), tick]);
  const open = !!rows?.some((w) => w.state === 'waiting' || w.state === 'ready');
  useEffect(() => { if (!open) return; const t = setInterval(load, 60_000); return () => clearInterval(t); }, [open, account, dests.map((m) => m.dest).join()]);
  // how long each confirmed one has waited, in this browser's memory (to say "claim it yourself" after a day)
  const seen = useRef(new Map<string, number>());
  const since = (w: Row) => { const k = `${w.position}`; if (!seen.current.has(k)) seen.current.set(k, Date.now() / 1000); return seen.current.get(k)!; };

  return (
    <div className="card">
      <h2 className="h3">Move to Arc</h2>
      <p className="small">Moves USDC from this wallet to your own wallet on Arc (MetaMask, Rabby or any other). It goes through VYRE’s own bridge and can be paid out on Arc once it’s confirmed there (usually under half an hour on the testnet). VYRE pays it out for you, Arc’s gas included, for moves of 1 USDC or more to an ordinary wallet address, up to 3 a day to one address; otherwise, or if it hasn’t arrived within a day, claim it yourself below with that wallet (it needs a little USDC on Arc for gas).</p>
      <p className="small"><b>Not this wallet’s own address, or another Face ID wallet’s:</b> a Face ID wallet has no key on Arc. Check the address: once started, a move can’t be undone.</p>
      <label className="field"><span>To (an address on Arc)</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={!!addressProblem(to, account)} /></label>
      <label className="field"><span>Amount (USDC)</span><input inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} placeholder="1" aria-invalid={!!amountProblem(amountIn)} /></label>
      {problem && <p className="err small" role="alert">{problem}</p>}
      {ready && <p className="small">Moves {exact(value!)} USDC to <span className="mono break">{getAddress(to.trim())}</span> <b>on Arc</b>.</p>}
      <TxButton label={ready ? `Move ${exact(value!)} USDC to Arc` : 'Start the move'} disabled={!ready}
        onDone={() => { setAmountIn(''); onDone(); }}
        run={async (say) => {
          const dest = getAddress(to.trim());
          // a VYRE Face ID wallet's address has no wallet on Arc: the USDC would be stuck there
          if ((await vyre.getCode({ address: dest }).catch(() => undefined)) === FACE_ID_PROXY) throw new Error('That’s a VYRE Face ID wallet’s address, which has no wallet on Arc. Move it to a wallet you have on Arc.');
          // and a contract on Arc may not accept the payout (the claim would fail, and the claim service skips contracts): only a
          // plain wallet address goes through; if Arc can't be asked just now, the move waits rather than guesses
          // (viem answers undefined for an address with no code, so a failed read is marked with null)
          const onArc = await arc.getCode({ address: dest }).catch(() => null);
          if (onArc === null) throw new Error('Couldn’t check that address on Arc just now. Try again in a moment.');
          if (onArc && onArc !== '0x') throw new Error('That address is a contract on Arc, which may not accept the payout. Use a plain wallet address on Arc.');
          const w = await onVyre();
          say(confirmHint);
          // the destination and the block are saved before anything is sent: if the page is closed or the answer is lost
          // after the wallet signs, this browser still follows the move (and the claim can be made from it)
          setDests(keepMove(account, { dest, from: await vyre.getBlockNumber().catch(() => null) }));
          const r = await withdrawToArc(w, vyre, { amount: value!, destination: dest });
          setTick((t) => t + 1);
          return { hash: r.hash, text: `Started: ${amount(r.withdrawal.value)} USDC to ${short(dest)} on Arc. It’s paid out there once confirmed.` };
        }} />
      {rows && rows.length > 0 && (
        <ul className="list withdrawals">
          {rows.map((w) => (
            <li key={`${w.hash}-${w.position}`} className="row-between">
              <span><b>{amount(w.value)} USDC</b> <span className="muted small">to {short(w.destination)} · started {ago(Number(w.timestamp))}</span></span>
              {w.state === 'claimed' && <span className="muted small">Paid out on Arc</span>}
              {w.state === 'waiting' && <span className="muted small">Waiting to be confirmed on Arc</span>}
              {w.state === 'ready' && (
                <span className="right">
                  <span className="muted small">{w.value >= CLAIMED_FOR_YOU && Date.now() / 1000 - since(w) < CLAIM_YOURSELF_AFTER ? 'Confirmed: VYRE is paying it out on Arc' : 'Confirmed: claim it on Arc'}</span>{' '}
                  <TxButton className="btn btn-line btn-sm" label="Claim it yourself" onDone={() => { load(); onDone(); }}
                    run={async (say) => {
                      const p = injected();
                      if (!p) throw new Error('Open this page in a browser with a wallet (MetaMask, Rabby…) to claim it yourself, or wait for VYRE to pay it out.');
                      const [who] = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
                      say('Switching your wallet to Arc testnet…');
                      await switchTo(p, ARC_CHAIN);
                      say('Confirm in your wallet (it pays Arc’s gas; the USDC goes to the move’s own address)…');
                      const r = await claimWithdrawal(walletOn(p, getAddress(who), ARC_CHAIN), arc, vyre, w);
                      return { text: `Paid out on Arc (transaction ${short(r.hash)}).` };
                    }} />
                </span>
              )}
              {w.state === undefined && <span className="muted small">Checking…</span>}
            </li>
          ))}
        </ul>
      )}
      <details className="small">
        <summary>Started a move in another browser?</summary>
        <p className="small">Moves are followed in the browser that started them. To follow one here, enter the Arc address it pays out to: this looks back about 10 days for moves from this wallet to it.</p>
        <label className="field"><span>The Arc address it went to</span><input value={lookFor} onChange={(e) => setLookFor(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /></label>
        <button className="btn btn-line btn-sm" type="button" disabled={looking || !isAddress(lookFor.trim())}
          onClick={async () => {
            setLooking(true); setLookMsg('Looking…');
            try {
              const d = getAddress(lookFor.trim());
              const head = await vyre.getBlockNumber();
              const found = await getWithdrawals(vyre, { destination: d, caller: account, limit: 5, fromBlock: head > LOOK_BACK_BLOCKS ? head - LOOK_BACK_BLOCKS : 0n, pageBlocks: LOOK_PAGE_BLOCKS });
              if (!found.length) setLookMsg('No moves from this wallet to that address in the last 10 days or so.');
              else {
                const oldest = found.reduce((a, w) => (w.arbBlockNum < a ? w.arbBlockNum : a), found[0].arbBlockNum);
                setDests(keepMove(account, { dest: d, from: oldest > 0n ? oldest - 1n : 0n }));
                setLookFor(''); setLookMsg(`Found ${found.length} move${found.length === 1 ? '' : 's'}: listed above.`);
              }
            } catch { setLookMsg('Couldn’t look right now. Try again in a minute.'); }
            setLooking(false);
          }}>Look for it</button>
        {lookMsg && <p className="small" role="status">{lookMsg}</p>}
      </details>
    </div>
  );
}
