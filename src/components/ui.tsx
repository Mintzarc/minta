// Small shared pieces: the connect button (a browser wallet, or email sign-in), a transaction button with its status,
// and the launch's picture.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Address } from 'viem';
import { CCTP_SOURCES, arcTestnet } from '@vyrechain/sdk';
import { ARC_EXPLORER, EXPLORER, reason, refreshWallets } from '../lib/chain';
import { EMAIL_TRADE_NOTE } from '../lib/circle';
import { amount, short } from '../lib/format';
import { href } from '../lib/router';
import { metaOf, type Meta } from '../lib/market';
import { useWallet } from '../lib/wallet';
import TokenArt from './TokenArt';
import { FACE_ID_OFFERED, kept, useConfirmRequest } from '../lib/faceid';

const WalletIcon = () => (
  <svg className="ic cb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16" height="11" rx="2.5" /><path d="M16 13.5h4" /></svg>
);

/** Connects a browser wallet or signs in with email; `header` makes it the top bar's button (a wallet icon on phones) */
export function ConnectButton({ compact = false, header = false }: { compact?: boolean; header?: boolean }) {
  const { account, available, connect, disconnect, walletName, email, emailConfig, faceId, createFaceIdWallet, signInWithFaceId } = useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState('');
  // signing in to a wallet never used takes a second Face ID, which browsers allow only right after a tap
  const [again, setAgain] = useState<(() => void) | null>(null);
  if (account) {
    return (
      <div className="connect-group">
        <div className="connect">
          <button className={`btn btn-line btn-sm ${header ? 'cb' : ''}`} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={header ? `Wallet ${short(account)}` : undefined}>
            {header && <WalletIcon />}<span className="dot on" aria-hidden="true" /><span className="cb-text">{short(account)}</span>
          </button>
          {open && (
            <div className="menu" role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>
              <p className="muted small">{walletName}</p>
              <p className="small mono break">{account}</p>
              <a role="menuitem" href={href({ page: 'portfolio' })}>Portfolio</a>
              <a role="menuitem" href={href({ page: 'wallet' })}>{faceId ? 'Wallet: get test USDC' : 'Wallet: add or move USDC'}</a>
              <a role="menuitem" href={`${EXPLORER}/address/${account}`} target="_blank" rel="noopener noreferrer">View on the explorer</a>
              <button role="menuitem" type="button" className="linkish" onClick={() => { disconnect(); setOpen(false); }}>{faceId ? 'Sign out on this device' : email ? 'Sign out' : 'Disconnect'}</button>
            </div>
          )}
        </div>
      </div>
    );
  }
  const pick = async (i: number) => {
    setErr('');
    try { await connect(available[i]); setOpen(false); } catch (e) { setErr(reason(e)); }
  };
  const face = async (kind: 'create' | 'signin') => {
    if (busy) return;
    setErr('');
    setBusy(kind === 'create' ? 'Making your wallet: confirm with Face ID…' : 'Confirm with Face ID…');
    try {
      if (kind === 'create') await createFaceIdWallet();
      else await signInWithFaceId(() => new Promise<void>((resolve) => { setBusy(''); setAgain(() => () => { setAgain(null); setBusy('Confirm with Face ID…'); resolve(); }); }));
      setOpen(false);
    } catch (e) {
      setErr(reason(e));
    } finally {
      setBusy('');
      setAgain(null);
    }
  };
  const emailOn = !!emailConfig?.enabled;
  return (
    <div className="connect-group">
      <div className="connect">
        <button className={`btn ${compact ? 'btn-sm' : ''} ${header ? 'cb cb-connect' : ''} btn-accent`} type="button" aria-label={header ? 'Connect Wallet' : undefined}
          onClick={() => { if (!open) refreshWallets(); setOpen(!open); }} aria-expanded={open}>{header && <WalletIcon />}<span className="cb-text">{header ? 'Connect Wallet' : 'Sign in'}</span></button>
        {open && (
          <div className={`menu ${header ? '' : 'menu-left'}`} role="menu">
            {FACE_ID_OFFERED && (
              <>
                <p className="small"><b>Face ID wallet</b>: no app, no seed phrase. Your phone’s Face ID (or fingerprint) holds the key, backed up by your Apple or Google account.</p>
                <button role="menuitem" type="button" className="wallet-choice" disabled={!!busy || !!again} onClick={() => face('create')}>Create a wallet with Face ID</button>
                <button role="menuitem" type="button" className="wallet-choice" disabled={!!busy || !!again} onClick={() => face('signin')}>Sign in with Face ID</button>
                {again && (
                  <>
                    <p className="small" role="status">This wallet hasn’t been used yet, so Face ID is needed once more to find it.</p>
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                    <button role="menuitem" type="button" className="btn btn-accent btn-sm" onClick={again} autoFocus>Confirm once more</button>
                  </>
                )}
                {busy && <p className="small muted" role="status">{busy}</p>}
              </>
            )}
            {available.length > 0 && <p className="muted small">{FACE_ID_OFFERED ? 'Or a browser wallet' : 'Connect a wallet'}</p>}
            {available.length === 0 && !FACE_ID_OFFERED && (
              <div className="small" role="status">
                <p><b>No wallet found in this browser.</b></p>
                <p className="muted">MINTA works with a browser wallet such as MetaMask, Rabby or Coinbase Wallet. On a phone, open this page in your wallet app’s own browser.</p>
                <p><a href="https://vyrechain.com/docs/network/" target="_blank" rel="noopener noreferrer">How to add VYRE Testnet to your wallet</a></p>
              </div>
            )}
            {available.map((w, i) => (
              <button key={w.id} role="menuitem" type="button" className="wallet-choice" disabled={!!busy || !!again} onClick={() => pick(i)}>
                {w.icon && <img src={w.icon} alt="" width={20} height={20} />}{w.name}
              </button>
            ))}
            {emailOn && <button role="menuitem" type="button" className="wallet-choice" disabled={!!busy || !!again} onClick={() => { setOpen(false); setEmailOpen(true); }}>Sign in with email</button>}
            {err && <p className="err small" role="alert">{err}</p>}
          </div>
        )}
      </div>
      {emailOn && !header && (
        <button className={`btn btn-line ${compact ? 'btn-sm' : ''}`} type="button" onClick={() => setEmailOpen(true)}>Sign in with email</button>
      )}
      {emailOpen && <EmailSignIn onClose={() => setEmailOpen(false)} />}
    </div>
  );
}

/**
 * "Confirm with Face ID": shown before each Face ID prompt, with the most the network fee can be; the prompt then
 * comes straight from the tap (phones' browsers allow a passkey prompt only right after one)
 */
export function FaceIdConfirm() {
  const req = useConfirmRequest();
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') req.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  return createPortal(
    <div className="modal modal-top" role="dialog" aria-modal="true" aria-labelledby="faceid-confirm-title" onClick={(e) => { if (e.target === e.currentTarget) req.cancel(); }}>
      <div className="modal-card">
        <h2 className="h3" id="faceid-confirm-title">Confirm with Face ID</h2>
        <p className="small">Network fee: at most {amount(req.maxCost, 4)} USDC, usually much less. What isn’t used stays with your wallet.</p>
        <div className="row dialog-actions">
          <button type="button" className="btn btn-line" onClick={req.cancel}>Cancel</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" className="btn btn-accent" onClick={req.confirm} autoFocus>Confirm with Face ID</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Email sign-in: VYRE asks Circle to email a code; Circle's own window takes the code and makes the wallet */
function EmailSignIn({ onClose }: { onClose: () => void }) {
  const { signInEmail } = useWallet();
  const [address, setAddress] = useState('');
  const [st, setSt] = useState<{ kind: 'idle' | 'busy' | 'err'; text?: string }>({ kind: 'idle' });
  const busy = st.kind === 'busy';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setSt({ kind: 'busy', text: 'Starting…' });
    try {
      await signInEmail(address, (text) => setSt({ kind: 'busy', text }));
      onClose();
    } catch (x) {
      setSt({ kind: 'err', text: reason(x) });
    }
  };
  // on the page's body: the header's blur would otherwise hold a fixed overlay inside the header
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="email-signin-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form className="modal-card" onSubmit={go}>
        <h2 id="email-signin-title" className="h3">Sign in with email</h2>
        <p className="small">No wallet app needed. We email you a code; you enter it in Circle’s window, and your wallet is ready. The first time, you also confirm the new wallet there.</p>
        <label className="field"><span>Your email</span>
          <input type="email" inputMode="email" autoComplete="email" required maxLength={254} value={address} disabled={busy}
            onChange={(e) => setAddress(e.target.value)} placeholder="you@example.com" autoFocus />
        </label>
        <div className="row">
          <button className="btn btn-accent" type="submit" disabled={busy || !address.includes('@')}>{busy ? 'Working…' : 'Send code'}</button>
          <button className="linkish small" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
        {st.text && <p className={`status ${st.kind}`} role="status" aria-live="polite">{st.text}</p>}
        <p className="small muted fine">Your wallet is made and kept by Circle (its user-controlled wallets): only you can move its money, by confirming in Circle’s window, and VYRE never holds a key. Keep access to this email: it’s how you get back in. On the testnet the wallet holds USDC on Arc and can move it to VYRE; trading with it on VYRE opens when Circle supports VYRE.</p>
      </form>
    </div>,
    document.body,
  );
}

/** In place of a VYRE transaction button, for an email wallet that can't sign on VYRE yet */
export function EmailTradeNote() {
  return <p className="note small" role="note">{EMAIL_TRADE_NOTE}</p>;
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string; hash?: string; chainId?: number };

/** A transaction's page on its own chain's explorer: VYRE's, Arc testnet's, or that of a chain USDC comes from */
export const txUrl = (hash: string, chainId?: number) => `${chainName(chainId)[1]}/tx/${hash}`;

/** A chain's name for links ('' for VYRE), and its explorer */
function chainName(chainId?: number): [string, string] {
  if (chainId === arcTestnet.id) return ['Arc', ARC_EXPLORER];
  const src = CCTP_SOURCES.find((s) => s.id === chainId);
  return src ? [src.name, src.explorer] : ['', EXPLORER];
}

/** A button that runs one transaction (which the SDK simulates before the wallet sees it) and shows how it went */
export function TxButton({ label, run, disabled, className = 'btn btn-accent', onDone }: {
  label: string; run: (say: (t: string) => void) => Promise<{ hash?: string; text?: string; chainId?: number } | void>; disabled?: boolean;
  className?: string; onDone?: () => void;
}) {
  const [st, setSt] = useState<Status>({ kind: 'idle' });
  // one run at a time, even if a second click lands before the button shows it's busy
  const running = useRef(false);
  const go = async () => {
    if (running.current) return;
    running.current = true;
    try { await attempt(); } finally { running.current = false; }
  };
  const attempt = async () => {
    setSt({ kind: 'busy', text: 'Checking…' });
    let r: { hash?: string; text?: string; chainId?: number } | void;
    try {
      r = await run((t) => setSt({ kind: 'busy', text: t }));
    } catch (e) {
      // a transaction sent but not confirmed yet (the SDK's SentButUnconfirmedError, or a deposit still on its way)
      // carries its hash and chain: link it, so it's checked rather than sent again. Anything can be thrown, null too.
      const x = e !== null && typeof e === 'object' ? (e as { hash?: unknown; chainId?: unknown; userOperation?: unknown; operation?: { sender?: unknown; nonce?: unknown } }) : {};
      // a Face ID wallet's operation has no transaction to link until it's mined; its next operation looks for it first
      // (said only where it's written down: this device, or this page where the browser isn't keeping site data)
      const op = x.userOperation === true;
      const o = x.operation;
      const where = op && o && typeof o.sender === 'string' && typeof o.nonce === 'bigint' ? kept(o.sender as Address, o.nonce) : 'no';
      setSt({
        kind: 'err',
        text: !op ? reason(e)
          : where === 'device' ? 'Sent with Face ID, but its result isn’t readable yet. Your next tap on this device looks for it first, so it can’t happen twice from here.'
          : where === 'page' ? 'Sent with Face ID, but its result isn’t readable yet. Keep this page open: your next tap here looks for it first, so it can’t happen twice (this browser isn’t keeping site data right now).'
          : 'Sent with Face ID, but its result isn’t readable yet. Look at your wallet on the explorer before trying again.',
        hash: typeof x.hash === 'string' && !op ? x.hash : undefined,
        chainId: typeof x.chainId === 'number' ? x.chainId : undefined,
      });
      return;
    }
    setSt({ kind: 'ok', text: r?.text || 'Done.', hash: r?.hash, chainId: r?.chainId });
    try { onDone?.(); } catch { /* the transaction went through; a failed refresh after it isn't its failure */ }
  };
  return (
    <div className="tx">
      <button className={className} type="button" onClick={go} disabled={disabled || st.kind === 'busy'}>{st.kind === 'busy' ? 'Working…' : label}</button>
      {st.kind !== 'idle' && (
        <p className={`status ${st.kind}`} role="status" aria-live="polite">
          {st.text}{' '}
          {st.hash && /^0x[0-9a-fA-F]{64}$/.test(st.hash) && <a href={txUrl(st.hash, st.chainId)} target="_blank" rel="noopener noreferrer">{chainName(st.chainId)[0] ? `See it on ${chainName(st.chainId)[0]}` : 'See it'}</a>}
        </p>
      )}
    </div>
  );
}

export function useMeta(uri?: string): Meta | null {
  const [m, setM] = useState<Meta | null>(null);
  useEffect(() => {
    let live = true;
    setM(null);
    if (uri) metaOf(uri).then((x) => live && setM(x));
    return () => { live = false; };
  }, [uri]);
  return m;
}

/** The launch's picture, or art drawn from its address when it has none */
export function TokenPic({ uri, symbol, token, size = 44 }: { uri?: string; symbol: string; token?: string; size?: number }) {
  const m = useMeta(uri);
  const [broken, setBroken] = useState(false);
  if (m?.image && !broken) {
    return <img className="pic" src={m.image} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="pic pic-art" style={{ width: size, height: size }} aria-hidden="true"><TokenArt seed={token || symbol} /></span>;
}

export function AddressLink({ address, label }: { address: Address; label?: ReactNode }) {
  return <a className="mono" href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer">{label ?? short(address)}</a>;
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted loading">{what}…</p>;
}
