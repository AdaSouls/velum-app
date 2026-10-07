// This browser's copy of the private attributes of the credentials it holds (see
// credential-delivery.ts). SDK-free on purpose: backup.ts imports the prefix, and the packages go
// into the encrypted backup with the rest of the local-only data. Losing it isn't fatal — the
// sealed envelope stays on Pinata and the key is re-derived from local_sk — but the fallback-link
// import only ever lives here.
import { markBackupDirty } from './backup-status';
import type { IdentityOpening } from './identity';

export const CREDENTIAL_PACKAGE_PREFIX = 'velum:midnight:credential:';

export type CredentialField = {
  fieldId: string; // hex, 32 bytes — names the field in disclosure requests
  label: string;
  valueHex: string; // encodeAttributeValue(value), 32 bytes
  randHex: string; // 32 random bytes, never reused
  // Identity fields only: the document behind valueHex (= computeIdentityValue(country, docType,
  // number, salt)). The salt is the holder's "identity code" for this credential.
  identity?: IdentityOpening;
};

export type CredentialPackage = {
  version: 1;
  eventId: string; // hex
  issuerPk: string; // hex, the event's organizer
  holderPk: string; // hex, holder_pk(issuerPk) of the recipient
  credAttrRoot: string; // hex, what mintTo received as credentialAttributesRoot
  fields: CredentialField[]; // tree order — leaf i is fields[i]
};

function key(eventIdHex: string, holderPkHex: string): string {
  return `${CREDENTIAL_PACKAGE_PREFIX}${eventIdHex}:${holderPkHex}`;
}

export function saveCredentialPackage(pkg: CredentialPackage): void {
  window.localStorage.setItem(key(pkg.eventId, pkg.holderPk), JSON.stringify(pkg));
  markBackupDirty();
}

export function getCredentialPackage(eventIdHex: string, holderPkHex: string): CredentialPackage | null {
  try {
    const raw = window.localStorage.getItem(key(eventIdHex, holderPkHex));
    return raw ? (JSON.parse(raw) as CredentialPackage) : null;
  } catch {
    return null;
  }
}

export function decodeValueHex(valueHex: string): string {
  const bytes = Buffer.from(valueHex, 'hex');
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}
