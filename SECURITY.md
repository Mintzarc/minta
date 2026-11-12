# Security

MINTA is a front end: static files that talk to contracts on VYRE from the visitor's own wallet. The site at
minta.vyrechain.com is built for VYRE Mainnet (chain 3045), where the USDC is real; a build for the test network also exists.
MINTA holds no funds and no keys.

**Report a problem privately** with GitHub's private vulnerability reporting: this repository's *Security* tab, then
*Report a vulnerability*. Please don't open a public issue for something that could hurt people. Tell us what you found, how
to reproduce it, and what it could do; we'll answer there.

What matters most: anything that could make a visitor sign something they didn't mean to (a wrong address, amount or
approval), leak a wallet connection (a WalletConnect session, or on the test network an email sign-in session), run a script
from another site in the page (the page's content security policy is in `vercel.json`, and a mainnet build adds a narrower one
from `scripts/csp.mjs`), or show a token or picture in a way that misleads about what it is.

MINTA has had internal review rounds only. It has had **no outside security audit**. Problems on mainnet put real money at
risk: report them the same way, and please try things out on the test network, not with other people's funds.
