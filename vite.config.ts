import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { apiOrigin, checkHeaderNames, withMainnetPolicy } from './scripts/csp.mjs';

const shim = (name: string) => fileURLToPath(new URL(`./src/lib/shims/${name}.ts`, import.meta.url));

// MINTA is a static site served from the root of its own address; routes live after a # (/#/token/0x...), so the host needs
// no rewrite rules. Link previews (og:image) need an absolute address: set VITE_SITE_URL (https://your-domain, no slash at the
// end) when building; on Vercel its production domain is used when that isn't set, and without either the preview image is
// a relative address (which most crawlers ignore).
const siteUrl = (process.env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '');
// A mainnet build (VITE_NETWORK=mainnet, or a production build that names none: see src/lib/network.ts) carries its own, narrower
// content policy in its index.html (scripts/csp.mjs says why and which hosts)
// The network is read from the very value the app gets as import.meta.env.VITE_NETWORK (the process environment or an .env file),
// so the policy and the app can never be for different networks.
let builtFor: unknown;
// the app API's origin for that build (VITE_API_URL, the same value the app reads): the policy names it; not an https address stops the build
let apiFor: string | undefined;
const forMainnet = () => builtFor === 'mainnet' || builtFor === undefined || builtFor === '';
const mainnetPolicyInHtml: Plugin = {
  name: 'mainnet-policy-in-html', apply: 'build',
  configResolved(config) {
    builtFor = config.env.VITE_NETWORK;
    if (!forMainnet()) return;
    apiFor = apiOrigin(config.env.VITE_API_URL);
    // (the header vercel.json sends on the mainnet site's host must name the same API, or the build would be cut off from it there)
    checkHeaderNames(apiFor, readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  },
  transformIndexHtml: { order: 'pre', handler: (html) => (forMainnet() ? withMainnetPolicy(html, apiFor) : html) },
};
const siteUrlInHtml: Plugin = { name: 'site-url-in-html', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl) };

// Circle's web SDK (email sign-in, @circle-fin/w3s-pw-web-sdk) is loaded only when someone signs in with email. Three
// of its imports are swapped for small stand-ins (src/lib/shims/): jsonwebtoken (Node-only; the SDK uses one function
// of it), and firebase/app and firebase/auth (used only for Apple sign-in, which the app doesn't offer).
export default defineConfig({
  base: '/',
  plugins: [react(), siteUrlInHtml, mainnetPolicyInHtml],
  resolve: {
    // one copy of viem for the app and the SDK, or viem's errors from the app's clients aren't recognised by the SDK's
    // copy (a pending transaction then reads as a failure at the first poll)
    dedupe: ['viem', 'abitype', 'ox'],
    alias: [
      { find: /^jsonwebtoken$/, replacement: shim('jsonwebtoken') },
      { find: /^firebase\/app$/, replacement: shim('firebase-app') },
      { find: /^firebase\/auth$/, replacement: shim('firebase-auth') },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
});
