// A credential re-issue in progress (reviewCredentialUpdate.jsx): the organizer burns the old token,
// then mints the updated one to the same holder. Two signatures, so the browser can close in
// between, and after the burn the holder has no credential at all. This record is what lets the
// organizer finish later: it holds everything the second step needs. Saved BEFORE the burn (stage
// 'burning'), moved to 'burned' once it confirms, removed when the new credential is minted.
// SDK-free, in the encrypted backup (backup.ts) like the organizer profile, so another browser of
// the same identity can finish it too.
import { markBackupDirty } from './backup-status';

export const REISSUE_PREFIX = 'velum:reissue:';

export type ReissueRecord = {
  stage: 'burning' | 'burned';
  tokenId: number; // the old token
  eventId: string;
  issuerPk: string;
  holderPk: string;
  holderEncryptionKey: string;
  tokenMetadataURI: string; // reused: same images, nothing to upload again
  values: Record<string, string>; // fieldId → canonical value for the new credential
  payloadCommit: string;
  savedAt: string;
};

function key(eventIdHex: string, tokenId: number | string): string {
  return `${REISSUE_PREFIX}${eventIdHex}:${tokenId}`;
}

export function saveReissueRecord(record: ReissueRecord): void {
  try {
    window.localStorage.setItem(key(record.eventId, record.tokenId), JSON.stringify(record));
  } catch {
    return;
  }
  markBackupDirty();
}

export function getReissueRecord(eventIdHex: string, tokenId: number | string): ReissueRecord | null {
  try {
    const raw = window.localStorage.getItem(key(eventIdHex, tokenId));
    return raw ? (JSON.parse(raw) as ReissueRecord) : null;
  } catch {
    return null;
  }
}

export function removeReissueRecord(eventIdHex: string, tokenId: number | string): void {
  try {
    window.localStorage.removeItem(key(eventIdHex, tokenId));
  } catch {
    return;
  }
  markBackupDirty();
}
