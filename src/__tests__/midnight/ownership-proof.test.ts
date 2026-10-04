import { pickOwnershipRequest, proveOwnership, txHashOf } from '../../midnight/ownership-proof';

jest.mock('../../midnight/indexer.service', () => ({
  getAllDisclosureRequests: jest.fn(),
}));

const ZERO = '0'.repeat(64);
const EVENT = 'aa'.repeat(32);
const ORGANIZER = 'bb'.repeat(32);
const ME = 'cc'.repeat(32);

const request = (overrides: Record<string, unknown>) => ({
  requestId: '11'.repeat(32),
  verifierPk: ORGANIZER,
  eventId: EVENT,
  fieldId: ZERO,
  setRoot: ZERO,
  recipientPk: null,
  publishedBlock: 1,
  publishedTx: null,
  ...overrides,
});

describe('pickOwnershipRequest', () => {
  it("prefers the organizer's plain request over the holder's own", () => {
    const choice = pickOwnershipRequest(
      [request({ requestId: 'mine', verifierPk: ME }), request({ requestId: 'org' })],
      { eventIdHex: EVENT, organizerPkHex: ORGANIZER, myPkHex: ME },
    );
    expect(choice).toEqual({ source: 'organizer', requestId: 'org' });
  });

  it("falls back to the holder's own plain request", () => {
    const choice = pickOwnershipRequest([request({ requestId: 'mine', verifierPk: ME })], {
      eventIdHex: EVENT,
      organizerPkHex: ORGANIZER,
      myPkHex: ME,
    });
    expect(choice).toEqual({ source: 'self', requestId: 'mine' });
  });

  it('ignores attribute requests, other events and third parties', () => {
    const choice = pickOwnershipRequest(
      [
        request({ fieldId: 'dd'.repeat(32) }),
        request({ setRoot: 'ee'.repeat(32) }),
        request({ eventId: 'ff'.repeat(32) }),
        request({ verifierPk: '99'.repeat(32) }),
        request({ recipientPk: '77'.repeat(32) }),
      ],
      { eventIdHex: EVENT, organizerPkHex: ORGANIZER, myPkHex: ME },
    );
    expect(choice).toEqual({ source: 'new', requestId: null });
  });
});

describe('txHashOf', () => {
  it('reads the hash from FinalizedCallTxData.public', () => {
    expect(txHashOf({ public: { txHash: '0xabc' } })).toBe('0xabc');
    expect(txHashOf(undefined)).toBeNull();
  });
});

describe('proveOwnership', () => {
  it('proves against an existing request with a single call', async () => {
    const service = {
      publishDisclosureRequest: jest.fn(),
      proveTokenOwnership: jest.fn().mockResolvedValue({ public: { txHash: '0xproof' } }),
    };
    const result = await proveOwnership({
      service,
      tokenId: 7,
      eventIdHex: EVENT,
      choice: { source: 'organizer', requestId: '11'.repeat(32) },
    });
    expect(service.publishDisclosureRequest).not.toHaveBeenCalled();
    expect(service.proveTokenOwnership).toHaveBeenCalledWith(
      Uint8Array.from(Buffer.from('11'.repeat(32), 'hex')),
      BigInt(7),
    );
    expect(result).toEqual({
      txHash: '0xproof',
      requestId: '11'.repeat(32),
      requestSource: 'organizer',
      publishTxHash: null,
    });
  });

  it('publishes a plain request first and proves against the id the circuit returned', async () => {
    const returnedId = new Uint8Array(32).fill(0x22);
    const service = {
      publishDisclosureRequest: jest
        .fn()
        .mockResolvedValue({ public: { txHash: '0xpub' }, private: { result: returnedId } }),
      proveTokenOwnership: jest.fn().mockResolvedValue({ public: { txHash: '0xproof' } }),
    };
    const steps: string[] = [];
    const result = await proveOwnership({
      service,
      tokenId: 3,
      eventIdHex: EVENT,
      choice: { source: 'new', requestId: null },
      onStep: (step) => steps.push(step),
    });
    const [, eventId, fieldId, setRoot, recipient] = service.publishDisclosureRequest.mock.calls[0];
    expect(Buffer.from(eventId).toString('hex')).toBe(EVENT);
    expect(fieldId).toEqual(new Uint8Array(32));
    expect(setRoot).toEqual(new Uint8Array(32));
    expect(recipient).toEqual(new Uint8Array(32)); // open: any holder of the event can answer
    expect(service.proveTokenOwnership).toHaveBeenCalledWith(returnedId, BigInt(3));
    expect(steps).toEqual(['publish', 'prove']);
    expect(result).toEqual({
      txHash: '0xproof',
      requestId: '22'.repeat(32),
      requestSource: 'new',
      publishTxHash: '0xpub',
    });
  });

  it('fails clearly when the published request id cannot be read back', async () => {
    const service = {
      publishDisclosureRequest: jest.fn().mockResolvedValue({ public: { txHash: '0xpub' } }),
      proveTokenOwnership: jest.fn(),
    };
    await expect(
      proveOwnership({ service, tokenId: 1, eventIdHex: EVENT, choice: { source: 'new', requestId: null } }),
    ).rejects.toThrow(/could not read its ID/);
    expect(service.proveTokenOwnership).not.toHaveBeenCalled();
  });
});
