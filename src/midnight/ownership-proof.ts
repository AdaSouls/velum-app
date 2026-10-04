// "Prove Ownership" (B6) — proveTokenOwnership(requestId, tokenId) in poap.compact.
//
// The circuit proves the caller's holder_pk(issuer) owns tokenId, the token isn't burned, and it
// belongs to the request's event. It needs a published DisclosureRequest for that event but never
// looks at its fieldId/setRoot, and it records no nullifier — so one request can back any number
// of ownership proofs. We only reuse "plain" requests (fieldId and setRoot all-zero), the ones
// that exist to ask for ownership/attendance rather than an attribute, and only open ones (no
// recipient): an addressed request can only be answered by the holder it names.
//
// Which request, in order of preference:
//   1. one the event's organizer published — 1 signature, and it doesn't touch the holder's identity;
//   2. one this wallet already published for the event — 1 signature;
//   3. otherwise publish one now (label random) — 2 signatures. Its `verifier` is this wallet's
//      caller_pk, public on-chain, so that request + the proof's revealed tokenId link the two.
//      The popup says so before the user signs.

import { getAllDisclosureRequests, type IndexedDisclosureRequest } from './indexer.service';
import { txHashOf } from './tx-result';

export { txHashOf };

const ZERO_HEX = '0'.repeat(64);
const ZERO_BYTES = new Uint8Array(32);

export type OwnershipRequestSource = 'organizer' | 'self' | 'new';

export type OwnershipRequestChoice = {
  source: OwnershipRequestSource;
  requestId: string | null; // hex; null when source === 'new'
};

type ProofService = {
  publishDisclosureRequest(
    label: Uint8Array,
    eventId: Uint8Array,
    fieldId: Uint8Array,
    setRoot: Uint8Array,
    recipient: Uint8Array,
  ): Promise<any>;
  proveTokenOwnership(requestId: Uint8Array, tokenId: bigint): Promise<any>;
};

const bytesFromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const hexFromBytes = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// The request's recipient as lowercase hex, or null for an open request. The API stores open
// requests as NULL; an all-zero value is treated the same, just in case.
export function requestRecipient(request: Pick<IndexedDisclosureRequest, 'recipientPk'>): string | null {
  const hex = (request.recipientPk || '').toLowerCase();
  return hex && !/^0+$/.test(hex) ? hex : null;
}

export function isOwnershipRequest(request: IndexedDisclosureRequest): boolean {
  return request.fieldId === ZERO_HEX && request.setRoot === ZERO_HEX;
}

// Pure so it's testable without the indexer.
export function pickOwnershipRequest(
  requests: IndexedDisclosureRequest[],
  { eventIdHex, organizerPkHex, myPkHex }: { eventIdHex: string; organizerPkHex: string; myPkHex?: string | null },
): OwnershipRequestChoice {
  const candidates = requests.filter((r) => r.eventId === eventIdHex && isOwnershipRequest(r) && !requestRecipient(r));
  const byOrganizer = candidates.find((r) => r.verifierPk === organizerPkHex);
  if (byOrganizer) return { source: 'organizer', requestId: byOrganizer.requestId };
  const byMe = myPkHex ? candidates.find((r) => r.verifierPk === myPkHex) : undefined;
  if (byMe) return { source: 'self', requestId: byMe.requestId };
  return { source: 'new', requestId: null };
}

export async function findOwnershipRequest(params: {
  eventIdHex: string;
  organizerPkHex: string;
  myPkHex?: string | null;
}): Promise<OwnershipRequestChoice> {
  return pickOwnershipRequest(await getAllDisclosureRequests(), params);
}

// A plain, open request (fieldId/setRoot/recipient all-zero) for eventIdHex, verifier = the caller. The organizer
// publishes one from their event card ("Ask for Proof of Ownership") so holders prove with one
// signature and without exposing their own caller_pk; proveOwnership falls back to it too.
// The requestId comes back as the circuit's return value (private.result), so no indexer poll.
export async function publishOwnershipRequest(
  service: Pick<ProofService, 'publishDisclosureRequest'>,
  eventIdHex: string,
): Promise<{ requestId: string; txHash: string | null }> {
  const label = new Uint8Array(32);
  crypto.getRandomValues(label);
  const published = await service.publishDisclosureRequest(label, bytesFromHex(eventIdHex), ZERO_BYTES, ZERO_BYTES, ZERO_BYTES);
  const returned = published?.private?.result;
  if (!(returned instanceof Uint8Array) || returned.length !== 32) {
    throw new Error('Published the request, but could not read its ID back from the transaction.');
  }
  return { requestId: hexFromBytes(returned), txHash: txHashOf(published) };
}

export type OwnershipProofResult = {
  txHash: string | null;
  requestId: string; // hex
  requestSource: OwnershipRequestSource;
  publishTxHash: string | null; // only when this flow published the request itself
};

export async function proveOwnership(params: {
  service: ProofService;
  tokenId: number | bigint;
  eventIdHex: string;
  choice: OwnershipRequestChoice;
  onStep?: (step: 'publish' | 'prove') => void;
}): Promise<OwnershipProofResult> {
  const { service, tokenId, eventIdHex, choice, onStep } = params;

  let requestIdHex = choice.requestId;
  let publishTxHash: string | null = null;
  if (!requestIdHex) {
    onStep?.('publish');
    ({ requestId: requestIdHex, txHash: publishTxHash } = await publishOwnershipRequest(service, eventIdHex));
  }

  onStep?.('prove');
  const proved = await service.proveTokenOwnership(bytesFromHex(requestIdHex), BigInt(tokenId));
  return { txHash: txHashOf(proved), requestId: requestIdHex, requestSource: choice.source, publishTxHash };
}
