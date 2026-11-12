// The extra content policy of a MAINNET build, written into its index.html as a <meta> tag by vite.config.ts.
//
// vercel.json sends one policy header for every build of this repository, and the test network's build needs a wide one (other
// chains' RPCs for transfers, the faucet, Circle's email sign-in frame, launch files on any site). A browser applies a page's
// header policy AND its meta policy together, so a mainnet page is held to both: this one lists the only hosts a mainnet page
// talks to, draws pictures from, or frames. A script that ended up in the bundle could send nothing anywhere else.
export const MAINNET_CONNECT = [
  "'self'",
  'https://rpc.vyrechain.com', // the chain
  'https://api.vyrechain.com', // pictures, launch files, the check before signing, card top-up links
  'https://explorer.vyrechain.com', // block times for the 24-hour figures
  'https://rpc.mainnet.arc.io', // the Wallet page's reads of Arc
  'wss://relay.walletconnect.org', // WalletConnect's relay
  'https://verify.walletconnect.org', // WalletConnect's verification service (the same host as its frame)
];
export const MAINNET_IMG = ["'self'", 'data:', 'https://api.vyrechain.com'];
export const MAINNET_FRAME = ['https://verify.walletconnect.org'];

/** The policy string of the meta tag */
export const mainnetPolicy = () => `connect-src ${MAINNET_CONNECT.join(' ')}; img-src ${MAINNET_IMG.join(' ')}; frame-src ${MAINNET_FRAME.join(' ')}`;

/** The tag, as written right after <head> */
export const mainnetPolicyTag = () => `<meta http-equiv="Content-Security-Policy" content="${mainnetPolicy()}">`;

/** `html` with the tag as the first thing in its head (so it holds for everything after it) */
export function withMainnetPolicy(html) {
  if (!/<head>/.test(html)) throw new Error('index.html has no <head> to put the content policy in');
  return html.replace('<head>', `<head>\n    ${mainnetPolicyTag()}`);
}
