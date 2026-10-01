import { useCallback, useEffect, useRef, useState } from 'react';
import { captureRef, href, useRoute, type Route } from './lib/router';
import { ConnectButton, FaceIdConfirm } from './components/ui';
import { SearchPanel, shortcutLabel, useSearchShortcut } from './components/Search';
import Explore from './pages/Explore';
import Token from './pages/Token';
import Launch from './pages/Launch';
import Manage from './pages/Manage';
import Portfolio from './pages/Portfolio';
import Wallet from './pages/Wallet';
import Docs from './pages/Docs';
import { MintaLogo, VyreGlyph } from './components/Brand';
import { EXPLORER } from './lib/chain';
import Ticker from './components/Ticker';

const NAV: { label: string; route: Route }[] = [
  { label: 'Launchpad', route: { page: 'explore' } },
  { label: 'Create', route: { page: 'launch' } },
  { label: 'Portfolio', route: { page: 'portfolio' } },
  { label: 'Wallet', route: { page: 'wallet' } },
  { label: 'Docs', route: { page: 'docs' } },
];
const ExternalIcon = () => <svg className="ic ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;

export default function App() {
  const route = useRoute();
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useSearchShortcut(openSearch);
  useEffect(() => { captureRef(); }, []);
  const at = (r: Route) => r.page === route.page || (r.page === 'explore' && route.page === 'token');
  return (
    <>
      <Ticker />
      <header className="top">
        <div className="top-in">
          <a className="brand" href={href({ page: 'explore' })} aria-label="MINTA home"><MintaLogo size={54} /></a>
          <nav className="nav" aria-label="App">
            {NAV.map((n) => <a key={n.label} href={href(n.route)} aria-current={at(n.route) ? 'page' : undefined}>{n.label}</a>)}
            <a className="nav-ext" href="https://vyrechain.com" target="_blank" rel="noopener noreferrer">VYRE<ExternalIcon /></a>
          </nav>
          <div className="top-actions">
            <button type="button" className="search-trigger icon-btn" onClick={openSearch} aria-haspopup="dialog" aria-label="Search tokens">
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <span className="st-text">Search</span><kbd>{shortcutLabel()}</kbd>
            </button>
            <a className="icon-btn create-btn" href={href({ page: 'launch' })} aria-label="Create a token" title="Create a token">
              <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </a>
            <ChainSelect />
            <ConnectButton compact header />
            <Menu at={at} />
          </div>
        </div>
      </header>
      <main className={`main${route.page === 'docs' ? ' flush' : route.page === 'launch' ? ' wide' : ''}`}>
        {route.page === 'explore' && <Explore q={route.q} />}
        {/* keyed by token: another token's page starts fresh, never showing the last one's figures */}
        {route.page === 'token' && <Token key={route.token} token={route.token} />}
        {route.page === 'launch' && <Launch />}
        {route.page === 'manage' && <Manage key={route.token} token={route.token} />}
        {route.page === 'portfolio' && <Portfolio />}
        {route.page === 'wallet' && <Wallet />}
        {route.page === 'docs' && <Docs article={route.article} section={route.section} />}
      </main>
      <FaceIdConfirm />
      <footer className="foot">
        <p>MINTA on the VYRE testnet: test USDC, no real money. Trading is risky and launch tokens can go to zero; nothing here is advice.
          USDC is issued by Circle, which isn’t affiliated with MINTA or VYRE. <a href={href({ page: 'docs' })}>Docs</a> · <a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a> · <a href="https://explorer.vyrechain.com" target="_blank" rel="noopener noreferrer">Explorer</a></p>
      </footer>
      {searching && <SearchPanel initial={route.page === 'explore' ? route.q : ''} onClose={() => setSearching(false)} />}
    </>
  );
}

/** The chain MINTA runs on: its name, and where to read about it (it is the one chain, so this is a menu, not a switch) */
function ChainSelect() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="chain-select" ref={box}>
      <button type="button" className="chain-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <VyreGlyph size={26} /><span className="chain-name">VYRE Testnet</span>
        <span className="chain-sep" aria-hidden="true" />
        <svg className="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="menu chain-menu" role="menu" onClick={() => setOpen(false)}>
          <p className="muted small">MINTA runs on</p>
          <p className="chain-current"><VyreGlyph size={18} /><b>VYRE Testnet</b><span className="muted small">chain 7357</span></p>
          <a role="menuitem" href="https://vyrechain.com" target="_blank" rel="noopener noreferrer">About VYRE</a>
          <a role="menuitem" href={EXPLORER} target="_blank" rel="noopener noreferrer">Explorer</a>
          <a role="menuitem" href="https://vyrechain.com/faucet/" target="_blank" rel="noopener noreferrer">Faucet</a>
        </div>
      )}
    </div>
  );
}

/** The phone's menu: every page, the docs and the faucet (the top bar's links are hidden on small screens) */
function Menu({ at }: { at: (r: Route) => boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('hashchange', shut);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); window.removeEventListener('hashchange', shut); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={box}>
      <button type="button" className="icon-btn menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {open && (
        <nav className="menu drawer" aria-label="Menu">
          {NAV.map((n) => <a key={n.label} href={href(n.route)} aria-current={at(n.route) ? 'page' : undefined}>{n.label}</a>)}
          <hr />
          <a href="https://vyrechain.com/faucet/" target="_blank" rel="noopener noreferrer">Faucet</a>
          <a href="https://explorer.vyrechain.com" target="_blank" rel="noopener noreferrer">Explorer</a>
          <a href="https://vyrechain.com" target="_blank" rel="noopener noreferrer">VYRE</a>
        </nav>
      )}
    </div>
  );
}
