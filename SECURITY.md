# Security

MINTA is a front end: static files that talk to contracts on the VYRE test network from the visitor's own wallet. It holds
no funds and no keys.

**Report a problem privately** with GitHub's private vulnerability reporting: this repository's *Security* tab, then
*Report a vulnerability*. Please don't open a public issue for something that could hurt people. Tell us what you found, how
to reproduce it, and what it could do; we'll answer there.

What matters most: anything that could make a visitor sign something they didn't mean to (a wrong address, amount or
approval), leak a wallet or an email sign-in session, run a script from another site in the page (the page's content
security policy is in `vercel.json`), or show a token or picture in a way that misleads about what it is.

MINTA has had internal review rounds only. It has had **no outside security audit**; treat the test network as the place to
find problems.
