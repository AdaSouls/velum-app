import { EXPIRY_MARGIN_MS, mintBlockers } from '../../midnight/mint-readiness';

const EVENT_ID = 'aa'.repeat(32);
const NOW = 1_800_000_000_000;

const ledger = (event: Record<string, unknown> = {}, { paused = false, issuerActive = null as boolean | null } = {}) => ({
  isPaused: paused,
  events: {
    member: (key: Uint8Array) => Buffer.from(key).toString('hex') === EVENT_ID,
    lookup: () => ({ maxSupply: 0n, minted: 0n, expiration: 0n, organizer: new Uint8Array(32), isActive: true, ...event }),
  },
  issuers: {
    member: () => issuerActive !== null,
    lookup: () => ({ isActive: Boolean(issuerActive) }),
  },
});

describe('mintBlockers', () => {
  it('lets an active, open-ended event through', () => {
    expect(mintBlockers(ledger(), EVENT_ID, NOW)).toEqual([]);
  });

  it('reports every reason the contract would revert with', () => {
    const blockers = mintBlockers(
      ledger({ isActive: false, expiration: BigInt(NOW / 1000 - 1), maxSupply: 2n, minted: 2n }, { paused: true, issuerActive: false }),
      EVENT_ID,
      NOW,
    );
    expect(blockers).toEqual(['paused', 'inactive', 'expired', 'soldOut', 'issuerBlocked']);
  });

  it('treats an expiration inside the safety margin as expired', () => {
    const soon = BigInt(Math.floor((NOW + EXPIRY_MARGIN_MS / 2) / 1000));
    expect(mintBlockers(ledger({ expiration: soon }), EVENT_ID, NOW)).toEqual(['expired']);
    const later = BigInt(Math.floor((NOW + 2 * EXPIRY_MARGIN_MS) / 1000));
    expect(mintBlockers(ledger({ expiration: later }), EVENT_ID, NOW)).toEqual([]);
  });

  it('leaves room under the cap and ignores a registered, active issuer', () => {
    expect(mintBlockers(ledger({ maxSupply: 3n, minted: 2n }, { issuerActive: true }), EVENT_ID, NOW)).toEqual([]);
  });

  it('flags an event that is not on-chain', () => {
    expect(mintBlockers(ledger(), 'bb'.repeat(32), NOW)).toEqual(['missing']);
  });

  it('reports nothing for a ledger without the maps', () => {
    expect(mintBlockers({ credentials: {} } as never, EVENT_ID, NOW)).toEqual([]);
    expect(mintBlockers(null, EVENT_ID, NOW)).toEqual([]);
  });
});
