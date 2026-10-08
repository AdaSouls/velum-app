// Why a new token can't be minted for an event right now, read from the live ledger: the same checks
// poap.compact's mintTokenTo (and mintTo) runs, so a flow can stop before a transaction that would
// revert and say why. A re-issue (reissueCredential, reviewCredentialUpdate.jsx) runs the same
// checks except the supply cap: it doesn't use up a place.
//
// Expiration can never be undone: no circuit extends it. Nor can a full supply for a plain mint (the
// cap counts every token ever minted, burns don't free a place).

// Expiration is checked against the block time, not this browser's clock: leave a margin so a
// transaction proved just before the deadline isn't sent to fail.
export const EXPIRY_MARGIN_MS = 10 * 60 * 1000;

export type MintBlocker = 'paused' | 'missing' | 'inactive' | 'expired' | 'soldOut' | 'issuerBlocked';

type EventLike = {
  maxSupply: bigint | number;
  minted: bigint | number;
  expiration: bigint | number;
  organizer: Uint8Array;
  isActive: boolean;
};

type LedgerLike = {
  isPaused?: boolean;
  events?: { member(key: Uint8Array): boolean; lookup(key: Uint8Array): EventLike };
  issuers?: { member(key: Uint8Array): boolean; lookup(key: Uint8Array): { isActive: boolean } };
};

export const MINT_BLOCKER_MESSAGES: Record<MintBlocker, string> = {
  paused: 'The contract is paused by the admin, so nothing can be issued right now.',
  missing: "This event isn't on-chain.",
  inactive: 'This event is deactivated. Only an admin can reactivate it.',
  expired: 'This event has expired, so its credentials can no longer be issued or re-issued.',
  soldOut: "This event has used its whole supply: revoking doesn't free a place, so no new POAP can be issued.",
  issuerBlocked: "An admin has blocked this event's organizer, so nothing can be issued under it.",
};

// Empty = minting should go through. A ledger without these maps (older or mocked state) reports
// nothing: the check is a guard, the contract stays the authority.
export function mintBlockers(
  ledger: LedgerLike | null | undefined,
  eventIdHex: string,
  nowMs = Date.now(),
  { reissue = false }: { reissue?: boolean } = {},
): MintBlocker[] {
  if (!ledger) return [];
  const blockers: MintBlocker[] = [];
  if (ledger.isPaused) blockers.push('paused');
  if (!ledger.events) return blockers;
  const eventId = Uint8Array.from(Buffer.from(eventIdHex, 'hex'));
  if (!ledger.events.member(eventId)) return [...blockers, 'missing'];
  const ev = ledger.events.lookup(eventId);
  if (!ev.isActive) blockers.push('inactive');
  const expiration = Number(ev.expiration);
  if (expiration > 0 && expiration * 1000 <= nowMs + EXPIRY_MARGIN_MS) blockers.push('expired');
  const maxSupply = BigInt(ev.maxSupply);
  if (!reissue && maxSupply > 0n && BigInt(ev.minted) >= maxSupply) blockers.push('soldOut');
  if (ledger.issuers?.member(ev.organizer) && !ledger.issuers.lookup(ev.organizer).isActive) blockers.push('issuerBlocked');
  return blockers;
}
