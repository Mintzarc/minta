// The WalletConnect connect sheet: MINTA's own (the library's modal is not used, so no outside list of wallets or pictures is loaded).
// It shows the connection's state: asking, waiting for the wallet (a code to scan and a link to open or copy), or why it failed.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { useWallet } from '../lib/wallet';
import { TRUST_WALLET_LINK } from '../lib/twa';
import { trustWalletWcLink, type WcFailure } from '../lib/wcstate';

/** A code that holds `text`, drawn as one path (no outside picture, no script-made markup) */
export function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg className="wc-qr" viewBox={`-4 -4 ${n + 8} ${n + 8}`} role="img" aria-label="Code to scan with your wallet app" shapeRendering="crispEdges">
      <rect x="-4" y="-4" width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const relayFailure = (why: WcFailure) => why === 'relay' || why === 'timeout';

export default function WalletConnectSheet() {
  const { wcState, connectWalletConnect, cancelWalletConnect } = useWallet();
  const [copied, setCopied] = useState(false);
  const shown = wcState.kind === 'starting' || wcState.kind === 'waiting' || wcState.kind === 'failed';
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelWalletConnect(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, cancelWalletConnect]);
  useEffect(() => { setCopied(false); }, [wcState.kind]);
  if (!shown) return null;
  const uri = wcState.kind === 'waiting' ? wcState.uri : '';
  const trust = uri ? trustWalletWcLink(uri) : null;
  const copy = () => { navigator.clipboard?.writeText(uri).then(() => setCopied(true), () => setCopied(false)); };
  return createPortal(
    <div className="modal modal-top" role="dialog" aria-modal="true" aria-labelledby="wc-title" onClick={(e) => { if (e.target === e.currentTarget) cancelWalletConnect(); }}>
      <div className="modal-card">
        <h2 className="h3" id="wc-title">Connect with WalletConnect</h2>
        {wcState.kind === 'starting' && <p className="small" role="status">Contacting the WalletConnect service…</p>}
        {wcState.kind === 'waiting' && (
          <>
            <p className="small" role="status">Open your wallet app and approve the connection there. You can come back here after.</p>
            <div className="row">
              {trust && <a className="btn btn-accent btn-sm" href={trust}>Open Trust Wallet</a>}
              <button type="button" className="btn btn-line btn-sm" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
            </div>
            <p className="muted small">Another wallet app: copy the link, open the app and look for WalletConnect (or its scan button) to paste it.</p>
            <p className="muted small">Or scan this code with your wallet app (on a computer, or with a second device).</p>
            <QrCode text={uri} />
          </>
        )}
        {wcState.kind === 'failed' && (
          <>
            <p className="err small" role="alert">{wcState.message}</p>
            {relayFailure(wcState.why) && <p className="small"><a className="btn btn-line btn-sm" href={TRUST_WALLET_LINK} target="_blank" rel="noopener noreferrer">Open in Trust Wallet</a></p>}
          </>
        )}
        <p className="muted small">The WalletConnect service passes messages between this page and your wallet app, and sees your IP address while it does. It never gets your keys. MINTA sends nothing but this connection to it.</p>
        <div className="row dialog-actions">
          {wcState.kind === 'failed' && <button type="button" className="btn btn-line" onClick={connectWalletConnect}>Try again</button>}
          <button type="button" className="btn btn-line" onClick={cancelWalletConnect}>{wcState.kind === 'failed' ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
