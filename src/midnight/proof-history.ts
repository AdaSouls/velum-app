// This browser's record of the proofs the holder made from each POAP (ownership and anonymous
// ones), so the card can show "Proven · <last date>" and list past receipts after the popup is
// closed. The chain keeps every proof transaction anyway, but nothing there points back to the
// token for the anonymous ones (that's the point), so only the holder can keep this list. Owner-only:
// never shown on shared pages. SDK-free: backup.ts imports the prefix so it rides in the encrypted
// backup with the rest of the local-only data.
import { markBackupDirty } from './backup-status';

export const PROOF_HISTORY_PREFIX = 'velum:midnight:proofs:';
export const PROOF_HISTORY_EVENT = 'velum:proof-history';
const MAX_ENTRIES = 50;

export type ProofRecord = {
  kind: string; // circuit name, a PROOF_KINDS key (proof-verification.ts)
  question: string; // what was proven, in words — same text as the receipt
  txHash: string | null;
  provenAt: string; // ISO date
  // The request it answered, so the holder's list can leave out what's already answered.
  requestId?: string;
  // Answered together with other proofs (an identity check + its question, holderProofs.jsx): all
  // of their transactions, so the Verify link checks them as a set (verifyProof.jsx).
  groupTxHashes?: string[];
};

// The verify link for a record: the whole group when it was answered as one.
export function recordVerifyHashes(record: ProofRecord): string | string[] {
  return record.groupTxHashes && record.groupTxHashes.length > 1 ? record.groupTxHashes : (record.txHash as string);
}

// holderPk (holder_pk(issuer) of this token's owner) scopes the list to one wallet + contract
// deployment: a redeploy starts tokenIds from 0 again, but the holder pk changes with it.
function key(holderPkHex: string, tokenId: bigint | number | string): string {
  return `${PROOF_HISTORY_PREFIX}${holderPkHex}:${String(tokenId)}`;
}

// Newest first.
export function getProofHistory(holderPkHex: string, tokenId: bigint | number | string): ProofRecord[] {
  try {
    const raw = window.localStorage.getItem(key(holderPkHex, tokenId));
    const list = raw ? (JSON.parse(raw) as ProofRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addProofRecord(holderPkHex: string, tokenId: bigint | number | string, record: ProofRecord): void {
  try {
    const list = [record, ...getProofHistory(holderPkHex, tokenId)].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(key(holderPkHex, tokenId), JSON.stringify(list));
    markBackupDirty();
    window.dispatchEvent(new CustomEvent(PROOF_HISTORY_EVENT, { detail: { holderPkHex, tokenId: String(tokenId) } }));
  } catch (error) {
    // The proof itself already landed on-chain; losing the local note only hides the badge.
    console.error('Could not save the proof to this browser:', error);
  }
}
