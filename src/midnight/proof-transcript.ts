// Reads WHAT a proof transaction proved straight from the transaction itself (its public
// transcript), so /app/verify doesn't have to trust the receipt for it. Every proof circuit in
// poap.compact starts with `disclosureRequests.member(requestId)` and then looks the request up,
// so the transcript carries, in order:
//   push <requestId> · member · … · idx [<requestId>] · popeq <request record>
// where the record is { verifier, eventId, fieldId, setRoot, recipient } (recipient added with
// addressed requests, AdaSouls/velum f6f6114; a 4-field record is the earlier layout). proveTokenOwnership then checks
// `tokenOwner.member(tokenId)`, a push of the 8-byte token id, the first one after the request.
// These are values the circuit discloses on purpose (poap.compact's disclose()), nothing private.
//
// Values are AlignedValues: each atom's bytes are little-endian with trailing zero bytes dropped
// (an all-zero Bytes<32> is an empty array, token #0 is an empty array).

export type ProofDetails = {
  requestId: string; // hex, 32 bytes
  verifierPk: string; // hex — who published the request
  eventId: string; // hex
  fieldId: string; // hex, all-zero for a plain ownership/attendance request
  setRoot: string; // hex, all-zero for a plain request
  recipientPk: string | null; // hex — the holder it was addressed to (and so who answered); null = open
  tokenId: bigint | null; // only proveTokenOwnership reveals it
};

type Atom = Uint8Array;
type AlignedValue = { value: Atom[]; alignment: { tag: string; value?: { tag: string; length?: number } }[] };

const ZERO_32 = '0'.repeat(64);

function toHex32(bytes: Atom | undefined): string {
  const hex = Buffer.from(bytes ?? new Uint8Array()).toString('hex');
  return hex.padEnd(64, '0');
}

function atomLength(aligned: AlignedValue, index = 0): number | undefined {
  const entry = aligned.alignment?.[index];
  return entry?.tag === 'atom' ? entry.value?.length : undefined;
}

// A push of a single fixed-width atom (the shape a disclosed Bytes<32> / Uint<64> key takes).
function pushedAtom(op: any, length: number): Atom | null {
  const content: AlignedValue | undefined = op?.push?.value?.tag === 'cell' ? op.push.value.content : undefined;
  if (!content || content.value?.length !== 1 || atomLength(content) !== length) return null;
  return content.value[0];
}

function littleEndianToBigInt(bytes: Atom): bigint {
  let n = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << BigInt(8)) | BigInt(bytes[i]);
  return n;
}

export function readProofDetails(program: any[]): ProofDetails | null {
  // 1. The request id: the first 32-byte push that is immediately tested with `member`.
  let requestAt = -1;
  let requestId: Atom | null = null;
  for (let i = 0; i < program.length - 1; i++) {
    const atom = pushedAtom(program[i], 32);
    if (atom && program[i + 1] === 'member') {
      requestAt = i;
      requestId = atom;
      break;
    }
  }
  if (!requestId) return null;
  const requestHex = toHex32(requestId);

  // 2. The request record: the popeq right after an idx keyed by that request id.
  let record: AlignedValue | null = null;
  let recordAt = -1;
  for (let i = requestAt + 2; i < program.length - 1; i++) {
    const path = program[i]?.idx?.path;
    const key = Array.isArray(path) && path.length === 1 ? path[0]?.value?.value?.[0] : undefined;
    if (key && toHex32(key) === requestHex && program[i + 1]?.popeq) {
      record = program[i + 1].popeq.result;
      recordAt = i + 1;
      break;
    }
  }
  const fieldCount = record?.value?.length;
  if (!record || (fieldCount !== 4 && fieldCount !== 5)) return null;
  const [verifier, eventId, fieldId, setRoot, recipient] = record.value;
  const recipientHex = recipient === undefined ? ZERO_32 : toHex32(recipient);

  // 3. The token id (ownership proofs only): the first 8-byte push after the record, tested with member.
  let tokenId: bigint | null = null;
  for (let i = recordAt + 1; i < program.length - 1; i++) {
    const atom = pushedAtom(program[i], 8);
    if (atom && program[i + 1] === 'member') {
      tokenId = littleEndianToBigInt(atom);
      break;
    }
  }

  return {
    requestId: requestHex,
    verifierPk: toHex32(verifier),
    eventId: toHex32(eventId),
    fieldId: toHex32(fieldId),
    setRoot: toHex32(setRoot),
    recipientPk: recipientHex === ZERO_32 ? null : recipientHex,
    tokenId,
  };
}

export const isZeroHex = (hex: string): boolean => hex.toLowerCase() === ZERO_32;

// Decodes the raw transaction (hex, as the Midnight indexer returns it) and reads the proof's
// details from the call to `contractAddress`. null when there's no such call or it can't be read.
export async function decodeProofDetails(rawHex: string, contractAddress: string): Promise<ProofDetails | null> {
  const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
  const tx: any = Transaction.deserialize('signature', 'proof', 'binding', Uint8Array.from(Buffer.from(rawHex, 'hex')));
  for (const [, intent] of tx.intents ?? []) {
    for (const action of intent.actions ?? []) {
      const address = String(action.address ?? '').toLowerCase();
      if (address !== contractAddress.toLowerCase() || !action.guaranteedTranscript) continue;
      const details = readProofDetails(action.guaranteedTranscript.program ?? []);
      if (details) return details;
    }
  }
  return null;
}
