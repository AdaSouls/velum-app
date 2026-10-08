// B8 — lets anyone check a proof receipt without a wallet: looks the transaction up on the Midnight
// indexer (GraphQL) and reports whether it's a confirmed call to OUR contract and which circuit it
// ran. Proofs never write the ledger (except publishing a request), so our own POAP indexer never
// sees them — the chain's indexer is the only source. A successful transaction IS the proof: every
// failure path in these circuits is an assert, so a failed proof never lands on-chain.
//
// Which request, event and token a proof was about is read from the transaction's own public
// transcript (proof-transcript.ts), not from the receipt.

const GRAPHQL_URL = process.env.REACT_APP_MIDNIGHT_INDEXER_GRAPHQL_URL || 'http://localhost:8088/api/v4/graphql';

export const PROOF_KINDS: Record<string, { title: string; description: string; isProof: boolean }> = {
  proveTokenOwnership: {
    title: 'Ownership proof',
    description: 'The holder of a specific POAP proved they own it. The token is revealed; the wallet is not.',
    isProof: true,
  },
  proveEventAttendance: {
    title: 'Anonymous ownership proof',
    description: 'Someone proved they hold a valid POAP of the event, without revealing which one or their wallet.',
    isProof: true,
  },
  // The single-condition circuit of earlier deployments, for older receipts.
  proveCredentialAttribute: {
    title: 'Private detail proof',
    description:
      "Someone proved a private detail of their credential is one of the accepted values, without revealing the value, the credential or their wallet.",
    isProof: true,
  },
  proveCredentialAttributes: {
    title: 'Private detail proof',
    description:
      "The holder a question was addressed to proved their credential's private details match it, without revealing them.",
    isProof: true,
  },
  proveAttributeMembership: {
    title: 'Proof about an event attribute',
    description: "A private attribute of the event was proven to be one of the accepted values, without revealing it.",
    isProof: true,
  },
  proveAttributeMembershipOnce: {
    title: 'Single-use proof about an event attribute',
    description: "Same as a proof about an event attribute, recorded so the same wallet can't answer twice.",
    isProof: true,
  },
};

export type ProofLookup =
  | { status: 'not-found' }
  | {
      status: 'found';
      hash: string;
      blockHeight: number | null;
      blockHash: string | null;
      timestamp: number | null; // ms
      entryPoint: string | null;
      isOurContract: boolean;
      succeeded: boolean | null; // null when the indexer doesn't say
      raw: string | null; // hex, the serialized transaction (for proof-transcript.ts)
    };

export async function lookupProofTransaction(txHash: string, contractAddress: string): Promise<ProofLookup> {
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('That is not a transaction hash (64 hex characters).');
  const query = `query ($hash: HexEncoded!) {
    transactions(offset: { hash: $hash }) {
      hash
      raw
      block { height hash timestamp }
      contractActions { address __typename ... on ContractCall { entryPoint } }
      ... on RegularTransaction { transactionResult { status } }
    }
  }`;
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { hash: txHash.toLowerCase() } }),
  });
  if (!response.ok) throw new Error(`The Midnight indexer did not answer (${response.status}).`);
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors[0].message || 'The Midnight indexer returned an error.');
  const tx = data?.transactions?.[0];
  if (!tx) return { status: 'not-found' };
  const call = (tx.contractActions || []).find((action: any) => action.__typename === 'ContractCall');
  return {
    status: 'found',
    hash: tx.hash,
    blockHeight: tx.block?.height ?? null,
    blockHash: tx.block?.hash ?? null,
    timestamp: tx.block?.timestamp ?? null,
    entryPoint: call?.entryPoint ?? null,
    isOurContract: Boolean(call && call.address?.toLowerCase() === contractAddress?.toLowerCase()),
    succeeded: tx.transactionResult?.status ? tx.transactionResult.status === 'SUCCESS' : null,
    raw: tx.raw ?? null,
  };
}

// When a block was produced (ms), e.g. a token's mintedBlock — validity.ts counts an Event's or a
// Credential's validity from it. Cached: a block's time never changes.
const blockTimes = new Map<number, Promise<number | null>>();
export function blockTimestamp(height: number): Promise<number | null> {
  let time = blockTimes.get(height);
  if (!time) {
    time = fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query ($h: Int!) { block(offset: { height: $h }) { timestamp } }', variables: { h: height } }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body?.data?.block?.timestamp ?? null)
      .catch(() => null);
    time.then((value) => {
      if (value === null) blockTimes.delete(height);
    });
    blockTimes.set(height, time);
  }
  return time;
}

// One proof, or several checked together (an identity check and the question asked with it):
// /app/verify?tx=a,b.
export function verifyUrl(txHash: string | string[]): string {
  const hashes = Array.isArray(txHash) ? txHash.filter(Boolean).join(',') : txHash;
  return `${window.location.origin}/app/verify?tx=${hashes}`;
}

const MAX_PROOFS_PER_CHECK = 5;

// The transaction hashes in a verify link or the search box: comma- or space-separated, deduplicated.
// A whole pasted verify link (…/app/verify?tx=a,b) counts as its hashes.
export function parseProofHashes(input: string): string[] {
  const hashes = (input || '')
    .replace(/%2C/gi, ',')
    .replace(/[^\s,]*[?&]tx=/g, ',') // a link's address part, up to its hashes
    .replace(/&[^\s,]*/g, '') // and any parameter after them
    .split(/[\s,]+/)
    .map((hash) => hash.trim())
    .filter(Boolean);
  return Array.from(new Set(hashes)).slice(0, MAX_PROOFS_PER_CHECK);
}
