// The pre-sign check's dialog (src/lib/txcheck.ts): opens over the page, before the wallet's own prompt, only when the check
// found something. It lists what it found in MINTA's own words and has two buttons. It never calls a transaction safe: with
// nothing found, nothing is shown at all.
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { currentRequest, describe, subscribeRequests } from '../lib/txcheck';

export default function TxCheckDialog() {
  const req = useSyncExternalStore(subscribeRequests, currentRequest, () => null);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') req.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  // on the page's body, above any other dialog (the launch's review, say)
  return createPortal(
    <div className="modal modal-top" role="alertdialog" aria-modal="true" aria-labelledby="txc-title" aria-describedby="txc-desc" onClick={(e) => { if (e.target === e.currentTarget) req.cancel(); }}>
      <div className="modal-card">
        <h2 className="h3" id="txc-title">Before you continue</h2>
        <p className="small" id="txc-desc">A check of this transaction found something worth a look before your wallet asks you to sign it:</p>
        <ul className="txc-list">
          {req.concerns.map((c, i) => {
            const d = describe(c);
            return (
              <li key={`${c.code}-${c.address ?? ''}-${i}`}>
                <span>{d.text}</span>
                {d.where && <span className="muted small">{d.where[0].toUpperCase() + d.where.slice(1)}:</span>}
                {d.address && <span className="mono break">{d.address}</span>}
              </li>
            );
          })}
        </ul>
        <p className="small muted">The check is only a hint, and it can miss things. If you don’t recognise what it describes, cancel.</p>
        <div className="row dialog-actions">
          <button type="button" className="btn btn-line" onClick={req.proceed}>Continue anyway</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" className="btn btn-accent" onClick={req.cancel} autoFocus>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
