import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { ContractAddress } from '@midnight-ntwrk/ledger-v8';
import { findDeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { combineLatest, firstValueFrom, from, map, type Observable } from 'rxjs';
import { Contract, ledger as ledgerOf, pureCircuits } from './contract/managed/poap/contract/index.js';
import type { Ledger } from './contract/managed/poap/contract/index.js';
import {
  POAP_PRIVATE_STATE_KEY,
  buildProviders,
  connectToWallet,
  createWitnesses,
  getOrCreatePrivateState,
} from './providers';
import { deriveCallerPk, deriveHolderPk, type PoapPrivateState, type TokenRecord } from './witnesses';
import type { MerkleTreePathArg } from './merkle';
import { deriveEncryptionKeyPair, deriveInboxKeyPair, type EncryptionKeyPair } from './credential-crypto';

export type PoapProviders = Awaited<ReturnType<typeof buildProviders>>;

// Output of PoapContractService.prepare(): a connected wallet with providers built and scoped to
// the contract, before anything has touched the (still locked) private state.
export type PreparedConnection = {
  contractAddress: ContractAddress;
  providers: PoapProviders;
  coinPublicKey: string;
  privateStateKey: string;
};

// Pure — no ledger/witness access, no proof, no transaction (confirmed in the compiled contract:
// exported as a standalone pureCircuits function, not part of provableCircuits/callTx at all).
// This *is* the compiled contract's own persistentCommit computation, not a hand-reimplementation,
// so there's no drift risk the way there was for deriveCallerPk/deriveHolderPk. Not a
// PoapContractService method since it needs no connection — organizers compute this locally before
// createEvent, from a value/rand pair that never touches the network until the transaction itself.
export function computePrivateMetadataCommit(value: Uint8Array, rand: Uint8Array): Uint8Array {
  return pureCircuits.computePrivateMetadataCommit(value, rand);
}

// Predicts the eventId createEvent(label, ...) will assign for a given organizer, BEFORE
// submitting the transaction. Needed because createEvent no longer takes a raw caller-chosen
// eventId (that was a confirmed vulnerability — event-ID squatting: whoever called createEvent
// first for a given id became its organizer forever, with no recovery). The real id is now
// event_key(organizerPk, label), computed inside the circuit and returned from the call — but
// rather than parse that return value out of the transaction result (an SDK response shape this
// codebase has no way to verify against a live network right now), callers should just derive it
// themselves the same way the deploy tooling in poap-midnight does: independently, via this same
// pure circuit, using the caller's own already-known pk (see witnesses.ts#deriveCallerPk /
// useMidnight's `provider.address`).
export function computeEventId(organizer: Uint8Array, label: Uint8Array): Uint8Array {
  return pureCircuits.computeEventId(organizer, label);
}

// Precompute the exact attribute leaf the chain will check, so an organizer can build their
// private-attribute Merkle tree client-side before calling createEvent with the resulting root.
// See poap-midnight/contracts/src/test/poap-simulator.ts's buildMerklePath for the matching
// tree-construction algorithm (ported to merkle.ts in this directory).
export function computeAttributeLeaf(
  eventId: Uint8Array,
  fieldId: Uint8Array,
  value: Uint8Array,
  rand: Uint8Array,
): Uint8Array {
  return pureCircuits.computeAttributeLeaf(eventId, fieldId, value, rand);
}

// Per-credential private attributes (B7) — see credential-delivery.ts. Both are pure circuits, so
// the leaves computed here are exactly what mintTo's credentials tree and proveCredentialAttributes
// check. holderPk in computeCredentialLeaf is the recipient's holder_pk(organizer), the same value
// mintTo received (holder_secret_pk inside the contract is that same hash, just not disclosed).
export function computeCredentialAttrLeaf(fieldId: Uint8Array, value: Uint8Array, rand: Uint8Array): Uint8Array {
  return pureCircuits.computeCredentialAttrLeaf(fieldId, value, rand);
}

export function computeCredentialLeaf(eventId: Uint8Array, holderPk: Uint8Array, credAttrRoot: Uint8Array): Uint8Array {
  return pureCircuits.computeCredentialLeaf(eventId, holderPk, credAttrRoot);
}

// Identity documents (flow 12) — the attribute value that ties a credential to one document. Inputs
// come from identity.ts#identityInputs (each 32 bytes, salt non-zero; the circuit rejects a zero salt).
export function computeIdentityValue(
  country: Uint8Array,
  docType: Uint8Array,
  number: Uint8Array,
  salt: Uint8Array,
): Uint8Array {
  return pureCircuits.computeIdentityValue(country, docType, number, salt);
}

export type PoapState = {
  ledger: Ledger;
  privateState: PoapPrivateState;
};

// Exported for admin-deploy.service.ts's deployContract() call — same compiled contract, no
// witness-binding difference between connecting to an existing deployment and deploying a new one
// (createWitnesses() reads secretKey from the private-state context either way, not a closure).
export const compiledPoapContract = CompiledContract.make<Contract<PoapPrivateState>>('PoapContract', Contract).pipe(
  CompiledContract.withWitnesses(createWitnesses()),
);

// Mirrors the pattern verified against a live devnet in ../POAP-Midnight/scripts/deploy.ts:
// CompiledContract.make(tag, ctor).pipe(withWitnesses(...)), then findDeployedContract(providers,
// options), then call circuits via `foundContract.callTx.<circuit>(...)`.
export class PoapContractService {
  private constructor(
    private readonly deployedContract: FoundContract<Contract<PoapPrivateState>>,
    private readonly providers: PoapProviders,
    private readonly privateState: PoapPrivateState,
    readonly contractAddress: ContractAddress,
    // Cheap, wallet-unique identifier available immediately on connect (no extra tx) — used to
    // scope useMidnight.js's caller-pk cache per wallet, so switching wallets in the same browser
    // profile can't serve a stale pk derived from a different wallet.
    readonly walletCoinPublicKey: string,
  ) {}

  // Connecting runs in three steps so the caller can put the interactive one — unlocking the
  // private state with the user's password (private-state-unlock.ts) — between the other two,
  // outside any timeout: prepare() → unlockPrivateState(prepared...) → finish(prepared).
  static async prepare(contractAddress: ContractAddress, wallet: InitialAPI): Promise<PreparedConnection> {
    console.log('[PoapContractService.prepare] connectToWallet()…');
    const connection = await connectToWallet(wallet);
    console.log('[PoapContractService.prepare] connectToWallet() resolved');
    const providers = await buildProviders(connection);
    console.log('[PoapContractService.prepare] buildProviders() resolved');
    // Required before any private-state get/set — scopes storage to this contract address
    // (namespace isolation between different contracts sharing the same browser profile).
    providers.privateStateProvider.setContractAddress(contractAddress);
    return {
      contractAddress,
      providers,
      coinPublicKey: connection.shieldedAddress.shieldedCoinPublicKey,
      privateStateKey: POAP_PRIVATE_STATE_KEY,
    };
  }

  static async finish(prepared: PreparedConnection): Promise<PoapContractService> {
    const { contractAddress, providers, coinPublicKey } = prepared;
    const { privateState, isNew } = await getOrCreatePrivateState(providers);
    console.log('[PoapContractService.finish] getOrCreatePrivateState() resolved, isNew:', isNew);

    // findDeployedContract's initialPrivateState must only be passed the first time (it requires
    // there be NO pre-existing private state at this key); on subsequent connects it loads the
    // existing state from the provider itself, so we omit it.
    console.log('[PoapContractService.finish] findDeployedContract()…');
    const deployedContract = await findDeployedContract(providers, {
      compiledContract: compiledPoapContract,
      contractAddress,
      privateStateId: POAP_PRIVATE_STATE_KEY,
      ...(isNew ? { initialPrivateState: privateState } : {}),
    });
    console.log('[PoapContractService.finish] findDeployedContract() resolved');

    return new PoapContractService(deployedContract, providers, privateState, contractAddress, coinPublicKey);
  }

  /** Reactive stream combining public ledger state with this browser's private token state. */
  get state$(): Observable<PoapState> {
    return combineLatest([
      this.providers.publicDataProvider
        .contractStateObservable(this.contractAddress, { type: 'latest' })
        .pipe(map((contractState) => ledgerOf(contractState.data))),
      from(this.providers.privateStateProvider.get(POAP_PRIVATE_STATE_KEY) as Promise<PoapPrivateState>),
    ]).pipe(map(([ledger, privateState]) => ({ ledger, privateState })));
  }

  /** One-shot snapshot of state$, for callers that just need a single read (e.g. role checks). */
  async getState(): Promise<PoapState> {
    return firstValueFrom(this.state$);
  }

  // getCallerPk *is* an exported circuit, but the compiler leaves it out of provableCircuits
  // (it discloses nothing, so nothing to prove) — midnight-js-contracts' callTx is built strictly
  // from provableCircuits, so `callTx.getCallerPk` doesn't exist (confirmed 2026-08-14: "is not a
  // function" at runtime, and via midnight-js-contracts' own source). Derived locally instead —
  // see deriveCallerPk's comment in witnesses.ts for why this is safe against drift.
  async getCallerPkHex(): Promise<string> {
    return Buffer.from(deriveCallerPk(this.privateState.secretKey)).toString('hex');
  }

  // Same provableCircuits exclusion as getCallerPk above — see deriveHolderPk's comment in
  // witnesses.ts. This is the value a subscriber hands an organizer so that organizer can
  // mintTo(eventId, thisValue) them — NOT their caller pk / wallet address, which is a different,
  // globally-correlatable value and would result in an unrecoverable mint if used here by mistake.
  async getHolderPkHex(issuerId: Uint8Array): Promise<string> {
    return Buffer.from(deriveHolderPk(this.privateState.secretKey, issuerId)).toString('hex');
  }

  // X25519 key pair for receiving credential attributes from this organizer — derived from
  // local_sk like holder_pk, so it needs no storage of its own. See credential-crypto.ts.
  async getEncryptionKeyPair(issuerId: Uint8Array): Promise<EncryptionKeyPair> {
    return deriveEncryptionKeyPair(this.privateState.secretKey, issuerId);
  }

  // X25519 key pair holders seal credential update requests to (credential-update.ts). One per
  // identity; its public half goes into every Credential event's metadata as updateRequestKey.
  async getInboxKeyPair(): Promise<EncryptionKeyPair> {
    return deriveInboxKeyPair(this.privateState.secretKey);
  }

  async claim(eventId: Uint8Array, isSoulbound: boolean) {
    return this.deployedContract.callTx.claim(eventId, isSoulbound);
  }

  // `label` — NOT the on-chain eventId anymore (that was a confirmed vulnerability: a raw
  // caller-chosen eventId let anyone squat any id, permanently locking out whoever the id "really"
  // belonged to). The contract now derives the real eventId as event_key(organizerPk, label)
  // internally and returns it. Callers should independently compute the same value via
  // computeEventId(organizerPk, label) above (organizerPk = the connected wallet's own pk, e.g.
  // useMidnight's `provider.address`) rather than trying to read it back out of this call's
  // transaction result. `label` can be anything unique-to-you — a fresh random 32 bytes is fine,
  // exactly like the old eventId was.
  //
  // privateMetadataCommit: Bytes<32> — commit/reveal hook for an event's optional extra-info field
  // (see computePrivateMetadataCommit above and revealPrivateMetadata below). Independent of
  // isPublicMint — createEvent.jsx's own step 4 has a separate public/private switch for this
  // specific field. Defaults to the all-zero "no private part" commit for callers that don't set
  // one (including when the field is left public, or empty).
  //
  // privateAttributesRoot: Bytes<32> — Merkle root over independently-provable private attributes
  // (see computeAttributeLeaf above and proveAttributeMembership/publishDisclosureRequest below).
  // Unlike privateMetadataCommit (one blob, reveal-all-or-nothing), this lets a holder prove a
  // PREDICATE about one field ("this event's region is in the EU") without revealing the value, to
  // whoever asked. Defaults to the all-zero "no attributes committed" root.
  async createEvent(
    label: Uint8Array,
    maxSupply: bigint,
    expiration: bigint,
    isPublicMint: boolean,
    metadataURI: string,
    privateMetadataCommit: Uint8Array = new Uint8Array(32),
    privateAttributesRoot: Uint8Array = new Uint8Array(32),
  ) {
    return this.deployedContract.callTx.createEvent(
      label,
      maxSupply,
      expiration,
      isPublicMint,
      metadataURI,
      privateMetadataCommit,
      privateAttributesRoot,
    );
  }

  async deactivateEvent(eventId: Uint8Array) {
    return this.deployedContract.callTx.deactivateEvent(eventId);
  }

  // Reactivate a previously-deactivated event — deactivateEvent used to be permanent, this
  // undoes it. Same authority as deactivateEvent (admin or the event's own organizer).
  async reactivateEvent(eventId: Uint8Array) {
    return this.deployedContract.callTx.reactivateEvent(eventId);
  }

  // Publishes `value` into the public eventRevealedMetadata ledger map, once it's verified to
  // match the event's own privateMetadataCommit (computePrivateMetadataCommit(value, rand)). No
  // identity check on-chain — knowing (value, rand) is itself the authorization, so this is safe
  // to call with whatever the organizer locally stored at createEvent time.
  async revealPrivateMetadata(eventId: Uint8Array, value: Uint8Array, rand: Uint8Array) {
    return this.deployedContract.callTx.revealPrivateMetadata(eventId, value, rand);
  }

  // Same commit/reveal mechanism as revealPrivateMetadata above, but for one specific token's
  // private field (tokenPrivateMetadataCommit) instead of the event-level one.
  async revealPrivateTokenMetadata(tokenId: bigint, value: Uint8Array, rand: Uint8Array) {
    return this.deployedContract.callTx.revealPrivateTokenMetadata(tokenId, value, rand);
  }

  // tokenMetadataURI/tokenPrivateMetadataCommit let the organizer personalize this specific
  // recipient's token. The contract stores exactly what's passed here — there's no on-chain
  // fallback to the event's own metadataURI/privateMetadataCommit, so callers that want to mirror
  // the event (the common case) must pass ev.metadataURI/ev.privateMetadataCommit explicitly. The
  // defaults below (empty URI, all-zero commit) mean "this token has no metadata", not "inherit".
  // credentialAttributesRoot commits this recipient's own private attributes into the credential
  // (poap.compact's credentials tree, proven later via proveCredentialAttributes); all-zero = none.
  async mintTo(
    eventId: Uint8Array,
    recipientPk: Uint8Array,
    tokenMetadataURI: string = '',
    tokenPrivateMetadataCommit: Uint8Array = new Uint8Array(32),
    credentialAttributesRoot: Uint8Array = new Uint8Array(32),
  ) {
    return this.deployedContract.callTx.mintTo(
      eventId,
      recipientPk,
      tokenMetadataURI,
      tokenPrivateMetadataCommit,
      credentialAttributesRoot,
    );
  }

  // ── Selective disclosure ──────────────────────────────────────────────────
  //
  // Channel B — prove a PREDICATE about a hidden attribute ("this event's field
  // belongs to this set") to whoever asked, without ever disclosing the actual
  // value on-chain. See poap.compact's "Selective Disclosure" section for the
  // full design and the security fix that makes it sound (the set root MUST
  // come from a published DisclosureRequest, never a caller-supplied argument).

  // A verifier publishes the question BEFORE anyone can prove against it —
  // pins eventId/fieldId/setRoot on-chain so the prover can't choose the
  // answer to their own question. Returns the derived requestId (hand it to
  // whoever should answer, alongside the actual set members so they can build
  // a real membership path — see merkle.ts's buildMerklePath).
  //
  // recipient: the holder pseudonym (getHolderPk under the event's organizer) that must answer,
  // or all-zero for an open request any holder of the event can answer. proveTokenOwnership and
  // proveEventAttendance enforce it when set. Questions about a credential's private attributes use
  // publishCredentialRequest instead: a disclosure request can't be answered for them.
  async publishDisclosureRequest(
    label: Uint8Array,
    eventId: Uint8Array,
    fieldId: Uint8Array,
    setRoot: Uint8Array,
    recipient: Uint8Array,
  ) {
    return this.deployedContract.callTx.publishDisclosureRequest(label, eventId, fieldId, setRoot, recipient);
  }

  // Stateless — never writes to the ledger, signals success purely by not
  // throwing (every failure path in the circuit is an assert). Most "just
  // answer the question" flows should use this, not the *Once variant below.
  async proveAttributeMembership(
    requestId: Uint8Array,
    value: Uint8Array,
    rand: Uint8Array,
    attributePath: MerkleTreePathArg,
    setMembershipPath: MerkleTreePathArg,
  ) {
    return this.deployedContract.callTx.proveAttributeMembership(
      requestId, value, rand, attributePath, setMembershipPath,
    );
  }

  // Single-use variant — records a nullifier so this (wallet, request) pair
  // can't be redeemed twice. Only use when a disclosure must provably happen
  // at most once (e.g. redeeming a perk); it costs a real state write.
  async proveAttributeMembershipOnce(
    requestId: Uint8Array,
    value: Uint8Array,
    rand: Uint8Array,
    attributePath: MerkleTreePathArg,
    setMembershipPath: MerkleTreePathArg,
  ) {
    return this.deployedContract.callTx.proveAttributeMembershipOnce(
      requestId, value, rand, attributePath, setMembershipPath,
    );
  }

  // Public proof of holding: reveals tokenId (not the wallet), against a published request for
  // the token's event. Stateless like proveAttributeMembership. See ownership-proof.ts.
  async proveTokenOwnership(requestId: Uint8Array, tokenId: bigint) {
    return this.deployedContract.callTx.proveTokenOwnership(requestId, tokenId);
  }

  // Anonymous: "I hold a live credential of this request's event", without saying which.
  // credPath comes from the ledger (credential-delivery.ts#credentialPathOnChain).
  async proveEventAttendance(requestId: Uint8Array, credAttrRoot: Uint8Array, credPath: MerkleTreePathArg) {
    return this.deployedContract.callTx.proveEventAttendance(requestId, credAttrRoot, credPath);
  }

  // A question about ONE holder's credential: up to CREDENTIAL_CONDITION_SLOTS conditions
  // (fieldId, setRoot), answered all together or not at all (proveCredentialAttributes) — an
  // identity check and the question asked with it can't be answered apart. Always addressed:
  // recipient is the holder pseudonym. Unused slots are all-zero; slot 0 must be used. Returns the
  // derived requestId (private.result).
  async publishCredentialRequest(
    label: Uint8Array,
    eventId: Uint8Array,
    recipient: Uint8Array,
    conditions: { fieldId: Uint8Array; setRoot: Uint8Array }[],
  ) {
    return this.deployedContract.callTx.publishCredentialRequest(label, eventId, recipient, conditions);
  }

  // Answers a credential request in one proof, from one credential: per slot the attribute's value
  // and rand, its path in the credential's attribute tree (depth 8) and in the condition's set
  // (depth 16). Unused slots take zeros and any well-formed paths (holder-proofs.ts#proveAttributes).
  async proveCredentialAttributes(
    requestId: Uint8Array,
    values: Uint8Array[],
    rands: Uint8Array[],
    attributePaths: MerkleTreePathArg[],
    setMembershipPaths: MerkleTreePathArg[],
    credPath: MerkleTreePathArg,
  ) {
    return this.deployedContract.callTx.proveCredentialAttributes(
      requestId, values, rands, attributePaths, setMembershipPaths, credPath,
    );
  }

  // Replaces a live credential in one transaction (issuer or admin): burns tokenId and mints its
  // replacement to the same holder pseudonym and event, closing its pending update request. Doesn't
  // use up the event's supply, but the event must be active and not expired and its issuer not
  // blocked; a failed re-issue leaves the old credential untouched.
  async reissueCredential(
    tokenId: bigint,
    newMetadataURI: string,
    newPrivateMetadataCommit: Uint8Array,
    newCredentialAttributesRoot: Uint8Array,
  ) {
    return this.deployedContract.callTx.reissueCredential(
      tokenId, newMetadataURI, newPrivateMetadataCommit, newCredentialAttributesRoot,
    );
  }

  async burn(tokenId: bigint) {
    return this.deployedContract.callTx.burn(tokenId);
  }

  // Credential update requests (flow 13): the token's holder files (or replaces) a commitment to an
  // encrypted request sent off-chain (credential-update.ts); its issuer or the admin can dismiss it.
  // burn() also clears it.
  async requestCredentialUpdate(tokenId: bigint, payloadCommit: Uint8Array) {
    return this.deployedContract.callTx.requestCredentialUpdate(tokenId, payloadCommit);
  }

  async dismissCredentialUpdate(tokenId: bigint) {
    return this.deployedContract.callTx.dismissCredentialUpdate(tokenId);
  }

  async pause() {
    return this.deployedContract.callTx.pause();
  }

  async unpause() {
    return this.deployedContract.callTx.unpause();
  }

  async registerIssuer(issuerPk: Uint8Array) {
    return this.deployedContract.callTx.registerIssuer(issuerPk);
  }

  async deactivateIssuer(issuerPk: Uint8Array) {
    return this.deployedContract.callTx.deactivateIssuer(issuerPk);
  }
}

export type { TokenRecord };
