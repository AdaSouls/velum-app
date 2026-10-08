// Anonymous proofs a holder answers from their own POAP (holderProofs.jsx):
//   - proveEventAttendance: "I hold a live credential of this event" — reveals neither the token
//     nor the wallet. Works for any token (claim() and mintTo() both add the credential leaf; the
//     attribute root is all-zero when there are no private attributes). Answers a DisclosureRequest.
//   - proveCredentialAttributes: answers a CredentialRequest — up to four conditions on this
//     holder's own private attributes ("my <field> is one of these values"), all in one proof, from
//     one credential, or none. Always addressed to one holder (their holder_pk under the event's
//     organizer): the proof hides the values but not who answered.
// The holder never publishes anything under their own caller_pk.
//
// Identity documents (flow 12): a verifier who checked the holder's document asks "is it this one?"
// with a set of exactly one value, computeIdentityValue(document, salt), as one condition of the
// same request as the real question (a grade…). Nothing about that value is published, so the
// holder checks it locally: their own value must rebuild the condition's setRoot. Since the whole
// request is answered at once, the question can't be answered without the identity check.
import {
  getAllDisclosureRequests,
  getCredentialRequests,
  type IndexedCredentialRequest,
  type IndexedDisclosureRequest,
} from './indexer.service';
import { buildMerkleTree } from './merkle';
import { encodeAttributeValue } from './attribute-value-codec';
import { computeCredentialAttrLeaf } from './contract.service';
import { credentialAttributeTree, credentialPathOnChain, fetchDeliveredPackage } from './credential-delivery';
import { decodeValueHex, getCredentialPackage, type CredentialPackage } from './credential-store';
import { isOwnershipRequest, requestRecipient } from './ownership-proof';
import { txHashOf } from './tx-result';
import { fetchRequestRuleCandidates } from './disclosure-sets';
import { expandRule, isIdentityField, ruleAccepts, ruleSize, type CredentialField, type Rule } from './attribute-types';

const ZERO_HEX = '0'.repeat(64);

const fromHex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export type HolderToken = {
  tokenId: number;
  eventId: string; // hex
  issuerPk: string; // hex, organizer
  holderPk: string; // hex, this wallet's holder_pk(issuerPk) — the token's ownerPk
};

type Service = {
  getEncryptionKeyPair(issuerId: Uint8Array): Promise<any>;
  getState(): Promise<{ ledger: { credentials: any } }>;
  proveEventAttendance(requestId: Uint8Array, credAttrRoot: Uint8Array, credPath: any): Promise<any>;
  proveCredentialAttributes(
    requestId: Uint8Array,
    values: Uint8Array[],
    rands: Uint8Array[],
    attributePaths: any[],
    setMembershipPaths: any[],
    credPath: any,
  ): Promise<any>;
};

// ── The holder's private details ──────────────────────────────────────────────

// Packages are stored and delivered per (event, holder), not per token: after a credential is
// burned and issued again to the same wallet, both the local copy and the delivery service still
// hold the old one. So a package is only used if it matches what the ledger stored for this
// tokenId (burn() clears the old token's leaf, so the old package never matches).
export async function loadCredentialPackage(service: Service, token: HolderToken): Promise<CredentialPackage | null> {
  const { ledger } = await service.getState();
  const matchesToken = async (pkg: CredentialPackage) =>
    Boolean(await credentialPathOnChain(ledger.credentials, token.tokenId, token.eventId, token.holderPk, pkg.credAttrRoot));
  const local = getCredentialPackage(token.eventId, token.holderPk);
  if (local && (await matchesToken(local))) return local;
  const keys = await service.getEncryptionKeyPair(fromHex(token.issuerPk));
  return fetchDeliveredPackage(token.eventId, token.holderPk, keys, matchesToken);
}

// ── Requests the holder can answer ────────────────────────────────────────────

// One condition of a credential request, as the holder sees it. `rule` is null when no published
// rule matches the condition's root; `verified` = its set was already checked against that root
// (big ranges are checked when the holder proves, see fetchRequestRule). For an identity check:
// whether the holder's own document rebuilds the root.
export type AnswerCondition = {
  slot: number;
  fieldId: string; // hex
  setRoot: string; // hex
  field: CredentialField | null; // null: not a field of this credential
  label: string;
  rule: Rule | null;
  verified: boolean;
};

export type AnswerableRequest =
  | { kind: 'attendance'; request: IndexedDisclosureRequest }
  | { kind: 'attribute'; request: IndexedCredentialRequest; conditions: AnswerCondition[] };

// Positions in a credential request (poap.compact's Vector<4, CredentialCondition>).
export const CREDENTIAL_CONDITION_SLOTS = 4;

const IDENTITY_RULE: Rule = { op: 'identity' };

export const isIdentityCondition = (condition: AnswerCondition) => condition.rule?.op === 'identity';

// The one-value set of an identity check. Built from the raw 32-byte value (not text), the same
// way publishDisclosureRequest.jsx builds it from the number and code it was given.
export async function identitySetTree(valueHex: string) {
  return buildMerkleTree([fromHex(valueHex)], 16);
}

async function answerCondition(
  request: IndexedCredentialRequest,
  condition: { slot: number; fieldId: string; setRoot: string },
  fields: Map<string, CredentialField>,
  pkg: CredentialPackage | null,
): Promise<AnswerCondition> {
  const fieldId = condition.fieldId.toLowerCase();
  const field = fields.get(fieldId) ?? null;
  const base = {
    slot: condition.slot,
    fieldId,
    setRoot: condition.setRoot.toLowerCase(),
    field,
    label: field?.label || 'Unknown field',
  };
  if (!field) return { ...base, rule: null, verified: false };
  if (isIdentityField(field)) {
    const own = pkg?.fields.find((f) => f.fieldId === fieldId);
    const matches = own ? hex((await identitySetTree(own.valueHex)).rootBytes) === base.setRoot : false;
    return { ...base, rule: IDENTITY_RULE, verified: matches };
  }
  const found = await fetchRequestRule(request.requestId, base.setRoot).catch(() => null);
  return { ...base, rule: found?.rule ?? null, verified: found?.verified ?? false };
}

// What this holder can answer on this event: plain requests (attendance / ownership) that are open
// or addressed to them, and the credential requests addressed to them (newest first). Requests
// about event-level attributes are the organizer's to answer, not the holder's.
export async function listAnswerableRequests(
  eventIdHex: string,
  credentialFields: CredentialField[],
  holderPkHex: string,
  pkg: CredentialPackage | null = null,
): Promise<AnswerableRequest[]> {
  const me = holderPkHex.toLowerCase();
  const fields = new Map(credentialFields.map((f) => [f.fieldId.toLowerCase(), f]));
  const [disclosures, credentialRequests] = await Promise.all([
    getAllDisclosureRequests(),
    getCredentialRequests({ recipientPk: me, eventId: eventIdHex }),
  ]);
  const answerable: AnswerableRequest[] = [];
  for (const request of disclosures.filter((r) => r.eventId === eventIdHex)) {
    const recipient = requestRecipient(request);
    if (isOwnershipRequest(request) && (!recipient || recipient === me)) answerable.push({ kind: 'attendance', request });
  }
  const newestFirst = [...credentialRequests]
    .filter((request) => request.recipientPk?.toLowerCase() === me && request.eventId === eventIdHex)
    .sort((a, b) => (b.publishedBlock ?? -1) - (a.publishedBlock ?? -1));
  for (const request of newestFirst) {
    const conditions = await Promise.all(
      [...request.conditions]
        .sort((a, b) => a.slot - b.slot)
        .map((condition) => answerCondition(request, condition, fields, pkg)),
    );
    answerable.push({ kind: 'attribute', request, conditions });
  }
  return answerable;
}

// One set tree per rule, shared by the root check and the proof: a range can take seconds to build.
const setTrees = new Map<string, ReturnType<typeof buildMerkleTree>>();
export function setTreeFor(rule: Rule) {
  const key = JSON.stringify(rule);
  let tree = setTrees.get(key);
  if (!tree) {
    tree = buildMerkleTree(expandRule(rule).map(encodeAttributeValue), 16);
    tree.catch(() => setTrees.delete(key));
    setTrees.set(key, tree);
  }
  return tree;
}

async function ruleMatchesRoot(rule: Rule, setRootHex: string): Promise<boolean> {
  try {
    return hex((await setTreeFor(rule)).rootBytes) === setRootHex.toLowerCase();
  } catch {
    return false;
  }
}

// Rules up to this many values are checked against the root as soon as the request is listed.
const EAGER_CHECK_MAX = 2000;

// The question behind a request's setRoot (published by publishDisclosureRequest.jsx). Anyone can
// post under a requestId, so only a rule whose set rebuilds the on-chain root counts. Small rules
// are checked right away; a lone big range (a date range can be ~40,000 values, several seconds) is
// returned unchecked and checked when the holder proves (proveAttributes) — or by the verify page.
export async function fetchRequestRule(
  requestIdHex: string,
  setRootHex: string,
  { checkAll = false }: { checkAll?: boolean } = {},
): Promise<{ rule: Rule; verified: boolean } | null> {
  const candidates = await fetchRequestRuleCandidates(requestIdHex);
  const small = candidates.filter((rule) => ruleSize(rule) <= EAGER_CHECK_MAX);
  const big = candidates.filter((rule) => ruleSize(rule) > EAGER_CHECK_MAX);
  for (const rule of small) {
    if (await ruleMatchesRoot(rule, setRootHex)) return { rule, verified: true };
  }
  if (big.length === 1 && !checkAll) return { rule: big[0], verified: false };
  for (const rule of big) {
    if (await ruleMatchesRoot(rule, setRootHex)) return { rule, verified: true };
  }
  return null;
}

// Does this holder's value for the request's field satisfy its rule? Local only.
export function valueQualifies(pkg: CredentialPackage | null, fieldIdHex: string, rule: Rule | null): boolean {
  const field = pkg?.fields.find((f) => f.fieldId === fieldIdHex);
  if (!field || !rule) return false;
  return ruleAccepts(rule, decodeValueHex(field.valueHex));
}

// ── Proving ───────────────────────────────────────────────────────────────────

async function credentialPath(service: Service, token: HolderToken, credAttrRootHex: string) {
  const { ledger } = await service.getState();
  const path = await credentialPathOnChain(ledger.credentials, token.tokenId, token.eventId, token.holderPk, credAttrRootHex);
  if (!path) {
    throw new Error(
      "This POAP's details don't match its record on-chain (it may have been revoked, or the private details are for a different credential).",
    );
  }
  return path;
}

export async function proveAttendance(
  service: Service,
  token: HolderToken,
  requestIdHex: string,
  pkg: CredentialPackage | null,
): Promise<{ txHash: string | null }> {
  const credAttrRootHex = pkg?.credAttrRoot ?? ZERO_HEX;
  const path = await credentialPath(service, token, credAttrRootHex);
  const result = await service.proveEventAttendance(fromHex(requestIdHex), fromHex(credAttrRootHex), path);
  return { txHash: txHashOf(result) };
}

// Builds one condition's answer: its value and rand, the attribute's path in the credential's
// attribute tree and the value's path in the condition's set.
async function conditionAnswer(condition: AnswerCondition, pkg: CredentialPackage, attributeTree: any) {
  const field = pkg.fields.find((f) => f.fieldId === condition.fieldId);
  if (!field) throw new Error(`This credential has no value for "${condition.label}".`);
  if (!condition.rule) throw new Error(`The accepted values for "${condition.label}" aren't available.`);
  const value = fromHex(field.valueHex);
  const rand = fromHex(field.randHex);
  const attributePath = attributeTree.pathForLeaf(computeCredentialAttrLeaf(fromHex(field.fieldId), value, rand));
  const identity = condition.rule.op === 'identity';
  const setTree = identity ? await identitySetTree(field.valueHex) : await setTreeFor(condition.rule);
  if (hex(setTree.rootBytes) !== condition.setRoot) {
    throw new Error(
      identity
        ? "This identity check is for a different document (or identity code) than the one on your credential."
        : `The accepted values published for "${condition.label}" don't match the request on-chain, so the proof would fail.`,
    );
  }
  let setPath;
  try {
    setPath = setTree.pathForLeaf(value);
  } catch {
    throw new Error(`Your ${condition.label} isn't one of the values this request accepts, so the proof would fail.`);
  }
  return { value, rand, attributePath, setPath };
}

// Answers every condition of a credential request in one proof (proveCredentialAttributes). Each
// answer goes in its condition's slot; unused slots take zero values and slot 0's paths (the circuit
// ignores them, it only needs well-formed paths of the right depth: 8 and 16).
export async function proveAttributes(
  service: Service,
  token: HolderToken,
  request: IndexedCredentialRequest,
  conditions: AnswerCondition[],
  pkg: CredentialPackage,
): Promise<{ txHash: string | null }> {
  const attributeTree = await credentialAttributeTree(pkg.fields);
  const answers = new Map<number, Awaited<ReturnType<typeof conditionAnswer>>>();
  for (const condition of conditions) {
    answers.set(condition.slot, await conditionAnswer(condition, pkg, attributeTree));
  }
  const first = answers.get(0);
  if (!first) throw new Error("This request has no first condition, so it can't be answered.");
  const zero = new Uint8Array(32);
  const slots = Array.from({ length: CREDENTIAL_CONDITION_SLOTS }, (_, slot) => answers.get(slot));
  const credPath = await credentialPath(service, token, pkg.credAttrRoot);
  const result = await service.proveCredentialAttributes(
    fromHex(request.requestId),
    slots.map((answer) => answer?.value ?? zero),
    slots.map((answer) => answer?.rand ?? zero),
    slots.map((answer) => (answer ?? first).attributePath),
    slots.map((answer) => (answer ?? first).setPath),
    credPath,
  );
  return { txHash: txHashOf(result) };
}
