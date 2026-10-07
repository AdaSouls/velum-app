// Identity documents on credentials (poap.compact flow 12, AdaSouls/velum 0e37df6). SDK-free: the
// event wizard, Mint POAP, the holder's card and Ask for a Disclosure all share these rules, and
// issuer and verifier must turn the same document into the exact same bytes.
//
// A credential field of type `identity` carries one document. The organizer fixes the country and
// document type per field when creating the event; at mint time only the number is typed. The
// attribute value is computeIdentityValue(country, docType, number, salt) — a salted hash — so the
// public setRoot of a request about it can't be brute-forced back to a document number. The holder
// receives the number and the salt (their "identity code") with the other private details; a
// verifier who has seen the person's document types its number, gets the code from the holder's
// request link, and asks for a proof against that single value.
import { encodeAttributeValue } from './attribute-value-codec';

// ISO 3166-1 alpha-3, the format the contract docs prescribe ("ARG").
export const ID_COUNTRIES: { code: string; label: string }[] = [
  { code: 'ARG', label: 'Argentina' },
  { code: 'AUS', label: 'Australia' },
  { code: 'BOL', label: 'Bolivia' },
  { code: 'BRA', label: 'Brazil' },
  { code: 'CAN', label: 'Canada' },
  { code: 'CHL', label: 'Chile' },
  { code: 'COL', label: 'Colombia' },
  { code: 'CRI', label: 'Costa Rica' },
  { code: 'CUB', label: 'Cuba' },
  { code: 'DEU', label: 'Germany' },
  { code: 'DOM', label: 'Dominican Republic' },
  { code: 'ECU', label: 'Ecuador' },
  { code: 'ESP', label: 'Spain' },
  { code: 'FRA', label: 'France' },
  { code: 'GBR', label: 'United Kingdom' },
  { code: 'GTM', label: 'Guatemala' },
  { code: 'HND', label: 'Honduras' },
  { code: 'IND', label: 'India' },
  { code: 'ITA', label: 'Italy' },
  { code: 'JPN', label: 'Japan' },
  { code: 'MEX', label: 'Mexico' },
  { code: 'NIC', label: 'Nicaragua' },
  { code: 'NLD', label: 'Netherlands' },
  { code: 'NZL', label: 'New Zealand' },
  { code: 'PAN', label: 'Panama' },
  { code: 'PER', label: 'Peru' },
  { code: 'PRT', label: 'Portugal' },
  { code: 'PRY', label: 'Paraguay' },
  { code: 'SLV', label: 'El Salvador' },
  { code: 'URY', label: 'Uruguay' },
  { code: 'USA', label: 'United States' },
  { code: 'VEN', label: 'Venezuela' },
];

// Prefer numbers that last a lifetime (a national id number, not a card serial): an update request
// is needed whenever the number changes.
export const ID_DOC_TYPES: { code: string; label: string }[] = [
  { code: 'national_id', label: 'National ID' },
  { code: 'passport', label: 'Passport' },
  { code: 'tax_id', label: 'Tax ID' },
  { code: 'residence_permit', label: 'Residence permit' },
];

export type IdentityDocument = { country: string; docType: string };

// What the holder's package keeps for an identity field, next to its valueHex/randHex.
export type IdentityOpening = IdentityDocument & { number: string; saltHex: string };

const SALT_HEX = /^[0-9a-f]{64}$/;
const ZERO_SALT = '0'.repeat(64);

export function isKnownCountry(code: string | undefined): boolean {
  return ID_COUNTRIES.some((c) => c.code === code);
}

export function isKnownDocType(code: string | undefined): boolean {
  return ID_DOC_TYPES.some((t) => t.code === code);
}

export function docTypeLabel(code: string | undefined): string {
  return ID_DOC_TYPES.find((t) => t.code === code)?.label || code || 'Document';
}

// "National ID · ARG"
export function documentLabel(doc: Partial<IdentityDocument>): string {
  return [docTypeLabel(doc.docType), doc.country].filter(Boolean).join(' · ');
}

// Upper-case, no spaces or separators: "12.345.678" and "12 345 678" are the same document.
export function normalizeDocNumber(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
}

// The normalized number, or why it can't be one. Empty input is allowed (the field is optional on a
// credential) and returns ''.
export function checkDocNumber(raw: string): { value: string } | { error: string } {
  const value = normalizeDocNumber(raw);
  if (!value) return { value: '' };
  if (!/^[A-Z0-9]+$/.test(value)) return { error: 'Only letters and digits.' };
  if (value.length > 32) return { error: 'At most 32 characters.' };
  return { value };
}

export function maskDocNumber(number: string): string {
  const n = normalizeDocNumber(number);
  return n.length <= 4 ? '••••' : `••••${n.slice(-4)}`;
}

export function newIdentitySalt(): string {
  for (;;) {
    const hex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    if (hex !== ZERO_SALT) return hex;
  }
}

export function isValidSalt(saltHex: string | undefined): boolean {
  const s = (saltHex || '').toLowerCase();
  return SALT_HEX.test(s) && s !== ZERO_SALT;
}

// computeIdentityValue's four inputs, each right-padded with zeros to 32 bytes (contract docs,
// integration.md). Throws on an invalid number or salt rather than producing a value nobody can match.
export function identityInputs(
  doc: IdentityDocument,
  number: string,
  saltHex: string,
): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const checked = checkDocNumber(number);
  if ('error' in checked) throw new Error(checked.error);
  if (!checked.value) throw new Error('Enter the document number.');
  if (!isValidSalt(saltHex)) throw new Error('That identity code is not valid.');
  return [
    encodeAttributeValue(doc.country),
    encodeAttributeValue(doc.docType),
    encodeAttributeValue(checked.value),
    Uint8Array.from(Buffer.from(saltHex.toLowerCase(), 'hex')),
  ];
}
