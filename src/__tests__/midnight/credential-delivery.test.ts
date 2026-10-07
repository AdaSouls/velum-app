import {
  buildCredentialAttributes,
  deliverCredentialPackage,
  deliveryLookupId,
  fetchDeliveredPackage,
  packageFromLinkFragment,
  packageToLinkFragment,
} from '../../midnight/credential-delivery';
import { deriveEncryptionKeyPair } from '../../midnight/credential-crypto';
import { getCredentialPackage } from '../../midnight/credential-store';
import { buildMerkleTree } from '../../midnight/merkle';

// The contract's pure circuits and merkle.ts's transientHash are WASM (unloadable under Jest, see
// merkle.test.ts). Leaves become a readable concatenation and the "root" is 32 bytes of a digit
// derived from the leaf count, which is enough to test the flow around them. Crypto is real.
jest.mock('../../midnight/contract.service', () => ({
  computeCredentialAttrLeaf: jest.fn(),
  computeCredentialLeaf: jest.fn(),
  computeIdentityValue: jest.fn(),
}));
jest.mock('../../midnight/merkle', () => ({
  buildMerkleTree: jest.fn(),
  merklePathRootField: jest.fn(),
}));

const EVENT = 'aa'.repeat(32);
const ISSUER = 'bb'.repeat(32);
const HOLDER = 'cc'.repeat(32);
const TEMPLATE = [
  { fieldId: '01'.repeat(32), label: 'Sector' },
  { fieldId: '02'.repeat(32), label: 'Seat' },
];

const { computeCredentialAttrLeaf, computeIdentityValue } = jest.requireMock('../../midnight/contract.service');

beforeEach(() => {
  window.localStorage.clear();
  computeCredentialAttrLeaf.mockImplementation((fieldId: Uint8Array) => fieldId);
  (buildMerkleTree as jest.Mock).mockImplementation(async (leaves: Uint8Array[]) => ({
    rootBytes: new Uint8Array(32).fill(leaves.length),
    pathForLeaf: jest.fn(),
  }));
});

describe('buildCredentialAttributes', () => {
  it('commits only the filled-in fields, each with its own random opening', async () => {
    const { fields, root } = await buildCredentialAttributes(TEMPLATE, { [TEMPLATE[0].fieldId]: ' Campo ' });
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ fieldId: TEMPLATE[0].fieldId, label: 'Sector' });
    expect(Buffer.from(fields[0].valueHex, 'hex').toString('utf8').replace(/\0+$/, '')).toBe('Campo');
    expect(fields[0].randHex).toMatch(/^[0-9a-f]{64}$/);
    expect(root).toEqual(new Uint8Array(32).fill(1));
  });

  it('commits an identity document as its salted value and keeps the opening for the holder', async () => {
    computeIdentityValue.mockImplementation(() => new Uint8Array(32).fill(7));
    const template = [{ fieldId: '03'.repeat(32), label: 'DNI', type: 'identity', country: 'ARG', docType: 'national_id' }];
    const { fields } = await buildCredentialAttributes(template, { [template[0].fieldId]: '12.345.678' });
    expect(fields[0].valueHex).toBe('07'.repeat(32));
    expect(fields[0].identity).toMatchObject({ country: 'ARG', docType: 'national_id', number: '12345678' });
    expect(fields[0].identity?.saltHex).toMatch(/^[0-9a-f]{64}$/);
    const [country, , number, salt] = computeIdentityValue.mock.calls[0];
    expect(Buffer.from(country).toString('utf8').replace(/\0+$/, '')).toBe('ARG');
    expect(Buffer.from(number).toString('utf8').replace(/\0+$/, '')).toBe('12345678');
    expect(Buffer.from(salt).toString('hex')).toBe(fields[0].identity?.saltHex);
  });

  it('returns the all-zero root when nothing is filled in', async () => {
    const { fields, root } = await buildCredentialAttributes(TEMPLATE, {});
    expect(fields).toEqual([]);
    expect(root).toEqual(new Uint8Array(32));
  });
});

describe('delivery', () => {
  async function makePackage() {
    const { fields, root } = await buildCredentialAttributes(TEMPLATE, {
      [TEMPLATE[0].fieldId]: 'Campo',
      [TEMPLATE[1].fieldId]: 'A-12',
    });
    return {
      version: 1 as const,
      eventId: EVENT,
      issuerPk: ISSUER,
      holderPk: HOLDER,
      credAttrRoot: Buffer.from(root).toString('hex'),
      fields,
    };
  }

  it('derives the lookup id from holder and event only', async () => {
    expect(await deliveryLookupId(HOLDER, EVENT)).toBe(await deliveryLookupId(HOLDER, EVENT));
    expect(await deliveryLookupId(HOLDER, EVENT)).not.toBe(await deliveryLookupId(HOLDER, 'dd'.repeat(32)));
  });

  it('uploads a sealed envelope that the holder can open, skipping junk posted under the same id', async () => {
    const pkg = await makePackage();
    const keys = await deriveEncryptionKeyPair(new Uint8Array(32).fill(9), Buffer.from(ISSUER, 'hex'));

    const posted: any[] = [];
    global.fetch = jest.fn(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      const junk = { format: 'velum-credential', version: 1, epk: 'ee'.repeat(32), iv: '00'.repeat(12), ciphertext: 'AAAA' };
      return { ok: true, json: async () => ({ envelopes: [junk, posted[0].envelope] }) };
    }) as any;

    await deliverCredentialPackage(pkg, keys.publicKeyHex);
    expect(posted[0].lookupId).toBe(await deliveryLookupId(HOLDER, EVENT));
    expect(JSON.stringify(posted[0].envelope)).not.toContain('Campo');

    const received = await fetchDeliveredPackage(EVENT, HOLDER, keys);
    expect(received).toEqual(pkg);
    expect(getCredentialPackage(EVENT, HOLDER)).toEqual(pkg);
  });

  it('ignores a package whose values do not rebuild the root it claims', async () => {
    const pkg = { ...(await makePackage()), credAttrRoot: '99'.repeat(32) };
    const keys = await deriveEncryptionKeyPair(new Uint8Array(32).fill(9), Buffer.from(ISSUER, 'hex'));
    let envelope: any;
    global.fetch = jest.fn(async (_url: string, init?: any) => {
      if (init?.method === 'POST') {
        envelope = JSON.parse(init.body).envelope;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ envelopes: [envelope] }) };
    }) as any;

    await deliverCredentialPackage(pkg, keys.publicKeyHex);
    expect(await fetchDeliveredPackage(EVENT, HOLDER, keys)).toBeNull();
  });

  it('round-trips a package through the fallback link fragment', async () => {
    const pkg = await makePackage();
    const fragment = packageToLinkFragment(pkg);
    expect(fragment).not.toMatch(/[+/=]/);
    expect(packageFromLinkFragment(`#${fragment}`)).toEqual(pkg);
    expect(packageFromLinkFragment('#garbage')).toBeNull();
  });
});
