// MINTA's docs: what it is, how a launch works, the fees, and the contracts and SDK for builders. Everything here
// describes what the contracts do today on the testnet; nothing is promised that isn't built.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { href } from '../lib/router';
import { addresses } from '../lib/market';
import { EXPLORER } from '../lib/chain';
import { VyreGlyph } from '../components/Brand';
import './docs.css';

/** The pictures (public/art, served beside the app) */
const ART = '/art/';
const SDK_FILE = 'https://vyrechain.com/sdk/vyrechain-sdk-0.5.0.tgz';

type Section = { id: string; title: string; body: ReactNode; label?: string; nav?: string; art?: string };
type Article = { slug: string; title: string; intro?: ReactNode; sections: Section[] };
type Item = { label: string; icon: IconName; article: string; section?: string };
type Group = { title: string; items: Item[] };

type IconName = 'doc' | 'bolt' | 'shield' | 'chain' | 'rocket' | 'lock' | 'clock' | 'coin' | 'fee' | 'code' | 'users' | 'plug' | 'book' | 'help' | 'mail';
const ICONS: Record<IconName, string> = {
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h6M9.5 16h6',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  shield: 'M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z',
  chain: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M8 9l4 7 4-7',
  rocket: 'M14 4c3 0 6 1 6 1s1 3 1 6l-5 5-6-6zM9 9l-5 1 3 3M15 15l-1 5-3-3M15 8.5h.01',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  clock: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 7.5V12l3 2',
  coin: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 8v8M9.5 10c0-1 1-1.5 2.5-1.5s2.5.5 2.5 1.5-1 1.2-2.5 1.5-2.5.5-2.5 1.5 1 1.5 2.5 1.5 2.5-.5 2.5-1.5',
  fee: 'M5 7h14M5 12h14M5 17h9',
  code: 'M9 8l-5 4 5 4M15 8l5 4-5 4M13.5 6l-3 12',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 3-5 6-5s6 2 6 5M16 11a2.5 2.5 0 1 0 0-5M17 14c2.5.3 4 2 4 4.5',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  book: 'M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2zM5 20a2 2 0 0 0 2 1h12',
  help: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M9.7 9.5a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.8M12 16.5h.01',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
};
const Icon = ({ name }: { name: IconName }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;

const Arrow = () => <svg className="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const Ext = ({ to, children }: { to: string; children: ReactNode }) => <a href={to} target="_blank" rel="noopener noreferrer">{children}</a>;
const Code = ({ children }: { children: string }) => <pre className="code"><code>{children}</code></pre>;

function ContractTable() {
  const a = addresses();
  const rows: [string, string, string][] = [
    ['VyrePad', a.pad, 'Launches tokens (one transaction each) and holds every launch’s settings'],
    ['VyreAppRouter', a.appRouter, 'Buys and sells launch tokens for apps and pays promoters'],
    ['VyreReferrals', a.referrals, 'Records which promoter brought each wallet'],
    ['VyreFeeSplitter', a.feeSplitter, 'Splits the platform fee between the platform, partner launchpads and promoters'],
    ['VyrePoolFactory', a.poolFactory, 'Creates launch pools (Uniswap v3 design; only the launchpad adds liquidity)'],
    ['SwapRouter', a.swapRouter, 'Uniswap v3’s router, for these pools'],
    ['QuoterV2', a.quoter, 'Uniswap v3’s quoter: prices a trade without making it'],
    ['WUSDC', a.wusdc, 'Wrapped USDC, what launch pools trade against'],
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Contract</th><th>Address</th><th>What it does</th></tr></thead>
        <tbody>
          {rows.map(([n, addr, what]) => (
            <tr key={n}><td><b>{n}</b></td><td className="mono"><Ext to={`${EXPLORER}/address/${addr}`}>{addr.slice(0, 8)}…{addr.slice(-6)}</Ext></td><td className="wrap">{what}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ARTICLES: Article[] = [
  {
    slug: 'introduction',
    title: 'Introduction',
    sections: [
      {
        id: 'what-is-minta', title: 'What is MINTA?', label: 'Introduction', nav: 'What is MINTA?', art: 'whatis',
        body: (
          <>
            <p>MINTA is a launchpad on the VYRE chain. Anyone can create a token in one transaction, trade it with USDC, and earn a tax on every trade of a token they created.</p>
            <p>Each token’s whole supply goes into its own pool from the first block, and that pool’s liquidity is locked for good. There is no approval step, no schedule and no waiting list: you launch when you like, and the token is trading in the same moment.</p>
          </>
        ),
      },
      {
        id: 'key-features', title: 'Why MINTA?', label: 'Key features', nav: 'Key features',
        body: (
          <div className="feat-grid">
            <div><Icon name="bolt" /><b>Easy token creation</b><p>Name it, set the supply and the tax, press Create. One transaction.</p></div>
            <div><Icon name="lock" /><b>Locked liquidity</b><p>The pool’s liquidity can’t be removed, by anyone, ever. Only the launchpad adds to it.</p></div>
            <div><Icon name="coin" /><b>Paid in USDC</b><p>Creators keep a tax of up to 10% on every trade, paid in USDC. They can lower it later, never raise it.</p></div>
            <div><Icon name="users" /><b>Your own wallet</b><p>Connect MetaMask, Rabby, Coinbase Wallet or any browser wallet. You keep your keys; MINTA never holds them.</p></div>
          </div>
        ),
      },
      {
        id: 'vyre-chain', title: 'Built on VYRE', label: 'The VYRE chain', nav: 'The VYRE chain',
        body: (
          <>
            <p>MINTA runs on <Ext to="https://vyrechain.com">VYRE</Ext>, an EVM chain where gas is paid in USDC, so there’s no other token to buy first. Blocks are made as soon as a trade arrives (about a quarter of a second), and on the testnet a buy has cost about six millionths of a dollar in gas: <Ext to="https://vyrechain.com/gas">see the measurements and the transactions behind them</Ext>.</p>
            <p>This is a <b>testnet</b>: the USDC is test USDC with no value. Get some from the <Ext to="https://vyrechain.com/faucet/">faucet</Ext>.</p>
          </>
        ),
      },
      {
        id: 'how-it-works', title: 'From idea to trading', label: 'How it works', nav: 'How it works',
        body: (
          <ol className="steps-list">
            <li><b>Get test USDC.</b> Take some from the faucet: the Wallet page has the button.</li>
            <li><b>Create a token.</b> Pick its name, ticker, supply and tax. The launch happens in one transaction, with an optional first buy of your own in the same transaction.</li>
            <li><b>Trade.</b> Anyone can buy and sell with USDC, straight away. Every trade pays the platform fee and the creator’s tax in USDC.</li>
            <li><b>Collect.</b> The creator collects the tax whenever they like, and can split it between up to four wallets.</li>
          </ol>
        ),
      },
    ],
  },
  {
    slug: 'create-a-launch',
    title: 'Create a launch',
    intro: <p>Creating a token takes one page and one transaction.</p>,
    sections: [
      {
        id: 'details', title: 'What you choose',
        body: (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Setting</th><th>Range</th><th>Notes</th></tr></thead>
              <tbody>
                <tr><td><b>Name and ticker</b></td><td>1–64 and 1–16 bytes</td><td className="wrap">Shown everywhere the token appears.</td></tr>
                <tr><td><b>Supply</b></td><td>1,000 to 10<sup>15</sup> tokens</td><td className="wrap">All of it goes into the pool: there is no team allocation held outside it.</td></tr>
                <tr><td><b>Buy and sell tax</b></td><td>0–10% each</td><td className="wrap">Paid to you in USDC. You can lower it later, never raise it.</td></tr>
                <tr><td><b>First buy</b></td><td>Optional</td><td className="wrap">USDC you spend in the launch transaction itself, before anyone else can trade.</td></tr>
                <tr><td><b>Picture, description, links</b></td><td>Optional</td><td className="wrap">A picture from your device, a short description and website, X, Telegram and Discord links. You can change them later.</td></tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: 'opening-price', title: 'The opening price',
        body: <p>Every launch opens at the same market cap, <b>$3,000</b>. It isn’t a setting. The mainnet contract enforces it; the testnet’s contract was deployed before that rule and still accepts other values from a script, so on the testnet it is MINTA and the SDK that hold it. You choose the supply, which sets the price of one token.</p>,
      },
      {
        id: 'steps', title: 'Review, confirm, wait, ready',
        body: <p>Before anything is sent, the Review shows every setting. Then you confirm in your wallet, the transaction is made, and MINTA opens the token’s page when it’s live. If the connection drops, the page checks the launch rather than sending it twice.</p>,
      },
    ],
  },
  {
    slug: 'launch-model',
    title: 'Launch model',
    sections: [
      {
        id: 'instant', title: 'Instant and open',
        body: <p>Anyone can launch at any time with one transaction: no approval, no schedule, no queue. Trading is open to everyone from the first block, bots included. There are no purchase limits or cooldowns.</p>,
      },
      {
        id: 'pools', title: 'Pools and liquidity',
        body: <p>Each token has its own pool, a copy of Uniswap v3 with a few changes: only the launchpad can add liquidity (so there are no outside positions), every fee is paid in USDC and never in the launched token, buys and sells can carry different taxes, and there are no flash loans. Trades are priced exactly as Uniswap v3 prices them, and the pool’s liquidity is locked forever.</p>,
      },
      {
        id: 'one-side', title: 'Honest limits',
        body: <p>Because the exchange is open, someone can open a side pool for a token elsewhere and trade around its tax. The tax applies to trades in the token’s own pool.</p>,
      },
    ],
  },
  {
    slug: 'lifecycle',
    title: 'Launch lifecycle',
    sections: [
      { id: 'create', title: '1. Create', body: <p>The launch transaction creates the token, its pool and the locked liquidity, and makes your optional first buy.</p> },
      { id: 'trade', title: '2. Trade', body: <p>The token trades at once. Its page shows the price, market cap, volume, holders and the trades as they happen.</p> },
      { id: 'milestone', title: '3. Milestone', body: <p>A token that has had enough USDC bought into its pool (net of sales) is marked <b>Graduated</b> on the Launchpad. It’s a label for browsing: nothing changes on chain when a token graduates. On the testnet the line is $100 of USDC bought in.</p> },
      { id: 'manage', title: '4. Manage', body: <p>On the token’s Manage page the creator can collect the tax, lower either tax, split the tax between up to four wallets, update the picture and links, and hand the creator role to another wallet (a two-step handover, so it can’t be sent to the wrong place by mistake).</p> },
    ],
  },
  {
    slug: 'tokenomics',
    title: 'Tokenomics options',
    sections: [
      { id: 'supply', title: 'Supply', body: <p>From 1,000 to 10<sup>15</sup> tokens. The whole supply is in the pool at launch, apart from what you buy yourself with your first buy.</p> },
      { id: 'tax', title: 'Tax', body: <p>0–10% on buys and 0–10% on sells, set separately. Presets in the form: no tax, 1%/1%, 3%/3%, 5%/5%, or custom. A tax only ever goes down.</p> },
      { id: 'split', title: 'Splitting the tax', body: <p>After launch, the tax can be split between up to four wallets in any proportions that add up to 100%. Tax earned so far is paid out before the split changes. Only name wallets whose owners hold the keys: tax sent to a contract or an address nobody controls is lost.</p> },
      { id: 'first-buy', title: 'First buy', body: <p>Optional USDC you spend in the launch transaction, before anyone else can trade, at your own tax plus the platform fee.</p> },
    ],
  },
  {
    slug: 'fees',
    title: 'Fees & revenue',
    sections: [
      {
        id: 'table', title: 'Who gets what',
        body: (
          <>
            <p>Every fee is taken in USDC, from the USDC side of the trade: out of what a buyer pays, or what a seller receives.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fee</th><th>Size</th><th>Goes to</th></tr></thead>
                <tbody>
                  <tr><td><b>Creator’s tax</b></td><td>0–10% per side</td><td className="wrap">The creator, or up to 4 wallets they name</td></tr>
                  <tr><td><b>Platform fee</b></td><td>1% of every buy and sell</td><td className="wrap">The platform treasury set in the launchpad contracts (less a promoter’s share, below)</td></tr>
                  <tr><td><b>Partner fee</b></td><td>0–1%, only on launches through a partner launchpad</td><td className="wrap">The partner launchpad</td></tr>
                  <tr><td><b>Promoter share</b></td><td>30% of the platform fee</td><td className="wrap">The promoter who brought the trader, when the trade goes through the app router</td></tr>
                </tbody>
              </table>
            </div>
          </>
        ),
      },
      {
        id: 'promoters', title: 'Promoters',
        body: <p>A wallet can name the promoter who brought it, once. When it trades through MINTA (or any app using the app router), that promoter is paid 30% of the platform fee in the same transaction, in USDC. Promoters are paid only after signing up and being approved (<Ext to="https://vyrechain.com/promote/">sign up here</Ext>), and the program isn’t available in the UK, the EU, Australia or Singapore. On the testnet it all runs on test USDC.</p>,
      },
    ],
  },
  {
    slug: 'contracts',
    title: 'Smart contracts',
    sections: [
      { id: 'addresses', title: 'Testnet addresses', body: <><p>These are the testnet deployment’s contracts (VYRE Testnet, chain 7357). Click an address to read the verified source on the explorer. Mainnet gets its own deployment.</p><ContractTable /></> },
      {
        id: 'review-status', title: 'Review status',
        body: <p>The contracts have a large test suite (including trade-by-trade comparisons with Uniswap’s own v3 contracts) and have been through review rounds by the network’s operator, who deployed them. They have <b>not</b> had an outside audit yet. Treat the testnet accordingly.</p>,
      },
    ],
  },
  {
    slug: 'sdk',
    title: 'API & SDK',
    sections: [
      {
        id: 'install', title: 'Install',
        body: (
          <>
            <p><code>@vyrechain/sdk</code> is a small TypeScript library on top of viem: the chain definition, the addresses and ABIs, and typed calls for launching, trading and reading launches. Every transaction is simulated before it’s sent, and approvals are for the exact amount. It isn’t on npm yet; it’s served from vyrechain.com:</p>
            <Code>{`npm install ${SDK_FILE} viem`}</Code>
          </>
        ),
      },
      {
        id: 'launch', title: 'Launch from code',
        body: (
          <Code>{`import { launch } from '@vyrechain/sdk'

const { token, pool, bought, hash } = await launch(wallet, client, {
  name: 'My Token',
  symbol: 'MINE',
  totalSupply: parseEther('1000000000'),
  buyTaxBps: 100,   // 1% to you on buys
  sellTaxBps: 100,  // 1% to you on sells
  firstBuyUsdc: parseEther('1'),
})`}</Code>
        ),
      },
      { id: 'reference', title: 'Full reference', body: <p>The complete guide, the API reference and the contract events to index are in the <Ext to="https://vyrechain.com/docs/sdk/">SDK docs</Ext>, the <Ext to="https://vyrechain.com/docs/launchpad/">launchpad reference</Ext> and the <Ext to="https://vyrechain.com/docs/api/">API reference</Ext> on vyrechain.com.</p> },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    sections: [
      { id: 'apps', title: 'Apps and bots', body: <p>Trade through the app router with native USDC (no wrapping, no approval to buy), and be your users’ promoter. The router can charge an app fee on top; it is 0 today, and any change is announced on chain 7 days ahead.</p> },
      { id: 'partners', title: 'Partner launchpads', body: <p>Other launchpads can run on the same contracts under their own brand: launch with your payout address as the partner and a fee of up to 1%. It’s added on top of the creator’s tax and the platform fee (it never comes out of either) and paid to you in USDC. No sign-up or approval is needed.</p> },
      { id: 'own', title: 'Your own launchpad', body: <p>VYRE is an open EVM chain: anyone can deploy anything, including their own launchpad on a standard, unmodified Uniswap v3.</p> },
    ],
  },
  {
    slug: 'guides',
    title: 'Guides & tutorials',
    sections: [
      {
        id: 'links', title: 'Where to start',
        body: (
          <ul className="plain">
            <li><Ext to="https://vyrechain.com/docs/network/">Add VYRE Testnet to your wallet</Ext></li>
            <li><Ext to="https://vyrechain.com/docs/get-usdc/">Get test USDC and move it in and out</Ext></li>
            <li><Ext to="https://vyrechain.com/docs/deploy/">Deploy a contract on VYRE</Ext></li>
            <li><Ext to="https://vyrechain.com/faucet/">The faucet</Ext></li>
          </ul>
        ),
      },
    ],
  },
  {
    slug: 'faq',
    title: 'FAQ',
    sections: [
      {
        id: 'questions', title: 'Common questions',
        body: (
          <div className="faq">
            <details open><summary>What do I need to start?</summary><p>Test USDC (from the faucet) and a browser wallet such as MetaMask, Rabby or Coinbase Wallet, set to VYRE Testnet. It’s a testnet, so nothing costs real money.</p></details>
            <details><summary>Can the liquidity be pulled?</summary><p>No. Each pool’s liquidity is locked in the contract and only the launchpad can add to it; nobody can remove it.</p></details>
            <details><summary>Can a creator raise the tax?</summary><p>No. A creator can lower either tax at any time and can never raise it.</p></details>
            <details><summary>What does a trade cost in gas?</summary><p>On the testnet, a buy has cost about six millionths of a dollar. <Ext to="https://vyrechain.com/gas">Every number links to a real transaction.</Ext></p></details>
            <details><summary>Does MINTA check a transaction before I sign it?</summary><p>Yes, as a hint, for the transactions you send on VYRE from a browser wallet. Just before your wallet asks you to confirm, MINTA asks a check service (api.vyrechain.com) to run the transaction without sending it, and the service looks up the addresses in it with a third-party security service. If it finds something (the transaction would fail, it would let a contract spend an unlimited amount of a token, it would give permission to a contract that isn’t one of the launchpad’s own, or a security service has flagged an address in it), MINTA shows it first, with Continue anyway and Cancel. MINTA’s own approvals are always for the exact amount, so you shouldn’t see this in normal use. It waits less than a second, and if the check is slow or unavailable MINTA goes on without saying anything. It can miss things, so read what your wallet shows before you confirm. (A sale’s exact-amount permission is signed as part of the sale itself, before this check sees the transaction that carries it.) What is sent is listed in the <a href="/privacy/">privacy policy</a>.</p></details>
            <details><summary>Has it had an outside audit?</summary><p>Not yet. The contracts have been through tests and review rounds by the network’s operator, who deployed them, and this is a testnet.</p></details>
            <details><summary>Can I lose money?</summary><p>On the testnet there is no real money. On any chain, launch tokens can go to zero and nothing here is financial advice.</p></details>
          </div>
        ),
      },
    ],
  },
  {
    slug: 'support',
    title: 'Support',
    sections: [
      { id: 'contact', title: 'Getting help', body: <p>Start with the <a href={href({ page: 'docs', article: 'faq' })}>FAQ</a>. When you report a problem to whoever runs the MINTA site you are using, include the transaction link from the explorer if there is one: it shows exactly what happened.</p> },
    ],
  },
];

const GROUPS: Group[] = [
  {
    title: 'Introduction',
    items: [
      { label: 'Introduction', icon: 'doc', article: 'introduction' },
      { label: 'What is MINTA?', icon: 'help', article: 'introduction', section: 'what-is-minta' },
      { label: 'Key features', icon: 'bolt', article: 'introduction', section: 'key-features' },
      { label: 'VYRE chain', icon: 'chain', article: 'introduction', section: 'vyre-chain' },
      { label: 'How it works', icon: 'lock', article: 'introduction', section: 'how-it-works' },
    ],
  },
  {
    title: 'Launchpad',
    items: [
      { label: 'Create a launch', icon: 'rocket', article: 'create-a-launch' },
      { label: 'Launch model', icon: 'shield', article: 'launch-model' },
      { label: 'Launch lifecycle', icon: 'clock', article: 'lifecycle' },
      { label: 'Tokenomics options', icon: 'coin', article: 'tokenomics' },
      { label: 'Fees & revenue', icon: 'fee', article: 'fees' },
    ],
  },
  {
    title: 'Developers',
    items: [
      { label: 'Smart contracts', icon: 'code', article: 'contracts' },
      { label: 'API & SDK', icon: 'code', article: 'sdk' },
      { label: 'Integrations', icon: 'plug', article: 'integrations' },
      { label: 'Guides & tutorials', icon: 'book', article: 'guides' },
    ],
  },
  {
    title: 'Community',
    items: [
      { label: 'FAQ', icon: 'help', article: 'faq' },
      { label: 'Support', icon: 'mail', article: 'support' },
    ],
  },
];

const textOf = (n: ReactNode): string => {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join(' ');
  if (typeof n === 'object' && 'props' in n) return textOf((n as { props: { children?: ReactNode } }).props.children);
  return '';
};

export default function Docs({ article, section }: { article?: string; section?: string }) {
  const art = ARTICLES.find((a) => a.slug === article) ?? ARTICLES[0];
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [active, setActive] = useState(art.sections[0].id);
  const main = useRef<HTMLDivElement>(null);

  // searching: article and section titles, and the words in them
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return null;
    const out: { article: string; section: string; title: string; of: string }[] = [];
    for (const a of ARTICLES) for (const s of a.sections) {
      if (`${a.title} ${s.title} ${textOf(s.body)}`.toLowerCase().includes(t)) out.push({ article: a.slug, section: s.id, title: s.title, of: a.title });
    }
    return out.slice(0, 12);
  }, [q]);

  // opened on a section (or another article): scroll to it
  useEffect(() => {
    const el = section ? document.getElementById(section) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    setActive(section && art.sections.some((s) => s.id === section) ? section : art.sections[0].id);
  }, [art.slug, section]);

  // which section is on screen, for "On this page"
  useEffect(() => {
    const els = art.sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: '-90px 0px -60% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [art.slug]);

  const go = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(id); };
  const intro = art.slug === 'introduction';

  return (
    <div className="docs">
      <aside className="docs-nav" aria-label="Documentation">
        <button type="button" className="docs-nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
          <span className="eyebrow">MINTA docs</span><span className="muted small">{art.title} {navOpen ? '▴' : '▾'}</span>
        </button>
        <div className={`docs-nav-body${navOpen ? ' open' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setNavOpen(false); }}>
        <p className="eyebrow docs-nav-label">MINTA docs</p>
        <label className="docs-search">
          <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documentation…" aria-label="Search documentation" />
        </label>
        {hits ? (
          <ul className="docs-hits" aria-label="Search results">
            {hits.length === 0 && <li className="muted small">Nothing found.</li>}
            {hits.map((h) => <li key={`${h.article}/${h.section}`}><a href={href({ page: 'docs', article: h.article, section: h.section })} onClick={() => setQ('')}><b>{h.title}</b><span className="muted small">{h.of}</span></a></li>)}
          </ul>
        ) : (
          GROUPS.map((g) => (
            <nav key={g.title} className="docs-group" aria-label={g.title}>
              {g.title !== 'Introduction' && <p className="docs-group-title">{g.title}</p>}
              <ul>
                {g.items.map((it) => {
                  // a section's entry is lit when the link names it; the page's own entry when no section is named (or it has none)
                  const on = it.article === art.slug && (it.section ? it.section === section : !intro || !section);
                  return (
                    <li key={it.label}>
                      <a href={href({ page: 'docs', article: it.article, ...(it.section ? { section: it.section } : {}) })} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}><Icon name={it.icon} />{it.label}</a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))
        )}
        </div>
      </aside>

      <div className="docs-main" ref={main}>
        {intro && (
          <header className="docs-hero" style={{ backgroundImage: `url(${ART}hero.webp)` }}>
            <div className="hero-copy">
              <p className="eyebrow">Welcome to MINTA</p>
              <h1 className="display">Build.<br /><em>Launch.</em> Grow.</h1>
              <p className="lede">The launchpad on the VYRE chain.<br />Instant launches. Locked liquidity. Paid in USDC.</p>
              <div className="row">
                <a className="btn btn-accent" href={href({ page: 'launch' })}>Get Started <Arrow /></a>
                <a className="btn btn-line" href={href({ page: 'docs', article: 'launch-model' })}><Icon name="doc" />How launches work</a>
              </div>
            </div>
          </header>
        )}
        {intro && (
          <ul className="hero-cards">
            <li><Icon name="rocket" /><div><b>Instant launches</b><span>One transaction, live at once.</span></div></li>
            <li><Icon name="shield" /><div><b>Built on VYRE</b><span>Gas is USDC; a trade costs a fraction of a cent.</span></div></li>
            <li><Icon name="users" /><div><b>Tools for creators</b><span>Supply, tax, tax split, first buy and links.</span></div></li>
            <li><Icon name="plug" /><div><b>Open to builders</b><span>An SDK, an app router and partner launchpads.</span></div></li>
          </ul>
        )}

        {!intro && <h1 className="docs-title">{art.title}</h1>}
        {!intro && art.intro && <div className="docs-lede">{art.intro}</div>}
        {art.sections.map((s, i) => (
          <section key={s.id} id={s.id} className="docs-section">
            {intro && <span className="num">{String(i + 1).padStart(2, '0')}</span>}
            <div className={`docs-section-in${s.art ? ' with-art' : ''}`}>
              <div className="docs-section-text">
                {(intro || s.label) && <p className="docs-label">{s.label ?? art.title}</p>}
                <h2>{s.title}</h2>
                <div className="docs-body">{s.body}</div>
              </div>
              {s.art && <img className="docs-art" src={`${ART}${s.art}.webp`} alt="" width={349} height={163} loading="lazy" />}
            </div>
          </section>
        ))}
      </div>

      <aside className="docs-rail" aria-label="On this page">
        <div className="rail-card">
          <p className="eyebrow">On this page</p>
          <ul className="toc">
            {art.sections.map((s) => <li key={s.id}><button type="button" className={active === s.id ? 'on' : ''} onClick={() => go(s.id)}>{s.nav ?? s.title}</button></li>)}
          </ul>
        </div>
        <div className="rail-card rail-chain" style={{ backgroundImage: `url(${ART}chain-card.webp)` }}>
          <div className="rail-chain-head"><VyreGlyph size={44} /><span className="rule" aria-hidden="true" /><p className="eyebrow">VYRE chain</p></div>
          <p className="small">MINTA runs on VYRE, an EVM chain where gas is USDC.</p>
          <a className="btn btn-line btn-sm" href="https://vyrechain.com" target="_blank" rel="noopener noreferrer">Learn about VYRE <Arrow /></a>
        </div>
        <div className="rail-card rail-help">
          <div className="rail-help-head"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z" /><path d="M9 9h6M9 12h4" /></svg><div><p className="rail-title">Need Help?</p><p className="small">Read the FAQ.</p></div></div>
          <div className="row">
            <a className="btn btn-line btn-sm" href={href({ page: 'docs', article: 'faq' })}>View FAQ <Arrow /></a>
          </div>
        </div>
        <div className="rail-card rail-cta">
          <img src={`${ART}coins.webp`} alt="" width={254} height={88} loading="lazy" />
          <p className="rail-cta-title">Create a launch<br />on MINTA</p>
          <p className="small">Turn your idea into a token on VYRE.</p>
          <a className="btn btn-accent" href={href({ page: 'launch' })}>Start Now <Arrow /></a>
        </div>
      </aside>
    </div>
  );
}
