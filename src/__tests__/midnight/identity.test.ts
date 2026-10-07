import {
  checkDocNumber,
  documentLabel,
  identityInputs,
  isValidSalt,
  maskDocNumber,
  newIdentitySalt,
  normalizeDocNumber,
} from '../../midnight/identity';

const DOC = { country: 'ARG', docType: 'national_id' };
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8').replace(/\0+$/, '');

describe('document numbers', () => {
  it('normalizes separators and case, so the issuer and the verifier type the same thing', () => {
    expect(normalizeDocNumber(' 12.345.678 ')).toBe('12345678');
    expect(normalizeDocNumber('aa-123 456/7')).toBe('AA1234567');
  });

  it('accepts letters and digits only, at most 32', () => {
    expect(checkDocNumber('12.345.678')).toEqual({ value: '12345678' });
    expect(checkDocNumber('')).toEqual({ value: '' });
    expect(checkDocNumber('12#4')).toHaveProperty('error');
    expect(checkDocNumber('1'.repeat(33))).toHaveProperty('error');
  });

  it('masks all but the last four characters', () => {
    expect(maskDocNumber('12345678')).toBe('••••5678');
    expect(maskDocNumber('123')).toBe('••••');
  });

  it('labels the document', () => {
    expect(documentLabel(DOC)).toBe('National ID · ARG');
  });
});

describe('identity codes (salts)', () => {
  it('are 32 random non-zero bytes', () => {
    const a = newIdentitySalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(newIdentitySalt());
    expect(isValidSalt(a)).toBe(true);
    expect(isValidSalt('0'.repeat(64))).toBe(false);
    expect(isValidSalt('xyz')).toBe(false);
  });
});

describe('identityInputs', () => {
  it('pads each text input to 32 bytes and passes the salt through', () => {
    const salt = 'ab'.repeat(32);
    const [country, docType, number, saltBytes] = identityInputs(DOC, '12.345.678', salt);
    [country, docType, number, saltBytes].forEach((bytes) => expect(bytes).toHaveLength(32));
    expect(text(country)).toBe('ARG');
    expect(text(docType)).toBe('national_id');
    expect(text(number)).toBe('12345678');
    expect(Buffer.from(saltBytes).toString('hex')).toBe(salt);
  });

  it('refuses an empty number or an invalid code', () => {
    expect(() => identityInputs(DOC, '', 'ab'.repeat(32))).toThrow('document number');
    expect(() => identityInputs(DOC, '123', '0'.repeat(64))).toThrow('identity code');
  });
});
