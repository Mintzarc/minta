// Stands in for the `jsonwebtoken` package inside Circle's web SDK (vite.config.ts points the import here). The SDK
// uses only its `decode`, to read a Google sign-in's nonce, which VYRE doesn't use; the real package needs Node's
// crypto and streams, which browsers don't have. Like jsonwebtoken's decode, this reads a JWT's payload without
// checking its signature.
export function decode(token: string): Record<string, unknown> | null {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export default { decode };
