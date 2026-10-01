# Contributing

Thanks for looking. The app is small and plain on purpose: React, Vite, TypeScript and viem, no state library, no server.

```bash
npm ci              # installs exactly what package-lock.json says (no install scripts run: see .npmrc)
npm run dev         # a local copy at http://localhost:5173
npm run typecheck && npm test
npm run test:browser   # needs Playwright's Chromium: npx playwright install chromium
```

- Keep changes small and say what they do and how you checked it. A change to how a transaction is built or shown
  (amounts, addresses, approvals, what the review dialog says) needs a test.
- The page runs under a strict content security policy (`vercel.json`): no inline scripts, no outside scripts.
- Wording matters. Say "testnet" while it is one; no promises of profit; no claims about audits or independence that aren't true.
- The SDK is vendored (`vendor/`, see the README); the chain's contracts and services belong to VYRE, so changes to those go to
  its team, not here.
