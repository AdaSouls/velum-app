import {
  explorerBlockUrl,
  explorerContractUrl,
  explorerTxUrl,
  explorerTxUrlInText,
} from '../../utils/midnightExplorer';

const HASH = 'ab'.repeat(32);

describe('midnightExplorer', () => {
  const originalNetwork = process.env.REACT_APP_MIDNIGHT_NETWORK_ID;

  afterEach(() => {
    // Assigning undefined to a process.env key would store the string "undefined".
    if (originalNetwork === undefined) delete process.env.REACT_APP_MIDNIGHT_NETWORK_ID;
    else process.env.REACT_APP_MIDNIGHT_NETWORK_ID = originalNetwork;
  });

  it('links to the mainnet explorer on a mainnet build', () => {
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'mainnet';
    expect(explorerTxUrl(HASH)).toBe(`https://www.midnightexplorer.com/transactions/${HASH}`);
    expect(explorerBlockUrl(42)).toBe('https://www.midnightexplorer.com/blocks/42');
    expect(explorerContractUrl(HASH)).toBe(`https://www.midnightexplorer.com/contracts/${HASH}`);
  });

  it('links to the preprod explorer on a preprod build', () => {
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'preprod';
    expect(explorerTxUrl(HASH)).toBe(`https://preprod.midnightexplorer.com/transactions/${HASH}`);
    expect(explorerBlockUrl(42)).toBe('https://preprod.midnightexplorer.com/blocks/42');
    expect(explorerContractUrl(HASH)).toBe(`https://preprod.midnightexplorer.com/contracts/${HASH}`);
  });

  it('gives no link on a local devnet, which has no explorer', () => {
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'undeployed';
    expect(explorerTxUrl(HASH)).toBeUndefined();
    delete process.env.REACT_APP_MIDNIGHT_NETWORK_ID;
    expect(explorerTxUrl(HASH)).toBeUndefined();
  });

  it('gives no link for a missing or placeholder value', () => {
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'mainnet';
    expect(explorerTxUrl('')).toBeUndefined();
    expect(explorerTxUrl('N/A')).toBeUndefined();
    expect(explorerBlockUrl(undefined)).toBeUndefined();
  });

  it('finds the transaction a result message mentions', () => {
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'preprod';
    expect(explorerTxUrlInText(`Transaction: ${HASH}`)).toBe(
      `https://preprod.midnightexplorer.com/transactions/${HASH}`,
    );
    expect(explorerTxUrlInText('Transaction: abc')).toBeUndefined();
    expect(explorerTxUrlInText('')).toBeUndefined();
    expect(explorerTxUrlInText(undefined)).toBeUndefined();
  });
});
