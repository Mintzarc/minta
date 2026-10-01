// Stands in for `firebase/app` inside Circle's web SDK (vite.config.ts points the import here). The SDK uses Firebase
// only for Apple sign-in, which VYRE doesn't offer; this keeps Firebase's code, and the Google scripts it can load, out
// of the app. `getApps()` is the one call the SDK always makes: no Firebase app exists, which is true.
const off = (): never => { throw new Error('Apple sign-in isn’t available on MINTA.'); };

export const getApps = (): unknown[] => [];
export const initializeApp = off;
export class FirebaseError extends Error {
  code = '';
}
