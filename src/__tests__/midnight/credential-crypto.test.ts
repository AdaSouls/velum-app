import {
  deriveEncryptionKeyPair,
  deriveInboxKeyPair,
  formatHolderCode,
  fromBase64Url,
  openEnvelope,
  parseHolderCode,
  sealForRecipient,
  toBase64Url,
} from '../../midnight/credential-crypto';

// Real Web Crypto (Node's, installed by setupTests) — X25519, HKDF and AES-GCM all run for real.
const secretKey = new Uint8Array(32).fill(7);
const organizerA = new Uint8Array(32).fill(1);
const organizerB = new Uint8Array(32).fill(2);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('deriveEncryptionKeyPair', () => {
  it('is deterministic for the same local secret and organizer', async () => {
    const first = await deriveEncryptionKeyPair(secretKey, organizerA);
    const second = await deriveEncryptionKeyPair(secretKey, organizerA);
    expect(first.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(second.publicKeyHex).toBe(first.publicKeyHex);
  });

  it('gives each organizer a different key, so holders cannot be linked across organizers', async () => {
    const a = await deriveEncryptionKeyPair(secretKey, organizerA);
    const b = await deriveEncryptionKeyPair(secretKey, organizerB);
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
  });
});

describe('deriveInboxKeyPair', () => {
  it('is one key per identity, deterministic, unlike any per-organizer key, and opens what was sealed to it', async () => {
    const first = await deriveInboxKeyPair(secretKey);
    expect((await deriveInboxKeyPair(secretKey)).publicKeyHex).toBe(first.publicKeyHex);
    expect((await deriveInboxKeyPair(new Uint8Array(32).fill(8))).publicKeyHex).not.toBe(first.publicKeyHex);
    expect((await deriveEncryptionKeyPair(secretKey, organizerA)).publicKeyHex).not.toBe(first.publicKeyHex);
    const envelope = await sealForRecipient(first.publicKeyHex, new TextEncoder().encode('new DNI'));
    expect(text(await openEnvelope(envelope, first))).toBe('new DNI');
  });
});

describe('sealForRecipient / openEnvelope', () => {
  it('round-trips a payload for the intended recipient', async () => {
    const keys = await deriveEncryptionKeyPair(secretKey, organizerA);
    const envelope = await sealForRecipient(keys.publicKeyHex, new TextEncoder().encode('Sector: Campo'));
    expect(envelope.format).toBe('velum-credential');
    expect(envelope.ciphertext).not.toContain('Campo');
    expect(text(await openEnvelope(envelope, keys))).toBe('Sector: Campo');
  });

  it('cannot be opened with another key', async () => {
    const keys = await deriveEncryptionKeyPair(secretKey, organizerA);
    const other = await deriveEncryptionKeyPair(secretKey, organizerB);
    const envelope = await sealForRecipient(keys.publicKeyHex, new TextEncoder().encode('secret'));
    await expect(openEnvelope(envelope, other)).rejects.toBeTruthy();
  });

  it('rejects a tampered ciphertext', async () => {
    const keys = await deriveEncryptionKeyPair(secretKey, organizerA);
    const envelope = await sealForRecipient(keys.publicKeyHex, new TextEncoder().encode('secret'));
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    await expect(openEnvelope({ ...envelope, ciphertext: bytes.toString('base64') }, keys)).rejects.toBeTruthy();
  });
});

describe('holder code', () => {
  const pk = 'ab'.repeat(32);
  const enc = 'cd'.repeat(32);

  it('carries the holder key and the encryption key', () => {
    expect(parseHolderCode(formatHolderCode(pk, enc))).toEqual({ holderPkHex: pk, encryptionPublicKeyHex: enc });
  });

  it('still accepts an old code with only the holder key', () => {
    expect(parseHolderCode(`  ${pk.toUpperCase()}  `)).toEqual({ holderPkHex: pk, encryptionPublicKeyHex: null });
  });

  it('rejects anything else', () => {
    expect(parseHolderCode('not-hex')).toBeNull();
    expect(parseHolderCode(`${pk}.short`)).toBeNull();
    expect(parseHolderCode(`${pk}.${enc}.${enc}`)).toBeNull();
  });
});

describe('base64url helpers', () => {
  it('round-trip bytes that need the url-safe alphabet', () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
  });
});
