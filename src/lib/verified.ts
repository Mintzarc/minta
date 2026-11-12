// Which of the mainnet contracts in the docs table have their source published on the explorer (explorer.vyrechain.com answers
// `is_verified` for each address). The docs sentence above the table is made from this list, and the tests hold the terms page
// to it: a contract marked false is named as not published, and nothing then says "read its source" about all of them.
// One line per row of the table; set a row to false if its source is taken down, and back to true once it is published again.
// Imports nothing, so the tests load it as it is.
export const SOURCE_ON_EXPLORER: Readonly<Record<string, boolean>> = {
  VyrePadV2: true,
  VyrePoolFactory: true,
  SwapRouter: true,
  QuoterV2: true,
  TickLens: true,
  WUSDC: true,
};

/** The rows whose source is not on the explorer */
export const unpublished = (list: Readonly<Record<string, boolean>> = SOURCE_ON_EXPLORER): string[] =>
  Object.entries(list).filter(([, there]) => !there).map(([name]) => name);

const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The sentence above the contract table */
export function sourceSentence(list: Readonly<Record<string, boolean>> = SOURCE_ON_EXPLORER): string {
  const missing = unpublished(list);
  if (!missing.length) return 'Click an address to read its source on the explorer.';
  return `Click an address to open it on the explorer. The source of ${listed(missing)} is not published there yet.`;
}
