import { parseProofHashes } from '../../midnight/proof-verification';

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);

describe('parseProofHashes', () => {
  it('reads comma- or space-separated hashes, deduplicated', () => {
    expect(parseProofHashes(`${A}, ${B} ${A}`)).toEqual([A, B]);
  });

  it('reads the hashes out of a pasted verify link, next to other hashes', () => {
    expect(parseProofHashes(`${A},https://velum.example/app/verify?tx=${B}`)).toEqual([A, B]);
    expect(parseProofHashes(`https://velum.example/app/verify?tx=${A}%2C${B}&ref=x`)).toEqual([A, B]);
  });
});
