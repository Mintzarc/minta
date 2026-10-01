// Stands in for `firebase/auth` inside Circle's web SDK (see firebase-app.ts): used only for Apple sign-in, which
// VYRE doesn't offer. Every call refuses; the SDK catches it and reports a failed social login.
const off = (): never => { throw new Error('Apple sign-in isn’t available on MINTA.'); };

export class OAuthProvider {
  constructor() { off(); }
  static credentialFromResult(): null { return null; }
}
export const getAuth = off;
export const getRedirectResult = off;
export const signInWithPopup = off;
