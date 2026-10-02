// The transport for VYRE's public RPC. Imports only viem and the SDK, so the unit tests can run it in node.
import {
  BaseError,
  LimitExceededRpcError,
  RpcRequestError,
  createTransport,
  type EIP1193RequestFn,
  type HttpTransport,
  type HttpTransportConfig,
} from 'viem';
import { isAnswerTooLarge, vyreHttp } from '@vyrechain/sdk';

/**
 * The public RPC's refusal of a log read's answer over its size cap ("answer too large: narrow the filter", JSON-RPC -32005),
 * on its way through viem's retry loop. viem retries every -32005, the code this refusal shares with rate limits, but the same
 * log read gets the same refusal: so inside the loop it travels as this error, whose code no retry rule of viem's names, and
 * leaves the transport as the error viem makes of a -32005 (LimitExceededRpcError), which `readLogsSplitting` knows to halve.
 */
class FinalRefusal extends BaseError {
  readonly code = 0;
  readonly refusal: RpcRequestError;
  constructor(refusal: RpcRequestError) {
    super('answer too large', { cause: refusal, name: 'FinalRefusal' });
    this.refusal = refusal;
  }
}
const answerTooLarge = (e: unknown): e is RpcRequestError =>
  e instanceof RpcRequestError && e.code === LimitExceededRpcError.code && isAnswerTooLarge(e);

/**
 * `transport` with a log read's refusal as too large made final: it comes back at once instead of being asked again for about
 * 16 s. Only a log read's: the RPC refuses a whole batch when the batch's answers together are too large, so every other call
 * that shared the batch (a block number, a balance, a receipt) gets the same refusal for an answer of its own that is small. It
 * is asked again as viem asks any -32005 again, after the log read has been halved, so no longer in the same batch.
 */
export function finalTooLarge(transport: HttpTransport): HttpTransport {
  return ((params: Parameters<HttpTransport>[0]) => {
    const t = transport(params);
    const raw = t.config.request;
    // the same transport, its retries made around a request that marks the final refusal
    const made = createTransport(
      {
        ...t.config,
        request: (async (args: Parameters<EIP1193RequestFn>[0], options?: Parameters<EIP1193RequestFn>[1]) => {
          try {
            return await raw(args, options);
          } catch (e) {
            if (answerTooLarge(e) && args.method === 'eth_getLogs') throw new FinalRefusal(e);
            throw e;
          }
        }) as EIP1193RequestFn,
      },
      t.value
    );
    const request = (async (args: Parameters<EIP1193RequestFn>[0], options?: Parameters<EIP1193RequestFn>[1]) => {
      try {
        return await made.request(args, options);
      } catch (e) {
        if (e instanceof FinalRefusal) throw new LimitExceededRpcError(e.refusal);
        throw e;
      }
    }) as EIP1193RequestFn;
    return { config: t.config, request, value: t.value };
  }) as HttpTransport;
}

/**
 * The transport the app reads VYRE with: the SDK's (which retries the RPC's busy refusals for about 16 s), requests made
 * together sent as one JSON-RPC batch of at most 5 by `fetchFn` (the app's `fetchSplit`), and a log read's refusal as too large
 * final, so it asks for less at once. `url` is for tests; the app uses the chain's own RPC.
 */
export function vyreTransport(fetchFn: HttpTransportConfig['fetchFn'], url?: string): HttpTransport {
  return finalTooLarge(vyreHttp(url, { batch: { batchSize: 5, wait: 16 }, fetchFn }));
}
