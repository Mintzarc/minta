// Tokens hidden on this device (src/lib/hidden.ts): the list as a hook, the "Hide this token" button, and "Show all".
import { useEffect, useState } from 'react';
import { VYRE_CHAIN } from '../lib/chain';
import { hideToken, loadHidden, showAllTokens, showToken } from '../lib/hidden';
import { storeKey } from '../lib/storeKey';

const KEY = storeKey('minta.hidden', VYRE_CHAIN.id);
const EVENT = 'minta-hidden-changed';
const store = () => { try { return window.localStorage; } catch { return null; } };
const announce = () => window.dispatchEvent(new Event(EVENT));

/** The hidden addresses, kept current across the page's parts and other tabs */
export function useHidden(): string[] {
  const [list, setList] = useState<string[]>(() => loadHidden(store(), KEY));
  useEffect(() => {
    const on = () => setList(loadHidden(store(), KEY));
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return list;
}

export const hide = (token: string) => { hideToken(store(), KEY, token); announce(); };
export const show = (token: string) => { showToken(store(), KEY, token); announce(); };
export const showAll = () => { showAllTokens(store(), KEY); announce(); };

/** "Hide this token" on a token's page, and "Show it again" once hidden: only on this device */
export function HideToken({ token }: { token: string }) {
  const hidden = useHidden().includes(token.toLowerCase());
  return hidden
    ? <p className="small muted hide-token">Hidden on this device. <button type="button" className="linkish" onClick={() => show(token)}>Show it again</button></p>
    : <button type="button" className="linkish small hide-token" onClick={() => hide(token)}>Hide this token</button>;
}

/** "N tokens hidden on this device. Show all": nothing when none are hidden */
export function HiddenNote() {
  const n = useHidden().length;
  if (n === 0) return null;
  return <p className="small muted hidden-note">{n} {n === 1 ? 'token is' : 'tokens are'} hidden on this device. <button type="button" className="linkish" onClick={showAll}>Show all</button></p>;
}
