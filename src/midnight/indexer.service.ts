// Client for the poap-midnight app-layer REST API (poap-midnight/indexer), which subscribes to
// the Midnight Indexer GraphQL/WS API and mirrors on-chain POAP state into its own Postgres DB.
// See poap-midnight/indexer/src/api/routes/{events,tokens}.ts for the exact response shapes.
//
// NOTE: events carry a metadataURI (pointer to off-chain JSON — name/description/image/…, e.g.
// "ipfs://<CID>" — for context/display); each token now also carries its OWN tokenMetadataURI,
// inherited from the event at claim() time or personalized per-recipient via mintTo() — prefer
// tokenMetadataURI over the parent event's metadataURI when rendering a specific token. There is
// still no POST /api/events (see the migration plan's "Known limitations"). Attendance/history is
// no longer a concept at all — every claim mints a brand-new token scoped to exactly one event
// (GET /api/tokens/:id/attendance returns 410 Gone by design; see firstEventId on the token
// itself instead).

const BASE_URL = process.env.REACT_APP_MIDNIGHT_INDEXER_API_URL || "http://localhost:3001";

export type IndexedEvent = {
  eventId: string; // hex
  issuerPk: string; // hex
  maxSupply: number;
  expiration: number;
  isActive: boolean;
  isPublicMint: boolean;
  metadataURI: string;
  minted: number;
  // Merkle root only — hex, all-zero (64 "0" chars) means no private attributes committed. Never
  // the attribute values themselves. See src/midnight/merkle.ts + contract.service.ts's
  // publishDisclosureRequest/proveAttributeMembership for what this enables.
  privateAttributesRoot: string;
  createdBlock: number | null;
  createdTx: string | null;
  deactivatedBlock: number | null;
};

export type IndexedEventWithLiveTokens = IndexedEvent & { liveTokens: number };

export type IndexedToken = {
  tokenId: number;
  ownerPk: string; // hex
  issuerPk: string; // hex
  firstEventId: string; // hex
  isBurned: boolean;
  mintedBlock: number | null;
  mintedTx: string | null;
  burnedBlock: number | null;
  burnedTx: string | null;
  // This token's own metadata — inherited from the event at claim() time, or personalized via
  // mintTo(). Prefer this over metadataURI below for rendering the actual badge.
  tokenMetadataURI: string | null;
  tokenPrivateMetadataCommit: string | null; // hex, all-zero (64 "0" chars) means "no private part"
  // The parent event's own metadata, for context (e.g. "part of event X").
  metadataURI: string | null;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new IndexerNotFoundError(path);
    }
    throw new Error(`Indexer request failed: GET ${path} → ${response.status}`);
  }
  return response.json();
}

export class IndexerNotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = "IndexerNotFoundError";
  }
}

export async function getAllEvents(): Promise<IndexedEvent[]> {
  return getJson<IndexedEvent[]>("/api/events");
}

export async function getEvent(eventIdHex: string): Promise<IndexedEventWithLiveTokens> {
  return getJson<IndexedEventWithLiveTokens>(`/api/events/${eventIdHex}`);
}

export async function getTokensByOwner(ownerPkHex: string): Promise<IndexedToken[]> {
  return getJson<IndexedToken[]>(`/api/tokens/owner/${ownerPkHex}`);
}

// Tokens whose *first* claim was this event (matches the event's `minted` count — repeat
// claims from returning wallets update private ZK state only and aren't indexed here).
export async function getTokensByEvent(
  eventIdHex: string,
  options?: { includeBurned?: boolean }
): Promise<IndexedToken[]> {
  const query = options?.includeBurned === false ? "?includeBurned=false" : "";
  return getJson<IndexedToken[]>(`/api/events/${eventIdHex}/tokens${query}`);
}

export async function getToken(tokenId: number | bigint): Promise<IndexedToken> {
  return getJson<IndexedToken>(`/api/tokens/${tokenId}`);
}

// Selective disclosure — see poap-midnight/indexer/src/api/routes/disclosures.ts. What a holder's
// wallet reads to know what it's being asked to prove (eventId/fieldId/setRoot) before building a
// real Merkle path with merkle.ts's buildMerklePath. Public by design: this is the pinned
// question, never the hidden answer.
export type IndexedDisclosureRequest = {
  requestId: string; // hex
  verifierPk: string; // hex
  eventId: string; // hex
  fieldId: string; // hex
  setRoot: string; // hex
  // The holder pseudonym the request is addressed to; null = open (any holder of the event).
  // Credential-attribute requests are always addressed (proveCredentialAttribute requires it).
  recipientPk: string | null;
  publishedBlock: number | null;
  publishedTx: string | null;
};

export async function getDisclosureRequest(requestIdHex: string): Promise<IndexedDisclosureRequest> {
  return getJson<IndexedDisclosureRequest>(`/api/disclosure-requests/${requestIdHex}`);
}

export async function getDisclosureRequestsByVerifier(verifierPkHex: string): Promise<IndexedDisclosureRequest[]> {
  return getJson<IndexedDisclosureRequest[]>(`/api/disclosure-requests?verifierPk=${verifierPkHex}`);
}

// For an organizer's "pending requests on my events" view — omitting verifierPk entirely returns
// every published request (confirmed against poap-midnight/indexer/src/api/routes/disclosures.ts's
// `WHERE $1::text IS NULL OR verifier_pk = $1`), filtered client-side by eventId since there's no
// eventId query param on the backend.
export async function getAllDisclosureRequests(): Promise<IndexedDisclosureRequest[]> {
  return getJson<IndexedDisclosureRequest[]>('/api/disclosure-requests');
}
