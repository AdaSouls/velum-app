// Per-credential private attributes (B7) and how they reach the holder.
//
// Organizer side (mintPoap.jsx):
//   buildCredentialAttributes(values) → fields with fresh rand + the tree root → mintTo(…, root)
//   → sealForRecipient(holder's encryption key, package) → POST /api/credential-delivery.
//   If the holder's code has no encryption key (old code), a private link carries the package in
//   the URL fragment instead (#…, never sent to any server) — see packageToLinkFragment.
//
// Holder side (poapCard.jsx):
//   getCredentialPackage (local) → else fetch every envelope for (holderPk, eventId), open the one
//   that decrypts and whose recomputed root matches → save locally.
//
// Tree layout matches poap.compact: leaf_i = computeCredentialAttrLeaf(fieldId, value, rand),
// depth 8 (MerkleTreePath<8>), padded like createEvent's event-level attribute tree (merkle.ts).
import { computeCredentialAttrLeaf, computeCredentialLeaf, computeIdentityValue } from './contract.service';
import { buildMerkleTree, merklePathRootField, type MerkleTreePathArg } from './merkle';
import { encodeAttributeValue } from './attribute-value-codec';
import {
  fromBase64Url,
  openEnvelope,
  sealForRecipient,
  sha256,
  toBase64Url,
  type EncryptionKeyPair,
  type SealedEnvelope,
} from './credential-crypto';
import { saveCredentialPackage, type CredentialField, type CredentialPackage } from './credential-store';
import { identityInputs, newIdentitySalt, normalizeDocNumber } from './identity';

const IPFS_API_URL = process.env.REACT_APP_IPFS_API_URL || 'http://localhost:4000';
const LOOKUP_DOMAIN = new TextEncoder().encode('velum:credential-delivery:v1:');

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));

export type CredentialFieldTemplate = {
  fieldId: string;
  label: string;
  type?: string;
  country?: string; // identity fields
  docType?: string;
};

// An identity field's value: the salted document hash, with the opening the holder keeps.
export function identityField(template: CredentialFieldTemplate, number: string, saltHex = newIdentitySalt()) {
  const doc = { country: template.country || '', docType: template.docType || '' };
  const inputs = identityInputs(doc, number, saltHex);
  return {
    valueHex: hex(computeIdentityValue(...inputs)),
    identity: { ...doc, number: normalizeDocNumber(number), saltHex },
  };
}

// ── Building ──────────────────────────────────────────────────────────────────

function leavesOf(fields: CredentialField[]): Uint8Array[] {
  return fields.map((field) =>
    computeCredentialAttrLeaf(fromHex(field.fieldId), fromHex(field.valueHex), fromHex(field.randHex)),
  );
}

export async function credentialAttributeTree(fields: CredentialField[]) {
  return buildMerkleTree(leavesOf(fields), 8);
}

// `values` is keyed by fieldId; empty values are left out (the field just isn't provable for this
// holder). Returns no root (all-zero) when nothing was filled in. Identity fields get a fresh salt
// each time, so re-issuing a credential also gives the holder a new identity code.
export async function buildCredentialAttributes(
  template: CredentialFieldTemplate[],
  values: Record<string, string>,
): Promise<{ fields: CredentialField[]; root: Uint8Array }> {
  const fields: CredentialField[] = template
    .filter((field) => (values[field.fieldId] || '').trim())
    .map((field) => ({
      fieldId: field.fieldId,
      label: field.label,
      ...(field.type === 'identity'
        ? identityField(field, values[field.fieldId])
        : { valueHex: hex(encodeAttributeValue(values[field.fieldId])) }),
      randHex: hex(crypto.getRandomValues(new Uint8Array(32))),
    }));
  if (fields.length === 0) return { fields, root: new Uint8Array(32) };
  const tree = await credentialAttributeTree(fields);
  return { fields, root: tree.rootBytes };
}

export async function packageRootMatches(pkg: CredentialPackage): Promise<boolean> {
  if (!pkg.fields?.length) return false;
  const tree = await credentialAttributeTree(pkg.fields);
  return hex(tree.rootBytes) === pkg.credAttrRoot.toLowerCase();
}

// ── Delivery ──────────────────────────────────────────────────────────────────

export async function deliveryLookupId(holderPkHex: string, eventIdHex: string): Promise<string> {
  const input = new Uint8Array(LOOKUP_DOMAIN.length + 64);
  input.set(LOOKUP_DOMAIN, 0);
  input.set(fromHex(holderPkHex), LOOKUP_DOMAIN.length);
  input.set(fromHex(eventIdHex), LOOKUP_DOMAIN.length + 32);
  return hex(await sha256(input));
}

export async function deliverCredentialPackage(pkg: CredentialPackage, encryptionPublicKeyHex: string): Promise<void> {
  const envelope = await sealForRecipient(encryptionPublicKeyHex, new TextEncoder().encode(JSON.stringify(pkg)));
  const response = await fetch(`${IPFS_API_URL}/api/credential-delivery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookupId: await deliveryLookupId(pkg.holderPk, pkg.eventId), envelope }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Credential delivery failed (${response.status})`);
  }
}

function isPackageFor(pkg: any, eventIdHex: string, holderPkHex: string): pkg is CredentialPackage {
  return (
    pkg?.version === 1 &&
    pkg.eventId?.toLowerCase() === eventIdHex.toLowerCase() &&
    pkg.holderPk?.toLowerCase() === holderPkHex.toLowerCase() &&
    Array.isArray(pkg.fields)
  );
}

// Returns the first delivered package that decrypts with this holder's key, is addressed to this
// (holder, event), whose attributes rebuild the root it claims and that passes `accept` (the
// on-chain check for one token, see holder-proofs.ts). Saves it locally.
export async function fetchDeliveredPackage(
  eventIdHex: string,
  holderPkHex: string,
  keys: EncryptionKeyPair,
  accept: (pkg: CredentialPackage) => Promise<boolean> = async () => true,
): Promise<CredentialPackage | null> {
  const lookupId = await deliveryLookupId(holderPkHex, eventIdHex);
  const response = await fetch(`${IPFS_API_URL}/api/credential-delivery/${lookupId}`);
  if (!response.ok) throw new Error(`Could not reach the credential delivery service (${response.status})`);
  const { envelopes } = (await response.json()) as { envelopes: SealedEnvelope[] };
  for (const envelope of envelopes || []) {
    try {
      const pkg = JSON.parse(new TextDecoder().decode(await openEnvelope(envelope, keys)));
      if (isPackageFor(pkg, eventIdHex, holderPkHex) && (await packageRootMatches(pkg)) && (await accept(pkg))) {
        saveCredentialPackage(pkg);
        return pkg;
      }
    } catch {
      // Not for us, or tampered — try the next one.
    }
  }
  return null;
}

// ── Fallback link ─────────────────────────────────────────────────────────────
// For holder codes without an encryption key. The package rides in the URL fragment, which the
// browser never sends to a server — but anyone who gets the link can read the values.

export function packageToLinkFragment(pkg: CredentialPackage): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(pkg)));
}

export function packageFromLinkFragment(fragment: string): CredentialPackage | null {
  try {
    const pkg = JSON.parse(new TextDecoder().decode(fromBase64Url(fragment.replace(/^#/, ''))));
    return pkg?.version === 1 && Array.isArray(pkg.fields) && pkg.eventId && pkg.holderPk ? pkg : null;
  } catch {
    return null;
  }
}

// ── On-chain check ────────────────────────────────────────────────────────────

type LedgerCredentials = {
  pathForLeaf(index: bigint, leaf: Uint8Array): MerkleTreePathArg;
  checkRoot(root: { field: bigint }): boolean;
};

// The ledger path for this holder's credential leaf, if the leaf really is what the contract stored
// for tokenId (i.e. the package matches the credential on-chain). credAttrRoot is all-zero for a
// token with no private attributes (claim(), or mintTo without them).
export async function credentialPathOnChain(
  credentials: LedgerCredentials,
  tokenId: number | bigint,
  eventIdHex: string,
  holderPkHex: string,
  credAttrRootHex: string,
): Promise<MerkleTreePathArg | null> {
  const leaf = computeCredentialLeaf(fromHex(eventIdHex), fromHex(holderPkHex), fromHex(credAttrRootHex));
  const path = credentials.pathForLeaf(BigInt(tokenId), leaf);
  const field = await merklePathRootField(path);
  return credentials.checkRoot({ field }) ? path : null;
}
