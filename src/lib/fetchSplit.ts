// The public RPC refuses request bodies over 512 KB. A Multicall3 chunk of many tiny reads (4 KB of calls, each call
// about 96 times bigger once encoded) can reach about 390 KB, so five of them in one batch could pass the limit: a batch
// over it goes out as consecutive smaller batches instead (each still answered in the order viem expects).
const MAX_BODY = 480 * 1024;
export async function fetchSplit(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const text = typeof init?.body === 'string' ? init.body : null;
  if (!text || text.length <= MAX_BODY || text[0] !== '[') return fetch(input, init);
  const calls = JSON.parse(text) as unknown[];
  const parts: unknown[][] = [];
  let part: unknown[] = [], size = 2;
  for (const c of calls) {
    const n = JSON.stringify(c).length + 1;
    if (part.length && size + n > MAX_BODY) { parts.push(part); part = []; size = 2; }
    part.push(c); size += n;
  }
  parts.push(part);
  const answers: unknown[] = [];
  for (const p of parts) {
    let res: Response | null = null;
    // the RPC takes one request at a time per visitor: a part it's too busy for waits and goes again
    for (let i = 0; i < 6; i++) {
      res = await fetch(input, { ...init, body: JSON.stringify(p) }).catch(() => null);
      if (res && res.status !== 429 && res.status !== 503) break;
      if (i < 5) await new Promise((ok) => setTimeout(ok, 500 * (i + 1)));
    }
    const j = res && res.ok ? await res.json().catch(() => null) : null;
    if (Array.isArray(j)) { answers.push(...j); continue; }
    // this part failed: its calls get an error each, and the parts already answered keep their answers (the whole
    // batch is never sent again, so nothing already done is repeated)
    for (const c of p as { id?: unknown }[]) answers.push({ jsonrpc: '2.0', id: c?.id ?? null, error: { code: -32603, message: 'The network was busy: try again in a moment.' } });
  }
  return new Response(JSON.stringify(answers), { status: 200, headers: { 'content-type': 'application/json' } });
}
