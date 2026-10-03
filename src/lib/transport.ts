// The transport for VYRE's public RPC. Imports only viem and the SDK, so the unit tests can run it in node.
import {
  BaseError,
  LimitExceededRpcError,
  RpcRequestError,
  createTransport,
  http,
  type EIP1193RequestFn,
  type HttpTransport,
  type HttpTransportConfig,
} from 'viem';
import { isAnswerTooLarge, vyreHttp } from '@vyrechain/sdk';

/**
 * The public RPC's refusal of an answer over its size cap ("answer too large: narrow the filter", JSON-RPC -32005), on its way
 * through viem's retry loop. viem retries every -32005, the code this refusal shares with rate limits, but the same call gets the
 * same refusal: so inside the loop it travels as this error, whose code no retry rule of viem's names, and leaves the transport as
 * the error viem makes of a -32005 (LimitExceededRpcError), which `readLogsSplitting` knows to halve.
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
 * `transport` with the RPC's refusals as too large handled at once instead of being asked again for about 16 s. The RPC refuses a
 * whole batch when the batch's answers together are too large, so a refusal inside a batch may belong to another call of it:
 * - a log read's refusal is final at once, so it is halved without another try (a busy pool's page is the usual cause);
 * - any other call refused that way (a block number, a balance, a receipt) is asked once more on its own with `alone`, the same
 *   transport without batching, and only its own refusal there is final. Without `alone` it is asked again as viem asks any -32005.
 */
export function finalTooLarge(transport: HttpTransport, alone?: HttpTransport): HttpTransport {
  return ((params: Parameters<HttpTransport>[0]) => {
    const t = transport(params);
    const raw = t.config.request;
    const single = alone ? alone(params).config.request : null;
    // the same transport, its retries made around a request that marks the final refusal
    const made = createTransport(
      {
        ...t.config,
        request: (async (args: Parameters<EIP1193RequestFn>[0], options?: Parameters<EIP1193RequestFn>[1]) => {
          try {
            return await raw(args, options);
          } catch (e) {
            if (!answerTooLarge(e)) throw e;
            if (args.method === 'eth_getLogs') throw new FinalRefusal(e);
            if (!single) throw e;
          }
          // (refused in a batch: the answer too large may be another call's, so this call is asked on its own; its own refusal is final)
          try {
            return await single(args, options);
          } catch (e) {
            if (answerTooLarge(e)) throw new FinalRefusal(e);
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
 * together sent as one JSON-RPC batch of at most 5 by `fetchFn` (the app's `fetchSplit`), and the RPC's refusals as too large
 * handled at once (`finalTooLarge`). The retries are made here around viem's own request, so the SDK's transport is used for its
 * settings only. `url` is for tests; the app uses the chain's own RPC.
 */
export function vyreTransport(fetchFn: HttpTransportConfig['fetchFn'], url?: string): HttpTransport {
  const config = { batch: { batchSize: 5, wait: 16 }, fetchFn };
  return finalTooLarge(vyreHttp(url, config), http(url, { ...config, batch: false }));
}
