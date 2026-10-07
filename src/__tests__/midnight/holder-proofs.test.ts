import {
  fetchRequestRule,
  groupAnswerable,
  listAnswerableRequests,
  loadCredentialPackage,
  proveAttendance,
  proveAttribute,
  valueQualifies,
} from '../../midnight/holder-proofs';
import { getAllDisclosureRequests } from '../../midnight/indexer.service';
import { fetchRequestRuleCandidates } from '../../midnight/disclosure-sets';
import { credentialAttributeTree, credentialPathOnChain, fetchDeliveredPackage } from '../../midnight/credential-delivery';
import { saveCredentialPackage } from '../../midnight/credential-store';
import { buildMerkleTree } from '../../midnight/merkle';

// WASM-backed modules (compiled contract, transientHash) are mocked — see merkle.test.ts.
jest.mock('../../midnight/indexer.service', () => ({ getAllDisclosureRequests: jest.fn() }));
jest.mock('../../midnight/disclosure-sets', () => ({ fetchRequestRuleCandidates: jest.fn() }));
jest.mock('../../midnight/contract.service', () => ({ computeCredentialAttrLeaf: jest.fn((fieldId) => fieldId) }));
jest.mock('../../midnight/merkle', () => ({ buildMerkleTree: jest.fn() }));
jest.mock('../../midnight/credential-delivery', () => ({
  credentialAttributeTree: jest.fn(async () => ({ pathForLeaf: jest.fn(() => ({ attr: true })) })),
  credentialPathOnChain: jest.fn(),
  fetchDeliveredPackage: jest.fn(),
}));

const ZERO = '0'.repeat(64);
const EVENT = 'aa'.repeat(32);
const ORGANIZER = 'bb'.repeat(32);
const SECTOR = '01'.repeat(32);
const encode = (value: string) => {
  const out = Buffer.alloc(32);
  Buffer.from(value, 'utf8').copy(out);
  return out.toString('hex');
};
const PKG = {
  version: 1 as const,
  eventId: EVENT,
  issuerPk: ORGANIZER,
  holderPk: 'cc'.repeat(32),
  credAttrRoot: 'dd'.repeat(32),
  fields: [{ fieldId: SECTOR, label: 'Sector', valueHex: encode('Campo'), randHex: '11'.repeat(32) }],
};
const TOKEN = { tokenId: 4, eventId: EVENT, issuerPk: ORGANIZER, holderPk: PKG.holderPk };
const request = (overrides: Record<string, unknown>) => ({
  requestId: '22'.repeat(32),
  verifierPk: ORGANIZER,
  eventId: EVENT,
  fieldId: ZERO,
  setRoot: ZERO,
  publishedBlock: 1,
  publishedTx: null,
  ...overrides,
});

// A "root" that is just the members joined — lets fetchRequestRule's root check be exercised.
const fakeRoot = (values: string[]) =>
  Buffer.from(Buffer.from(values.map(encode).join('|')).subarray(0, 32)).toString('hex');
const oneOf = (...values: string[]) => ({ op: 'oneOf' as const, values });
beforeEach(() => {
  (buildMerkleTree as jest.Mock).mockImplementation(async (leaves: Uint8Array[]) => ({
    rootBytes: Buffer.from(Buffer.from(leaves.map((l) => Buffer.from(l).toString('hex')).join('|')).subarray(0, 32)),
    pathForLeaf: (leaf: Uint8Array) => {
      if (!leaves.some((l) => Buffer.from(l).equals(Buffer.from(leaf)))) throw new Error('not found');
      return { set: true };
    },
  }));
});

describe('loadCredentialPackage', () => {
  const token = { tokenId: 7, eventId: EVENT, issuerPk: ORGANIZER, holderPk: PKG.holderPk };
  const service = () => ({
    getState: jest.fn(async () => ({ ledger: { credentials: {} } })),
    getEncryptionKeyPair: jest.fn(async () => ({ publicKeyHex: 'ee'.repeat(32) })),
  });

  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it('uses the local copy when it matches the token on-chain', async () => {
    saveCredentialPackage(PKG);
    (credentialPathOnChain as jest.Mock).mockResolvedValue({ cred: true });
    const svc = service();
    await expect(loadCredentialPackage(svc as any, token)).resolves.toEqual(PKG);
    expect(credentialPathOnChain).toHaveBeenCalledWith({}, 7, EVENT, PKG.holderPk, PKG.credAttrRoot);
    expect(fetchDeliveredPackage).not.toHaveBeenCalled();
  });

  it("skips a local copy left by a burned credential of the same event and fetches this token's", async () => {
    const stale = { ...PKG, credAttrRoot: 'ab'.repeat(32) };
    const fresh = { ...PKG, credAttrRoot: 'cd'.repeat(32) };
    saveCredentialPackage(stale);
    (credentialPathOnChain as jest.Mock).mockImplementation(async (_c, _t, _e, _h, root) => (root === fresh.credAttrRoot ? { cred: true } : null));
    (fetchDeliveredPackage as jest.Mock).mockImplementation(async (_e, _h, _k, accept) => ((await accept(stale)) ? stale : (await accept(fresh)) ? fresh : null));
    await expect(loadCredentialPackage(service() as any, token)).resolves.toEqual(fresh);
  });
});

describe('listAnswerableRequests', () => {
  it('keeps the requests this holder can answer for this event, drops the rest', async () => {
    const ME = 'cc'.repeat(32);
    const SOMEONE_ELSE = 'dd'.repeat(32);
    const setRoot = fakeRoot(['Campo', 'Platea']);
    (getAllDisclosureRequests as jest.Mock).mockResolvedValue([
      request({ requestId: 'plain' }),
      request({ requestId: 'sector', fieldId: SECTOR, setRoot, recipientPk: ME }),
      request({ requestId: 'plain-to-me', recipientPk: ME.toUpperCase() }),
      request({ requestId: 'plain-to-other', recipientPk: SOMEONE_ELSE }),
      request({ requestId: 'sector-open', fieldId: SECTOR, setRoot }),
      request({ requestId: 'sector-to-other', fieldId: SECTOR, setRoot, recipientPk: SOMEONE_ELSE }),
      request({ requestId: 'event-level', fieldId: '03'.repeat(32), setRoot: '44'.repeat(32), recipientPk: ME }),
      request({ requestId: 'other-event', eventId: 'ff'.repeat(32) }),
    ]);
    (fetchRequestRuleCandidates as jest.Mock).mockResolvedValue([oneOf('Bogus'), oneOf('Campo', 'Platea')]);

    const items = await listAnswerableRequests(EVENT, [{ fieldId: SECTOR, label: 'Sector' }], ME);
    expect(items.map((i) => [i.kind, i.request.requestId])).toEqual([
      ['attendance', 'plain'],
      ['attribute', 'sector'],
      ['attendance', 'plain-to-me'],
    ]);
    expect(items[1]).toMatchObject({ label: 'Sector', rule: oneOf('Campo', 'Platea'), verified: true });
  });
});

describe('identity checks', () => {
  const ME = 'cc'.repeat(32);
  const DNI = '0d'.repeat(32);
  const ID_VALUE = '77'.repeat(32);
  const VERIFIER = 'ee'.repeat(32);
  const pkg = {
    ...PKG,
    fields: [
      ...PKG.fields,
      { fieldId: DNI, label: 'DNI', valueHex: ID_VALUE, randHex: '12'.repeat(32), identity: { country: 'ARG', docType: 'national_id', number: '12345678', saltHex: 'ab'.repeat(32) } },
    ],
  };
  const fields = [
    { fieldId: SECTOR, label: 'Sector' },
    { fieldId: DNI, label: 'DNI', type: 'identity' as const, country: 'ARG', docType: 'national_id' },
  ];
  // The fake tree's root is the hex of its leaves joined: the one-value identity set's root.
  const identityRoot = (valueHex: string) => Buffer.from(Buffer.from(valueHex).subarray(0, 32)).toString('hex');

  it("checks an identity request against the holder's own document, without any published values", async () => {
    (getAllDisclosureRequests as jest.Mock).mockResolvedValue([
      request({ requestId: 'mine', verifierPk: VERIFIER, fieldId: DNI, setRoot: identityRoot(ID_VALUE), recipientPk: ME }),
      request({ requestId: 'other-doc', verifierPk: VERIFIER, fieldId: DNI, setRoot: identityRoot('88'.repeat(32)), recipientPk: ME }),
    ]);
    const items = await listAnswerableRequests(EVENT, fields, ME, pkg);
    expect(items.map((i) => [i.request.requestId, i.kind === 'attribute' && i.verified])).toEqual([
      ['mine', true],
      ['other-doc', false],
    ]);
    expect(items[0]).toMatchObject({ rule: { op: 'identity' } });
    expect(fetchRequestRuleCandidates).not.toHaveBeenCalled();
  });

  it('groups an identity check with the questions its verifier asked, identity first', () => {
    const item = (requestId: string, verifierPk: string, rule: any) =>
      ({ kind: 'attribute', request: request({ requestId, verifierPk }), field: {}, label: '', rule, verified: true }) as any;
    const groups = groupAnswerable([
      item('grade', VERIFIER, oneOf('9')),
      item('id', VERIFIER, { op: 'identity' }),
      item('lone', ORGANIZER, oneOf('Campo')),
    ]);
    expect(groups.map((g) => g.map((i) => i.request.requestId))).toEqual([['id', 'grade'], ['lone']]);
  });

  it('proves an identity request with the one-value set', async () => {
    const service = {
      getState: jest.fn(async () => ({ ledger: { credentials: {} } })),
      proveCredentialAttribute: jest.fn(async () => ({ public: { txHash: '0x1' } })),
    } as any;
    (credentialPathOnChain as jest.Mock).mockResolvedValue({ cred: true });
    (credentialAttributeTree as jest.Mock).mockResolvedValue({ pathForLeaf: jest.fn(() => ({ attr: true })) });
    const req = request({ fieldId: DNI, setRoot: identityRoot(ID_VALUE), recipientPk: ME });
    await proveAttribute(service, TOKEN, req, { op: 'identity' }, pkg);
    expect(buildMerkleTree).toHaveBeenCalledWith([Uint8Array.from(Buffer.from(ID_VALUE, 'hex'))], 16);
    expect(service.proveCredentialAttribute).toHaveBeenCalled();

    const wrong = request({ fieldId: DNI, setRoot: identityRoot('88'.repeat(32)), recipientPk: ME });
    await expect(proveAttribute(service, TOKEN, wrong, { op: 'identity' }, pkg)).rejects.toThrow(/different document/);
  });
});

describe('fetchRequestRule', () => {
  const bigRange = { op: 'onOrBefore' as const, type: 'date' as const, from: '1920-01-01', to: '2008-09-24' };

  it('returns a lone big range unchecked, and checks it only when asked to', async () => {
    (fetchRequestRuleCandidates as jest.Mock).mockResolvedValue([bigRange]);
    await expect(fetchRequestRule('22'.repeat(32), '44'.repeat(32))).resolves.toEqual({ rule: bigRange, verified: false });
    expect(buildMerkleTree).not.toHaveBeenCalled();

    await expect(fetchRequestRule('22'.repeat(32), '44'.repeat(32), { checkAll: true })).resolves.toBeNull();
    expect(buildMerkleTree).toHaveBeenCalled();
  });

  it('prefers a small rule that matches the root', async () => {
    (fetchRequestRuleCandidates as jest.Mock).mockResolvedValue([bigRange, oneOf('Campo')]);
    await expect(fetchRequestRule('22'.repeat(32), fakeRoot(['Campo']))).resolves.toEqual({
      rule: oneOf('Campo'),
      verified: true,
    });
  });
});

describe('valueQualifies', () => {
  it('checks the holder value against the rule locally', () => {
    expect(valueQualifies(PKG, SECTOR, oneOf('Platea', 'Campo'))).toBe(true);
    expect(valueQualifies(PKG, SECTOR, oneOf('Platea'))).toBe(false);
    expect(valueQualifies(null, SECTOR, oneOf('Campo'))).toBe(false);
    expect(valueQualifies(PKG, SECTOR, null)).toBe(false);
  });

  it('works for ranges without building any set', () => {
    const age = { ...PKG, fields: [{ ...PKG.fields[0], valueHex: encode('21') }] };
    expect(valueQualifies(age, SECTOR, { op: 'gte', type: 'number', min: 18, max: 150 })).toBe(true);
    expect(valueQualifies(age, SECTOR, { op: 'gte', type: 'number', min: 22, max: 150 })).toBe(false);
    expect(buildMerkleTree).not.toHaveBeenCalled();
  });
});

describe('proving', () => {
  // Built per test: CRA's jest config resets mock implementations between tests.
  let service: any;
  beforeEach(() => {
    const { computeCredentialAttrLeaf } = jest.requireMock('../../midnight/contract.service');
    const { credentialAttributeTree } = jest.requireMock('../../midnight/credential-delivery');
    computeCredentialAttrLeaf.mockImplementation((fieldId: Uint8Array) => fieldId);
    credentialAttributeTree.mockImplementation(async () => ({ pathForLeaf: jest.fn(() => ({ attr: true })) }));
    service = {
      getEncryptionKeyPair: jest.fn(),
      getState: jest.fn(async () => ({ ledger: { credentials: {} } })),
      proveEventAttendance: jest.fn(async () => ({ public: { txHash: '0xatt' } })),
      proveCredentialAttribute: jest.fn(async () => ({ public: { txHash: '0xattr' } })),
    };
  });

  it('proves attendance with the all-zero root when the token has no private details', async () => {
    (credentialPathOnChain as jest.Mock).mockResolvedValue({ cred: true });
    const result = await proveAttendance(service, TOKEN, '22'.repeat(32), null);
    expect(credentialPathOnChain).toHaveBeenCalledWith({}, 4, EVENT, PKG.holderPk, ZERO);
    expect(service.proveEventAttendance).toHaveBeenCalledWith(expect.any(Uint8Array), new Uint8Array(32), { cred: true });
    expect(result).toEqual({ txHash: '0xatt' });
  });

  it('refuses to prove when the credential does not match the chain', async () => {
    (credentialPathOnChain as jest.Mock).mockResolvedValue(null);
    await expect(proveAttendance(service, TOKEN, '22'.repeat(32), PKG)).rejects.toThrow(/don't match its record/);
  });

  it('proves a credential attribute with attribute, set and credential paths', async () => {
    (credentialPathOnChain as jest.Mock).mockResolvedValue({ cred: true });
    const rule = oneOf('Platea', 'Campo');
    const req = request({ fieldId: SECTOR, setRoot: fakeRoot(rule.values) });
    const result = await proveAttribute(service, TOKEN, req, rule, PKG);
    expect(service.proveCredentialAttribute).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      Uint8Array.from(Buffer.from(encode('Campo'), 'hex')),
      Uint8Array.from(Buffer.from('11'.repeat(32), 'hex')),
      { attr: true },
      { set: true },
      { cred: true },
    );
    expect(result).toEqual({ txHash: '0xattr' });
  });

  it('stops before proving when the value is not in the accepted set', async () => {
    const req = request({ fieldId: SECTOR, setRoot: fakeRoot(['Platea']) });
    await expect(proveAttribute(service, TOKEN, req, oneOf('Platea'), PKG)).rejects.toThrow(/isn't one of the values/);
    expect(service.proveCredentialAttribute).not.toHaveBeenCalled();
  });

  it("stops before proving when the published rule doesn't rebuild the on-chain root", async () => {
    const req = request({ fieldId: SECTOR, setRoot: fakeRoot(['Other']) });
    await expect(proveAttribute(service, TOKEN, req, oneOf('Campo', 'VIP'), PKG)).rejects.toThrow(/don't match it on-chain/);
    expect(service.proveCredentialAttribute).not.toHaveBeenCalled();
  });
});
