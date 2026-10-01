// Routes after the # (https://<MINTA's address>/#/token/0x...), so the static site needs no rewrite rules.
// A promoter's link carries ?ref=0x... (before or after the #); the app remembers it on this device until the visitor
// names a promoter on chain (once, for good) or clears it.
import { useEffect, useState } from 'react';
import { getAddress, type Address } from 'viem';
import { isPromoterCode, promoterWallet } from './api';

export type Route =
  | { page: 'explore'; q?: string }
  | { page: 'token'; token: Address }
  | { page: 'manage'; token: Address }
  | { page: 'launch' }
  | { page: 'portfolio' }
  | { page: 'wallet' }
  | { page: 'docs'; article?: string; section?: string };

const addr = (s?: string): Address | null => (s && /^0x[0-9a-fA-F]{40}$/.test(s) ? getAddress(s) : null);

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [, page, arg] = path.split('/');
  if (page === 'token' && addr(arg)) return { page: 'token', token: addr(arg)! };
  if (page === 'manage' && addr(arg)) return { page: 'manage', token: addr(arg)! };
  if (page === 'launch') return { page: 'launch' };
  if (page === 'portfolio') return { page: 'portfolio' };
  if (page === 'wallet') return { page: 'wallet' };
  if (page === 'docs') {
    const slug = (v?: string | null) => (v && /^[a-z-]{1,40}$/.test(v) ? v : undefined);
    const article = slug(arg), section = slug(new URLSearchParams(query).get('s'));
    return { page: 'docs', ...(article ? { article } : {}), ...(section ? { section } : {}) };
  }
  const q = new URLSearchParams(query).get('q')?.trim().slice(0, 64);
  return q ? { page: 'explore', q } : { page: 'explore' };
}

export const href = (r: Route): string => {
  switch (r.page) {
    case 'token': return `#/token/${r.token}`;
    case 'manage': return `#/manage/${r.token}`;
    case 'explore': return r.q ? `#/?q=${encodeURIComponent(r.q)}` : '#/';
    case 'docs': return `#/docs${r.article ? `/${r.article}` : ''}${r.section ? `?s=${r.section}` : ''}`;
    default: return `#/${r.page}`;
  }
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const REF = 'vyre.ref';
const REF_CODE = 'vyre.refCode'; // the promoter's code, when the link used one (vyrechain.com/r/<code> sends the visitor here with ?ref=<code>)
/** Remembers a ?ref= (a promoter's wallet, or their approved code) from the link the visitor arrived by; pages showing
 * the promoter hear about it through a 'vyre-ref' event, since a code is looked up after the page has drawn */
export function captureRef(): void {
  const q = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
  const raw = q.get('ref') || '';
  const told = () => window.dispatchEvent(new Event('vyre-ref'));
  const r = addr(raw || undefined);
  if (r) { try { localStorage.setItem(REF, r); localStorage.removeItem(REF_CODE); } catch { /* private mode */ } told(); return; }
  if (!isPromoterCode(raw)) return;
  const look = (tries: number): void => {
    promoterWallet(raw).then((p) => {
      const w = p && addr(p.wallet);
      if (w) { try { localStorage.setItem(REF, w); localStorage.setItem(REF_CODE, p.code); } catch { /* private mode */ } told(); }
    }).catch(() => { if (tries < 4) setTimeout(() => look(tries + 1), 3000 * (tries + 1)); }); // busy: ask again
  };
  look(0);
}
export function storedRef(): Address | null {
  try { return addr(localStorage.getItem(REF) || undefined); } catch { return null; }
}
/** The stored promoter's code, if they came by a code link */
export function storedRefCode(): string | null {
  try { const c = localStorage.getItem(REF_CODE) || ''; return isPromoterCode(c) ? c.toLowerCase() : null; } catch { return null; }
}
export function clearRef(): void {
  try { localStorage.removeItem(REF); localStorage.removeItem(REF_CODE); } catch { /* private mode */ }
}
