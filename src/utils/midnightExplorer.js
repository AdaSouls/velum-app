// Deep links into https://www.midnightexplorer.com/ for the raw on-chain values shown in the
// "Info" popup (see BlockchainInfoModal.jsx). Route shapes taken from the explorer's
// own client bundle: /blocks/<height>, /transactions/<hash>, /contracts/<address>. Returns
// undefined for a missing/placeholder value so BlockchainField just renders plain text instead.
const MIDNIGHT_EXPLORER_BASE_URL = "https://www.midnightexplorer.com";

const isLinkable = (value) => value !== undefined && value !== null && value !== "" && value !== "N/A";

export const explorerBlockUrl = (height) =>
  isLinkable(height) ? `${MIDNIGHT_EXPLORER_BASE_URL}/blocks/${height}` : undefined;

export const explorerTxUrl = (hash) =>
  isLinkable(hash) ? `${MIDNIGHT_EXPLORER_BASE_URL}/transactions/${hash}` : undefined;

export const explorerContractUrl = (address) =>
  isLinkable(address) ? `${MIDNIGHT_EXPLORER_BASE_URL}/contracts/${address}` : undefined;
