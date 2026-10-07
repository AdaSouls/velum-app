// Anonymous proofs a holder answers from their own POAP (holderProofs.jsx):
//   - proveEventAttendance: "I hold a live credential of this event" — reveals neither the token
//     nor the wallet. Works for any token (claim() and mintTo() both add the credential leaf; the
//     attribute root is all-zero when there are no private attributes).
//   - proveCredentialAttribute: same, plus "my <field> is one of the values this request accepts".
// Both answer a DisclosureRequest someone else published (normally the organizer), so the holder
// never publishes anything under their own caller_pk. Attribute requests are always addressed to
// one holder (their holder_pk under the event's organizer): only that holder can answer, and the
// request already names them, so that proof hides the value but not who answered.
//
// Identity documents (flow 12): a verifier who checked the holder's document asks "is it this one?"
// with a set of exactly one value, computeIdentityValue(document, salt). Nothing about the value is
// published (the rule is just { op: 'identity' }), so the holder checks it locally: their own value
// must rebuild the request's setRoot. The real question (a grade…) comes as a second request from the
// same verifier; the two are answered together (groupAnswerable), one signature each.
import { getAllDisclosureRequests, type IndexedDisclosureRequest } from './indexer.service';
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
  proveCredentialAttribute(
    requestId: Uint8Array,
    value: Uint8Array,
    rand: Uint8Array,
    attributePath: any,
    setMembershipPath: any,
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

export type AnswerableRequest =
  | { kind: 'attendance'; request: IndexedDisclosureRequest }
  | {
      kind: 'attribute';
      request: IndexedDisclosureRequest;
      field: CredentialField;
      label: string;
      // null when no published rule could be found for it. `verified` = its set was already checked
      // against the on-chain root; big ranges are checked when the holder proves (see fetchRequestRule).
      // For an identity request: whether the holder's own document rebuilds the root.
      rule: Rule | null;
      verified: boolean;
    };

const IDENTITY_RULE: Rule = { op: 'identity' };

export const isIdentityRequest = (item: AnswerableRequest) => item.kind === 'attribute' && item.rule?.op === 'identity';

// The one-value set of an identity request. Built from the raw 32-byte value (not text), the same
// way publishDisclosureRequest.jsx builds it from the number and code it was given.
export async function identitySetTree(valueHex: string) {
  return buildMerkleTree([fromHex(valueHex)], 16);
}

// Plain requests (attendance / ownership) and requests about one of this event's credential
// fields. Requests about event-level attributes are the organizer's to answer, not the holder's.
// Only requests this holder can actually answer: plain ones that are open or addressed to them,
// attribute ones addressed to them (the contract rejects open attribute requests).
export async function listAnswerableRequests(
  eventIdHex: string,
  credentialFields: CredentialField[],
  holderPkHex: string,
  pkg: CredentialPackage | null = null,
): Promise<AnswerableRequest[]> {
  const me = holderPkHex.toLowerCase();
  const requests = (await getAllDisclosureRequests()).filter((r) => r.eventId === eventIdHex);
  const fields = new Map(credentialFields.map((f) => [f.fieldId, f]));
  const answerable: AnswerableRequest[] = [];
  for (const request of requests) {
    const recipient = requestRecipient(request);
    if (isOwnershipRequest(request)) {
      if (!recipient || recipient === me) answerable.push({ kind: 'attendance', request });
    } else if (fields.has(request.fieldId) && recipient === me) {
      const field = fields.get(request.fieldId) as CredentialField;
      if (isIdentityField(field)) {
        const own = pkg?.fields.find((f) => f.fieldId === request.fieldId);
        const matches = own
          ? hex((await identitySetTree(own.valueHex)).rootBytes) === request.setRoot.toLowerCase()
          : false;
        answerable.push({ kind: 'attribute', request, field, label: field.label, rule: IDENTITY_RULE, verified: matches });
        continue;
      }
      const found = await fetchRequestRule(request.requestId, request.setRoot).catch(() => null);
      answerable.push({
        kind: 'attribute',
        request,
        field,
        label: field.label,
        rule: found?.rule ?? null,
        verified: found?.verified ?? false,
      });
    }
  }
  return answerable;
}

// Requests to answer together: an identity check and the questions the same verifier asked with it.
// Everything else stays on its own. Order: identity first, as it was asked.
export function groupAnswerable(items: AnswerableRequest[]): AnswerableRequest[][] {
  const withIdentity = new Set(items.filter(isIdentityRequest).map((item) => item.request.verifierPk));
  const groups = new Map<string, AnswerableRequest[]>();
  const out: AnswerableRequest[][] = [];
  for (const item of items) {
    const verifier = item.request.verifierPk;
    if (item.kind !== 'attribute' || !withIdentity.has(verifier)) {
      out.push([item]);
      continue;
    }
    let group = groups.get(verifier);
    if (!group) {
      group = [];
      groups.set(verifier, group);
      out.push(group);
    }
    group.push(item);
  }
  out.forEach((group) => group.sort((a, b) => Number(isIdentityRequest(b)) - Number(isIdentityRequest(a))));
  return out;
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
// returned unchecked and checked when the holder proves (proveAttribute) — or by the verify page.
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

export async function proveAttribute(
  service: Service,
  token: HolderToken,
  request: IndexedDisclosureRequest,
  rule: Rule,
  pkg: CredentialPackage,
): Promise<{ txHash: string | null }> {
  const field = pkg.fields.find((f) => f.fieldId === request.fieldId);
  if (!field) throw new Error("This credential has no value for the field this request asks about.");
  const value = fromHex(field.valueHex);
  const rand = fromHex(field.randHex);

  const attributeTree = await credentialAttributeTree(pkg.fields);
  const attributePath = attributeTree.pathForLeaf(computeCredentialAttrLeaf(fromHex(field.fieldId), value, rand));

  const setTree = rule.op === 'identity' ? await identitySetTree(field.valueHex) : await setTreeFor(rule);
  if (hex(setTree.rootBytes) !== request.setRoot.toLowerCase()) {
    throw new Error(
      rule.op === 'identity'
        ? "This identity check is for a different document (or identity code) than the one on your credential."
        : "The accepted values published for this question don't match it on-chain, so the proof would fail.",
    );
  }
  let setPath;
  try {
    setPath = setTree.pathForLeaf(value);
  } catch {
    throw new Error("Your value isn't one of the values this request accepts, so the proof would fail.");
  }

  const credPath = await credentialPath(service, token, pkg.credAttrRoot);
  const result = await service.proveCredentialAttribute(fromHex(request.requestId), value, rand, attributePath, setPath, credPath);
  return { txHash: txHashOf(result) };
}
