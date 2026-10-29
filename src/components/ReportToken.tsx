// "Report this token": anyone can flag a token whose name, picture, description or links break the terms (section 8). MINTA keeps
// no server for reports, so nothing is sent from here: the panel gives the message to copy and links to MINTA's own Telegram group
// and X account, and to an email address once the owner confirms it (REPORT_EMAIL in src/lib/contact.ts, empty until then),
// where the reports are read. It collects nothing.
import { useState } from 'react';
import type { Address } from 'viem';
import { REPORT_EMAIL, REPORT_TELEGRAM, REPORT_X, reportMailto, reportText } from '../lib/contact';

export function ReportToken({ token, sym, email = REPORT_EMAIL, defaultOpen = false }: { token: Address; sym: string; email?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const text = reportText(sym, token);
  const mail = reportMailto(email, sym, token);
  const copy = () => { navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false)); };
  return (
    <div className="report-token">
      <button type="button" className="linkish small" aria-expanded={open} onClick={() => setOpen(!open)}>Report this token</button>
      {open && (
        <div className="note small" role="note">
          <p>Names, pictures, descriptions and links are made by whoever launched the token. If this one is unlawful, hateful, a copy of someone else&rsquo;s work, or deceives people, tell MINTA. Copy this message, add what is wrong, and send it to MINTA {mail ? 'on Telegram, on X or by email' : 'on Telegram or X'}. MINTA may stop showing a token it is told about.</p>
          <p className="mono break">{text}</p>
          <p>
            <button type="button" className="btn btn-line btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy the message'}</button>{' '}
            <a className="btn btn-line btn-sm" href={REPORT_TELEGRAM} target="_blank" rel="noopener noreferrer">Telegram</a>{' '}
            <a className="btn btn-line btn-sm" href={REPORT_X} target="_blank" rel="noopener noreferrer">X</a>
            {mail && <>{' '}<a className="btn btn-line btn-sm" href={mail}>Email</a></>}
          </p>
        </div>
      )}
    </div>
  );
}
