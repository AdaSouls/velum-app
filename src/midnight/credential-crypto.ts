// Encryption for credential delivery (mintPoap.jsx → holder's browser). Web Crypto only:
// X25519 ECDH → HKDF-SHA256 → AES-256-GCM, with a fresh ephemeral key per envelope ("sealed box").
//
// The holder's key pair is DERIVED, not stored: seed = SHA-256(domain ‖ local_sk ‖ organizerPk),
// used directly as the X25519 private key. So:
//   - it's recoverable from the existing backup (local_sk is already in it) — nothing new to save;
//   - it's different per organizer, like holder_pk, so two organizers can't link one holder by it.
// The public half travels inside the holder's "Get My Key" code (see formatHolderCode).

const KEY_DOMAIN = new TextEncoder().encode('velum:enc-key:v1:');
// The organizer's inbox key (credential update requests, credential-update.ts): one per identity,
// not per counterpart — holders find it in the event's metadata (updateRequestKey).
const INBOX_KEY_DOMAIN = new TextEncoder().encode('velum:issuer-inbox-key:v1:');
const HKDF_INFO = new TextEncoder().encode('velum:credential-delivery:v1');
// DER prefix of a PKCS#8 X25519 private key (RFC 8410) — Web Crypto can't import a raw X25519
// private key, only PKCS#8 or JWK.
const PKCS8_X25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const X25519 = { name: 'X25519' } as any;

export const ENVELOPE_FORMAT = 'velum-credential';

export type SealedEnvelope = {
  format: typeof ENVELOPE_FORMAT;
  version: 1;
  epk: string; // hex, ephemeral X25519 public key
  iv: string; // hex, 12 bytes
  ciphertext: string; // base64
};

export type EncryptionKeyPair = { publicKeyHex: string; privateKey: CryptoKey };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fromHex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));
const HEX_64 = /^[0-9a-fA-F]{64}$/;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// The browser's Buffer polyfill (buffer@6) has no 'base64url' encoding — convert by hand.
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(Buffer.from(base64 + '='.repeat((4 - (base64.length % 4)) % 4), 'base64'));
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function deriveEncryptionKeyPair(secretKey: Uint8Array, organizerPk: Uint8Array): Promise<EncryptionKeyPair> {
  return keyPairFromSeed(await sha256(concat(KEY_DOMAIN, secretKey, organizerPk)));
}

// Same construction, own domain: the key holders seal credential update requests to. Derived from
// local_sk, so it needs no storage and comes back with the backup like everything else.
export async function deriveInboxKeyPair(secretKey: Uint8Array): Promise<EncryptionKeyPair> {
  return keyPairFromSeed(await sha256(concat(INBOX_KEY_DOMAIN, secretKey)));
}

async function keyPairFromSeed(seed: Uint8Array): Promise<EncryptionKeyPair> {
  const privateKey = await crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519_PREFIX, seed), X25519, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  if (!jwk.x) throw new Error('This browser could not derive an X25519 public key.');
  const publicKeyHex = hex(fromBase64Url(jwk.x));
  // Re-import as non-extractable for actual use.
  const usable = await crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519_PREFIX, seed), X25519, false, ['deriveBits']);
  return { publicKeyHex, privateKey: usable };
}

async function aesKeyFor(shared: ArrayBuffer, ephemeralPub: Uint8Array, recipientPub: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephemeralPub, recipientPub), info: HKDF_INFO },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealForRecipient(recipientPublicKeyHex: string, plaintext: Uint8Array): Promise<SealedEnvelope> {
  if (!HEX_64.test(recipientPublicKeyHex)) throw new Error('Invalid recipient encryption key.');
  const recipientPub = fromHex(recipientPublicKeyHex);
  const recipientKey = await crypto.subtle.importKey('raw', recipientPub, X25519, false, []);
  const ephemeral = (await crypto.subtle.generateKey(X25519, true, ['deriveBits'])) as CryptoKeyPair;
  const ephemeralPub = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: recipientKey } as any, ephemeral.privateKey, 256);
  const key = await aesKeyFor(shared, ephemeralPub, recipientPub);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    format: ENVELOPE_FORMAT,
    version: 1,
    epk: hex(ephemeralPub),
    iv: hex(iv),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  };
}

// Throws on a wrong key or a tampered envelope (AES-GCM authentication).
export async function openEnvelope(envelope: SealedEnvelope, keys: EncryptionKeyPair): Promise<Uint8Array> {
  if (envelope?.format !== ENVELOPE_FORMAT || !HEX_64.test(envelope.epk)) {
    throw new Error('Not a Velum credential envelope.');
  }
  const ephemeralPub = fromHex(envelope.epk);
  const ephemeralKey = await crypto.subtle.importKey('raw', ephemeralPub, X25519, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: ephemeralKey } as any, keys.privateKey, 256);
  const key = await aesKeyFor(shared, ephemeralPub, fromHex(keys.publicKeyHex));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(envelope.iv) },
    key,
    Uint8Array.from(Buffer.from(envelope.ciphertext, 'base64')),
  );
  return new Uint8Array(plaintext);
}

// ── "Get My Key" code ─────────────────────────────────────────────────────────
// `<holderPk>.<encryptionPublicKey>`, both 64 hex. A bare 64-hex holder pk (codes generated before
// credential delivery existed) still mints fine — it just can't receive private attributes by
// encrypted delivery, so mintPoap.jsx falls back to a private link.

export function formatHolderCode(holderPkHex: string, encryptionPublicKeyHex: string): string {
  return `${holderPkHex}.${encryptionPublicKeyHex}`;
}

export function parseHolderCode(code: string): { holderPkHex: string; encryptionPublicKeyHex: string | null } | null {
  const trimmed = (code || '').trim();
  const [holderPkHex, encryptionPublicKeyHex, ...rest] = trimmed.split('.');
  if (rest.length || !HEX_64.test(holderPkHex || '')) return null;
  if (encryptionPublicKeyHex === undefined) return { holderPkHex: holderPkHex.toLowerCase(), encryptionPublicKeyHex: null };
  if (!HEX_64.test(encryptionPublicKeyHex)) return null;
  return { holderPkHex: holderPkHex.toLowerCase(), encryptionPublicKeyHex: encryptionPublicKeyHex.toLowerCase() };
}
