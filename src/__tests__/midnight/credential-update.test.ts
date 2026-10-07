import {
  buildUpdateRequest,
  changeError,
  envelopeCommit,
  fetchUpdateRequest,
  reissueValues,
  submitUpdateRequest,
} from '../../midnight/credential-update';
import { deriveEncryptionKeyPair, deriveInboxKeyPair } from '../../midnight/credential-crypto';

// Real Web Crypto (setupTests): the organizer really opens what the holder sealed.
const EVENT = 'aa'.repeat(32);
const ISSUER = 'bb'.repeat(32);
const HOLDER = 'cc'.repeat(32);
const DNI = '0d'.repeat(32);
const PKG = {
  version: 1 as const,
  eventId: EVENT,
  issuerPk: ISSUER,
  holderPk: HOLDER,
  credAttrRoot: 'dd'.repeat(32),
  fields: [
    { fieldId: '01'.repeat(32), label: 'Grade', valueHex: '39'.padEnd(64, '0'), randHex: '11'.repeat(32) },
    {
      fieldId: DNI,
      label: 'DNI',
      valueHex: '77'.repeat(32),
      randHex: '12'.repeat(32),
      identity: { country: 'ARG', docType: 'national_id', number: '12345678', saltHex: 'ab'.repeat(32) },
    },
  ],
};
const TOKEN = { tokenId: 5, eventId: EVENT, issuerPk: ISSUER, holderPk: HOLDER };

describe('changeError', () => {
  it('needs one of the documents and a new, valid number', () => {
    expect(changeError(PKG, { fieldId: '01'.repeat(32), number: '1' })).toMatch(/pick one of your documents/i);
    expect(changeError(PKG, { fieldId: DNI, number: '' })).toMatch(/enter the new number/i);
    expect(changeError(PKG, { fieldId: DNI, number: '12.345.678' })).toMatch(/already has/i);
    expect(changeError(PKG, { fieldId: DNI, number: '12#' })).toBeTruthy();
    expect(changeError(PKG, { fieldId: DNI, number: '40.111.222' })).toBeNull();
  });
});

describe('buildUpdateRequest', () => {
  it('carries the current package, the normalized change and where to deliver the new credential', () => {
    const payload = buildUpdateRequest(TOKEN, PKG, [{ fieldId: DNI, number: '40.111.222' }], 'ee'.repeat(32), '  New DNI  ');
    expect(payload).toMatchObject({
      kind: 'velum-credential-update',
      tokenId: 5,
      currentPackage: PKG,
      changes: [{ fieldId: DNI, number: '40111222' }],
      reason: 'New DNI',
      holderEncryptionKey: 'ee'.repeat(32),
    });
  });
});

describe('reissueValues', () => {
  it('keeps every current value and swaps in the requested number', () => {
    const payload = buildUpdateRequest(TOKEN, PKG, [{ fieldId: DNI, number: '40.111.222' }], 'ee'.repeat(32));
    expect(reissueValues(payload)).toEqual({ ['01'.repeat(32)]: '9', [DNI]: '40111222' });
  });
});

describe('submitUpdateRequest / fetchUpdateRequest', () => {
  afterEach(() => {
    delete (global as any).fetch;
  });

  it('uploads the sealed request, files its hash on-chain, and only the organizer can open it', async () => {
    const organizerSk = new Uint8Array(32).fill(3);
    const inbox = await deriveInboxKeyPair(organizerSk);
    const holderKeys = await deriveEncryptionKeyPair(new Uint8Array(32).fill(4), Buffer.from(ISSUER, 'hex'));
    const stored: Record<string, any[]> = {};
    (global as any).fetch = jest.fn(async (url: string, init?: any) => {
      const commit = url.split('/').pop() as string;
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body);
        // Through JSON, like the server.
        stored[body.payloadCommit] = [...(stored[body.payloadCommit] || []), JSON.parse(JSON.stringify(body.envelope))];
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ envelopes: stored[commit] || [] }) };
    });
    const service = {
      getEncryptionKeyPair: jest.fn(async () => holderKeys),
      requestCredentialUpdate: jest.fn(async () => ({ public: { txHash: '0x1' } })),
    };

    const { payloadCommit } = await submitUpdateRequest(service, {
      token: TOKEN,
      pkg: PKG,
      changes: [{ fieldId: DNI, number: '40111222' }],
      reason: 'New DNI',
      updateRequestKey: inbox.publicKeyHex,
    });

    expect(service.requestCredentialUpdate).toHaveBeenCalledWith(5n, Uint8Array.from(Buffer.from(payloadCommit, 'hex')));
    expect(await envelopeCommit(stored[payloadCommit][0])).toBe(payloadCommit);
    expect(JSON.stringify(stored[payloadCommit][0])).not.toContain('40111222');

    const opened = await fetchUpdateRequest(payloadCommit, inbox);
    expect(opened).toMatchObject({ tokenId: 5, changes: [{ fieldId: DNI, number: '40111222' }], holderEncryptionKey: holderKeys.publicKeyHex });

    // Someone else's key can't open it; an envelope posted under a commitment that isn't its own hash is ignored.
    expect(await fetchUpdateRequest(payloadCommit, await deriveInboxKeyPair(new Uint8Array(32).fill(9)))).toBeNull();
    stored['99'.repeat(32)] = stored[payloadCommit];
    expect(await fetchUpdateRequest('99'.repeat(32), inbox)).toBeNull();
  });

  it('refuses an invalid change or an event without an update key, before anything is sent', async () => {
    (global as any).fetch = jest.fn();
    const service = { getEncryptionKeyPair: jest.fn(), requestCredentialUpdate: jest.fn() };
    await expect(
      submitUpdateRequest(service, { token: TOKEN, pkg: PKG, changes: [{ fieldId: DNI, number: '12345678' }], updateRequestKey: 'ff'.repeat(32) }),
    ).rejects.toThrow(/already has/);
    await expect(
      submitUpdateRequest(service, { token: TOKEN, pkg: PKG, changes: [{ fieldId: DNI, number: '1' }], updateRequestKey: '' }),
    ).rejects.toThrow(/can't receive update requests/);
    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(service.requestCredentialUpdate).not.toHaveBeenCalled();
  });
});
