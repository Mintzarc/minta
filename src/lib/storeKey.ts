// Browser storage keys scoped to one chain ID so a move to another network (docs/HANDOFF.md §4) does not read
// the previous network's launches, transfers, wallet choice or splash state as its own.
// Pure: no app imports, so node unit tests can call it.

/** `base` plus the chain id, e.g. `vyre.launch:7357` */
export const storeKey = (base: string, chainId: number): string => `${base}:${chainId}`;
