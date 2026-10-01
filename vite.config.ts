import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const shim = (name: string) => fileURLToPath(new URL(`./src/lib/shims/${name}.ts`, import.meta.url));

// MINTA is a static site served from the root of its own address; routes live after a # (/#/token/0x...), so the host needs
// no rewrite rules. Link previews (og:image) need an absolute address: set VITE_SITE_URL (https://your-domain, no slash at the
// end) when building; on Vercel its production domain is used when that isn't set, and without either the preview image is
// a relative address (which most crawlers ignore).
const siteUrl = (process.env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, '');
const siteUrlInHtml: Plugin = { name: 'site-url-in-html', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl) };

// Circle's web SDK (email sign-in, @circle-fin/w3s-pw-web-sdk) is loaded only when someone signs in with email. Three
// of its imports are swapped for small stand-ins (src/lib/shims/): jsonwebtoken (Node-only; the SDK uses one function
// of it), and firebase/app and firebase/auth (used only for Apple sign-in, which the app doesn't offer).
export default defineConfig({
  base: '/',
  plugins: [react(), siteUrlInHtml],
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
