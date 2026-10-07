// Credential update requests (poap.compact flow 13, AdaSouls/velum 0e37df6): when a document behind
// a credential changes (a new passport, a corrected number…), the holder asks its organizer to issue
// it again. A credential's attributes are fixed in its on-chain leaf, so "updating" means burn + a
// fresh mintTo to the same holder pseudonym (reviewCredentialUpdate.jsx).
//
// Holder side (requestCredentialUpdate.jsx):
//   payload { current package, changes, holder's encryption key } → sealForRecipient(the event's
//   updateRequestKey, i.e. the organizer's inbox key, credential-crypto.ts) → POST
//   /api/credential-update keyed by payloadCommit = sha256(envelope) → requestCredentialUpdate(
//   tokenId, payloadCommit). Filing again replaces the commitment on-chain.
// Organizer side: the indexer lists pending requests with their payloadCommit; fetchUpdateRequest
//   downloads the envelopes posted under it, keeps the one whose hash IS the commitment and that
//   opens with the inbox key.
//
// Public: that this token's holder asked for an update, and when. The content (which document, the
// new number) is only ever inside the envelope.
import { openEnvelope, sealForRecipient, sha256, type EncryptionKeyPair, type SealedEnvelope } from './credential-crypto';
import { decodeValueHex, type CredentialPackage } from './credential-store';
import { checkDocNumber } from './identity';
import { txHashOf } from './tx-result';

const IPFS_API_URL = process.env.REACT_APP_IPFS_API_URL || 'http://localhost:4000';
export const UPDATE_REQUEST_KIND = 'velum-credential-update';
export const MAX_REASON_LENGTH = 280;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));
const HEX_64 = /^[0-9a-f]{64}$/;

export type UpdateChange = { fieldId: string; number: string };

export type UpdateRequestPayload = {
  kind: typeof UPDATE_REQUEST_KIND;
  version: 1;
  tokenId: number;
  eventId: string;
  issuerPk: string;
  holderPk: string;
  // What the holder holds today, so the organizer can check it against the chain and re-issue the
  // unchanged fields as they are.
  currentPackage: CredentialPackage;
  changes: UpdateChange[];
  reason?: string;
  // Where the re-issued credential's private details go (same key as the holder's "Get My Key" code).
  holderEncryptionKey: string;
  createdAt: string;
};

export type UpdateToken = { tokenId: number; eventId: string; issuerPk: string; holderPk: string };

type Service = {
  getEncryptionKeyPair(issuerId: Uint8Array): Promise<{ publicKeyHex: string }>;
  requestCredentialUpdate(tokenId: bigint, payloadCommit: Uint8Array): Promise<unknown>;
};

// The envelope's bytes for hashing: fixed key order, so the hash survives a JSON round trip through
// the server.
function canonicalEnvelope(envelope: SealedEnvelope): Uint8Array {
  const { format, version, epk, iv, ciphertext } = envelope;
  return new TextEncoder().encode(JSON.stringify({ format, version, epk, iv, ciphertext }));
}

export async function envelopeCommit(envelope: SealedEnvelope): Promise<string> {
  return hex(await sha256(canonicalEnvelope(envelope)));
}

// Why these changes can't be sent, or null.
export function changeError(pkg: CredentialPackage | null, change: UpdateChange): string | null {
  const field = pkg?.fields.find((f) => f.fieldId === change.fieldId);
  if (!field?.identity) return 'Pick one of your documents.';
  const checked = checkDocNumber(change.number);
  if ('error' in checked) return checked.error;
  if (!checked.value) return 'Enter the new number.';
  if (checked.value === field.identity.number) return "That's the number your credential already has.";
  return null;
}

export function buildUpdateRequest(
  token: UpdateToken,
  pkg: CredentialPackage,
  changes: UpdateChange[],
  holderEncryptionKey: string,
  reason = '',
  now: Date = new Date(),
): UpdateRequestPayload {
  const trimmedReason = reason.trim().slice(0, MAX_REASON_LENGTH);
  return {
    kind: UPDATE_REQUEST_KIND,
    version: 1,
    tokenId: Number(token.tokenId),
    eventId: token.eventId,
    issuerPk: token.issuerPk,
    holderPk: token.holderPk,
    currentPackage: pkg,
    changes: changes.map((change) => {
      const checked = checkDocNumber(change.number);
      return { fieldId: change.fieldId, number: 'value' in checked ? checked.value : change.number };
    }),
    ...(trimmedReason ? { reason: trimmedReason } : {}),
    holderEncryptionKey,
    createdAt: now.toISOString(),
  };
}

// Seals the request for the organizer, posts it, then files its commitment on-chain (one signature).
// The upload goes first: a commitment with nothing behind it would leave the organizer a request
// they can't read.
export async function submitUpdateRequest(
  service: Service,
  {
    token,
    pkg,
    changes,
    reason,
    updateRequestKey,
  }: { token: UpdateToken; pkg: CredentialPackage; changes: UpdateChange[]; reason?: string; updateRequestKey: string },
): Promise<{ txHash: string | null; payloadCommit: string }> {
  const problem = changes.map((change) => changeError(pkg, change)).find(Boolean);
  if (problem) throw new Error(problem);
  if (!HEX_64.test((updateRequestKey || '').toLowerCase())) {
    throw new Error("This credential's organizer can't receive update requests.");
  }
  const { publicKeyHex } = await service.getEncryptionKeyPair(fromHex(token.issuerPk));
  const payload = buildUpdateRequest(token, pkg, changes, publicKeyHex, reason);
  const envelope = await sealForRecipient(updateRequestKey.toLowerCase(), new TextEncoder().encode(JSON.stringify(payload)));
  const payloadCommit = await envelopeCommit(envelope);

  const response = await fetch(`${IPFS_API_URL}/api/credential-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payloadCommit, envelope }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Could not send the update request (${response.status})`);
  }

  const result = await service.requestCredentialUpdate(BigInt(token.tokenId), fromHex(payloadCommit));
  return { txHash: txHashOf(result), payloadCommit };
}

// The values the re-issued credential carries (fieldId → text, as mintPoap.jsx would take them):
// everything it has today, with the requested numbers swapped in. Identity fields get a fresh salt
// when they're built again (credential-delivery.ts), so the holder ends up with a new identity code.
export function reissueValues(payload: UpdateRequestPayload): Record<string, string> {
  const values: Record<string, string> = {};
  payload.currentPackage.fields.forEach((field) => {
    values[field.fieldId] = field.identity ? field.identity.number : decodeValueHex(field.valueHex);
  });
  payload.changes.forEach((change) => {
    if (change.fieldId in values) values[change.fieldId] = change.number;
  });
  return values;
}

function isPayload(value: any): value is UpdateRequestPayload {
  return (
    value?.kind === UPDATE_REQUEST_KIND &&
    value.version === 1 &&
    Number.isInteger(value.tokenId) &&
    Array.isArray(value.changes) &&
    Array.isArray(value.currentPackage?.fields) &&
    typeof value.holderEncryptionKey === 'string'
  );
}

// The request behind an on-chain payloadCommit, opened with the organizer's inbox key, or null.
// Anyone can post under a commitment, so only an envelope whose own hash is that commitment counts.
export async function fetchUpdateRequest(
  payloadCommitHex: string,
  inboxKeys: EncryptionKeyPair,
): Promise<UpdateRequestPayload | null> {
  const commit = payloadCommitHex.toLowerCase();
  const response = await fetch(`${IPFS_API_URL}/api/credential-update/${commit}`);
  if (!response.ok) throw new Error(`Could not reach the update request service (${response.status})`);
  const { envelopes } = (await response.json()) as { envelopes: SealedEnvelope[] };
  for (const envelope of envelopes || []) {
    try {
      if ((await envelopeCommit(envelope)) !== commit) continue;
      const payload = JSON.parse(new TextDecoder().decode(await openEnvelope(envelope, inboxKeys)));
      if (isPayload(payload)) return payload;
    } catch {
      // Not ours, or tampered — try the next one.
    }
  }
  return null;
}

// Same-page notice that this browser just filed an update request (requestCredentialUpdate.jsx), so
// the credential's card shows it right away instead of waiting for the indexer.
export const CREDENTIAL_UPDATE_EVENT = 'velum:credential-update-requested';

export function notifyCredentialUpdateRequested(tokenId: number | string): void {
  window.dispatchEvent(new CustomEvent(CREDENTIAL_UPDATE_EVENT, { detail: { tokenId: String(tokenId) } }));
}
