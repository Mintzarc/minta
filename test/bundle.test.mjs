// The built app (dist/) holds exactly one copy of viem: two copies (one for the app, one inside the SDK) make viem's
// error checks fail across them, so a transaction still pending reads as a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../dist/assets');
// a message that viem defines once, in its TransactionReceiptNotFoundError
const MARK = 'could not be found. The Transaction may not be processed on a block yet';

test('one copy of viem in the built app', { skip: !fs.existsSync(dir) && 'no build yet' }, () => {
  const copies = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split(MARK).length - 1, 0);
  assert.equal(copies, 1, `viem is in the bundle ${copies} times: check resolve.dedupe in vite.config.ts`);
});
