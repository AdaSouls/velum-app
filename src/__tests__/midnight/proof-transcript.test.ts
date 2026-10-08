import { readProofDetails } from '../../midnight/proof-transcript';

// Same shape as a real proveTokenOwnership transcript read off the local devnet (2026-09-24):
// member(requestId) → idx[requestId] popeq record → member(tokenId) → ...
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
const atom = (length: number) => ({ tag: 'atom', value: { tag: 'bytes', length } });
const cell = (hex: string, length: number) => ({
  push: { storage: false, value: { tag: 'cell', content: { value: [bytes(hex)], alignment: [atom(length)] } } },
});
const ledgerField = (index: string) => ({
  idx: {
    cached: false,
    pushPath: false,
    path: [
      { tag: 'value', value: { value: [bytes('01')], alignment: [atom(1)] } },
      { tag: 'value', value: { value: [bytes(index)], alignment: [atom(1)] } },
    ],
  },
});
const keyedBy = (hex: string) => ({
  idx: { cached: false, pushPath: false, path: [{ tag: 'value', value: { value: [bytes(hex)], alignment: [atom(32)] } }] },
});

const REQUEST = 'a2'.repeat(32);
const VERIFIER = 'f0'.repeat(32);
const EVENT = '4d'.repeat(32);

const RECIPIENT = 'c3'.repeat(32);

// Records written before addressed requests (AdaSouls/velum f6f6114) have 4 fields; now there's a
// 5th, the recipient (all-zero = open request).
function program({ tokenIdLe, recipient, record: given }: { tokenIdLe?: string; recipient?: string; record?: any } = {}) {
  const record =
    given ??
    (recipient === undefined
      ? { value: [bytes(VERIFIER), bytes(EVENT), bytes(''), bytes('')], alignment: [atom(32), atom(32), atom(32), atom(32)] }
      : {
          value: [bytes(VERIFIER), bytes(EVENT), bytes(''), bytes(''), bytes(recipient)],
          alignment: [atom(32), atom(32), atom(32), atom(32), atom(32)],
        });
  const ops: any[] = [
    { dup: { n: 0 } },
    ledgerField('0b'),
    cell(REQUEST, 32),
    'member',
    { popeq: { cached: true, result: { value: [bytes('01')], alignment: [atom(1)] } } },
    { dup: { n: 0 } },
    ledgerField('0b'),
    keyedBy(REQUEST),
    // Trailing zero bytes are dropped: an all-zero fieldId/setRoot is an empty atom.
    { popeq: { cached: false, result: record } },
  ];
  if (tokenIdLe !== undefined) ops.push({ dup: { n: 0 } }, cell(tokenIdLe, 8), 'member');
  return ops;
}

describe('readProofDetails', () => {
  it('reads the request, its event and the token of an ownership proof', () => {
    expect(readProofDetails(program({ tokenIdLe: '' }))).toEqual({
      requestId: REQUEST,
      verifierPk: VERIFIER,
      eventId: EVENT,
      fieldId: '0'.repeat(64),
      setRoot: '0'.repeat(64),
      recipientPk: null,
      tokenId: 0n,
      conditions: null,
    });
  });

  it('reads the recipient of an addressed request', () => {
    expect(readProofDetails(program({ recipient: RECIPIENT }))?.recipientPk).toBe(RECIPIENT);
  });

  it('treats an all-zero recipient as an open request', () => {
    expect(readProofDetails(program({ recipient: '' }))?.recipientPk).toBeNull();
  });

  it('reads the token id little-endian', () => {
    expect(readProofDetails(program({ tokenIdLe: '0501' }))?.tokenId).toBe(261n);
  });

  it('has no token for an anonymous proof', () => {
    expect(readProofDetails(program())?.tokenId).toBeNull();
  });

  it('reads every used condition of a credential request (proveCredentialAttributes)', () => {
    const DNI = '0d'.repeat(32);
    const GRADE = '01'.repeat(32);
    // { verifier, eventId, recipient, 4 × { fieldId, setRoot } }; unused slots are empty atoms.
    const values = [VERIFIER, EVENT, RECIPIENT, DNI, 'aa'.repeat(32), GRADE, 'bb'.repeat(32), '', '', '', ''].map(bytes);
    const details = readProofDetails(program({ record: { value: values, alignment: values.map(() => atom(32)) } }));
    expect(details).toMatchObject({
      requestId: REQUEST,
      verifierPk: VERIFIER,
      eventId: EVENT,
      recipientPk: RECIPIENT,
      fieldId: DNI,
      setRoot: 'aa'.repeat(32),
      tokenId: null,
      conditions: [
        { slot: 0, fieldId: DNI, setRoot: 'aa'.repeat(32) },
        { slot: 1, fieldId: GRADE, setRoot: 'bb'.repeat(32) },
      ],
    });
  });

  it('returns null for a transcript without a request lookup', () => {
    expect(readProofDetails([{ dup: { n: 0 } }, 'member'])).toBeNull();
  });
});
