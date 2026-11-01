// Where reports about a token go. Telegram and X are MINTA's own accounts (the contact on the Terms page). The email address is
// a single constant: OWNER TO CONFIRM. While it is empty the Report panel shows no email link; set it to the address MINTA's
// team reads (and says so in docs/ANDROID.md), and the link appears with a prefilled subject and message.
// Pure: no app imports, so node unit tests can call it.

export const REPORT_TELEGRAM = 'https://t.me/+HDa2YpR0piA3ZWE0';
export const REPORT_X = 'https://x.com/MintaLaunchpad';
export const REPORT_EMAIL = ''; // OWNER TO CONFIRM

/** The message a report starts with, for the ticker and address of the token */
export const reportText = (sym: string, token: string) => `Report token $${sym} ${token} on MINTA: `;

/** A mailto link with the subject and the start of the message filled in, or null while there is no address */
export function reportMailto(email: string, sym: string, token: string): string | null {
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) return null;
  const subject = `Report: $${sym} on MINTA`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${reportText(sym, token)}\n\nWhat is wrong with it: `)}`;
}
