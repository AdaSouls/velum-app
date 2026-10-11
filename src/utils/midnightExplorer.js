// Deep links into midnightexplorer.com for the raw on-chain values shown in the
// "Info" popup (see BlockchainInfoModal.jsx). Route shapes taken from the explorer's
// own client bundle: /blocks/<height>, /transactions/<hash>, /contracts/<address>. Returns
// undefined for a missing/placeholder value so BlockchainField just renders plain text instead.
// One explorer per network, on its own host: a mainnet transaction is a 404 on the preprod host
// and the other way round (checked 2026-10-11). A local devnet has no explorer, so no links there.
const MIDNIGHT_EXPLORER_BASE_URLS = {
  mainnet: "https://www.midnightexplorer.com",
  preprod: "https://preprod.midnightexplorer.com",
};

// Read per call, not once at import: the build inlines it either way, and tests can set it.
const explorerBaseUrl = () => MIDNIGHT_EXPLORER_BASE_URLS[process.env.REACT_APP_MIDNIGHT_NETWORK_ID];

const isLinkable = (value) => value !== undefined && value !== null && value !== "" && value !== "N/A";

export const explorerBlockUrl = (height) =>
  isLinkable(height) && explorerBaseUrl() ? `${explorerBaseUrl()}/blocks/${height}` : undefined;

export const explorerTxUrl = (hash) =>
  isLinkable(hash) && explorerBaseUrl() ? `${explorerBaseUrl()}/transactions/${hash}` : undefined;

export const explorerContractUrl = (address) =>
  isLinkable(address) && explorerBaseUrl() ? `${explorerBaseUrl()}/contracts/${address}` : undefined;

// The explorer link for the transaction a result message mentions ("Transaction: <hash>"), so
// every flow's success popup can link to it without each caller building the URL.
export const explorerTxUrlInText = (text) => {
  const hash = typeof text === "string" ? text.match(/\b[0-9a-fA-F]{64}\b/)?.[0] : undefined;
  return explorerTxUrl(hash);
};
