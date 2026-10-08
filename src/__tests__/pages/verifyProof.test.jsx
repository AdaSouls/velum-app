import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import VerifyProof from '../../jsx/pages/verifyProof';

// The page is public (no wallet) — only the layout chrome needs stubbing.
jest.mock('../../jsx/layout/layout', () => ({ children }) => <div>{children}</div>);
// The transcript decoder needs the ledger WASM; the indexer/metadata lookups hit the network.
jest.mock('../../midnight/proof-transcript', () => ({
  decodeProofDetails: jest.fn(),
  isZeroHex: (hex) => /^0+$/.test(hex),
}));
jest.mock('../../midnight/indexer.service', () => ({
  getEvent: jest.fn(),
  getToken: jest.fn(),
  getDisclosureRequestsByVerifier: jest.fn(),
}));
jest.mock('../../jsx/hooks/useEventMetadata', () => ({ fetchMetadata: jest.fn() }));

const { decodeProofDetails } = jest.requireMock('../../midnight/proof-transcript');
const { getEvent, getToken, getDisclosureRequestsByVerifier } = jest.requireMock('../../midnight/indexer.service');
const { fetchMetadata } = jest.requireMock('../../jsx/hooks/useEventMetadata');
const ORGANIZER = 'f0'.repeat(32);
const EVENT = '4d'.repeat(32);

const CONTRACT = 'c0'.repeat(32);
const TX = 'ab'.repeat(32);

function graphqlReturns(transactions) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { transactions } }) });
}

function renderAt(tx) {
  return render(
    <MemoryRouter initialEntries={[`/app/verify?tx=${tx}`]}>
      <VerifyProof />
    </MemoryRouter>,
  );
}

describe('VerifyProof page', () => {
  beforeEach(() => {
    decodeProofDetails.mockResolvedValue(null);
  });

  const originalAddress = process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS;
  beforeAll(() => {
    process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS = CONTRACT;
  });
  afterAll(() => {
    process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS = originalAddress;
  });

  it('confirms a proof transaction on the POAP contract', async () => {
    graphqlReturns([
      {
        hash: TX,
        block: { height: 1300, timestamp: 1790256564002 },
        contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveEventAttendance' }],
      },
    ]);
    renderAt(TX);
    expect(await screen.findByText('Anonymous ownership proof')).toBeInTheDocument();
    expect(screen.getByText(/valid proof/i)).toBeInTheDocument();
    expect(screen.getByText('1300')).toBeInTheDocument();
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ hash: TX });
  });

  it('shows the event, token and asker read from the transaction itself', async () => {
    graphqlReturns([
      {
        hash: TX,
        raw: 'deadbeef',
        block: { height: 2008, hash: 'bb'.repeat(32), timestamp: 1790284776000 },
        transactionResult: { status: 'SUCCESS' },
        contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveTokenOwnership' }],
      },
    ]);
    decodeProofDetails.mockResolvedValue({
      requestId: 'a2'.repeat(32),
      verifierPk: ORGANIZER,
      eventId: EVENT,
      fieldId: '0'.repeat(64),
      setRoot: '0'.repeat(64),
      tokenId: 3n,
    });
    getEvent.mockResolvedValue({ eventId: EVENT, issuerPk: ORGANIZER, metadataURI: 'ipfs://meta' });
    fetchMetadata.mockResolvedValue({ name: 'Recital Rosario', organization: { name: 'Productora X' } });
    getToken.mockResolvedValue({ tokenId: 3, isBurned: false });
    renderAt(TX);

    expect(await screen.findByText('Recital Rosario')).toBeInTheDocument();
    expect(screen.getByText('Ownership proof')).toBeInTheDocument();
    expect(screen.getByText('Owns POAP #3 of this event')).toBeInTheDocument();
    expect(screen.getByText(/still held today/i)).toBeInTheDocument();
    expect(screen.getByText("The event's organizer")).toBeInTheDocument();
    expect(screen.getByText('by Productora X')).toBeInTheDocument();
    expect(decodeProofDetails).toHaveBeenCalledWith('deadbeef', CONTRACT);
  });

  it("shows how long a Subscription proof keeps its holder active", async () => {
    const provenAt = Date.parse('2026-09-24T10:00:00Z');
    graphqlReturns([
      {
        hash: TX,
        raw: 'ab',
        block: { height: 50, timestamp: provenAt },
        transactionResult: { status: 'SUCCESS' },
        contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveEventAttendance' }],
      },
    ]);
    decodeProofDetails.mockResolvedValue({ requestId: 'a2'.repeat(32), verifierPk: ORGANIZER, eventId: EVENT, fieldId: '0'.repeat(64), setRoot: '0'.repeat(64), tokenId: null });
    getEvent.mockResolvedValue({ eventId: EVENT, issuerPk: ORGANIZER, metadataURI: 'ipfs://club' });
    fetchMetadata.mockResolvedValue({ name: 'Club', category: 'subscription', validity: { amount: 1, unit: 'years' } });
    renderAt(TX);

    expect(await screen.findByText(/1 year from this proof/)).toBeInTheDocument();
    expect(screen.getByText(/Valid until 24\/09\/2027/)).toBeInTheDocument();
  });

  it('warns when the proven token has been revoked since', async () => {
    graphqlReturns([
      { hash: TX, raw: 'ab', block: { height: 9, timestamp: null }, contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveTokenOwnership' }] },
    ]);
    decodeProofDetails.mockResolvedValue({ requestId: 'a2'.repeat(32), verifierPk: 'ee'.repeat(32), eventId: EVENT, fieldId: '0'.repeat(64), setRoot: '0'.repeat(64), tokenId: 0n });
    getEvent.mockResolvedValue({ eventId: EVENT, issuerPk: ORGANIZER, metadataURI: null });
    getToken.mockResolvedValue({ tokenId: 0, isBurned: true, burnedBlock: 42 });
    renderAt(TX);

    expect(await screen.findByText(/revoked since block 42/i)).toBeInTheDocument();
    expect(screen.getByText(/someone else/i)).toBeInTheDocument();
  });

  it('does not call a failed proof transaction valid', async () => {
    graphqlReturns([
      { hash: TX, block: { height: 9, timestamp: null }, transactionResult: { status: 'FAILURE' }, contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveEventAttendance' }] },
    ]);
    renderAt(TX);
    expect(await screen.findByText(/failed transaction/i)).toBeInTheDocument();
  });

  it('flags a transaction that is not a proof', async () => {
    graphqlReturns([
      { hash: TX, block: { height: 5, timestamp: null }, contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'createEvent' }] },
    ]);
    renderAt(TX);
    expect(await screen.findByText(/not a proof/i)).toBeInTheDocument();
  });

  it('flags a transaction on another contract', async () => {
    graphqlReturns([
      { hash: TX, block: { height: 5, timestamp: null }, contractActions: [{ __typename: 'ContractCall', address: 'ff'.repeat(32), entryPoint: 'proveEventAttendance' }] },
    ]);
    renderAt(TX);
    expect(await screen.findByText(/not a velum poap transaction/i)).toBeInTheDocument();
  });

  describe('identity check with a question', () => {
    const VERIFIER = 'e1'.repeat(32);
    const HOLDER = 'c3'.repeat(32);
    const DNI = '0d'.repeat(32);
    const GRADE = '01'.repeat(32);
    const ID_TX = '1d'.repeat(32);
    const GRADE_TX = '9a'.repeat(32);
    const ID_REQUEST = 'a1'.repeat(32);
    const GRADE_REQUEST = 'a9'.repeat(32);
    const tx = (hash, raw) => ({
      hash,
      raw,
      block: { height: 70, timestamp: 1790284776000 },
      transactionResult: { status: 'SUCCESS' },
      contractActions: [{ __typename: 'ContractCall', address: CONTRACT, entryPoint: 'proveCredentialAttribute' }],
    });
    const details = (requestId, fieldId) => ({
      requestId,
      verifierPk: VERIFIER,
      eventId: EVENT,
      fieldId,
      setRoot: '0'.repeat(64),
      tokenId: null,
      recipientPk: HOLDER,
    });

    beforeEach(() => {
      // One GraphQL lookup per hash on the page.
      global.fetch = jest.fn(async (_url, init) => {
        const { hash } = JSON.parse(init.body).variables;
        const transactions = hash === ID_TX ? [tx(ID_TX, 'id')] : hash === GRADE_TX ? [tx(GRADE_TX, 'grade')] : [];
        return { ok: true, json: async () => ({ data: { transactions } }) };
      });
      decodeProofDetails.mockImplementation(async (raw) =>
        raw === 'id' ? details(ID_REQUEST, DNI) : details(GRADE_REQUEST, GRADE),
      );
      getEvent.mockResolvedValue({ eventId: EVENT, issuerPk: ORGANIZER, metadataURI: 'ipfs://diploma' });
      fetchMetadata.mockResolvedValue({
        name: 'Diploma',
        category: 'credential',
        credentialAttributeFields: [
          { fieldId: GRADE, label: 'Grade', type: 'number' },
          { fieldId: DNI, label: 'DNI', type: 'identity', country: 'ARG', docType: 'national_id' },
        ],
      });
      getDisclosureRequestsByVerifier.mockResolvedValue([
        { requestId: ID_REQUEST, verifierPk: VERIFIER, eventId: EVENT, fieldId: DNI, recipientPk: HOLDER },
        { requestId: GRADE_REQUEST, verifierPk: VERIFIER, eventId: EVENT, fieldId: GRADE, recipientPk: HOLDER },
      ]);
    });

    it('warns that the identity proof is missing when only the answer to the question is shown', async () => {
      renderAt(GRADE_TX);
      expect(await screen.findByText(/identity proof missing/i)).toBeInTheDocument();
      expect(screen.getByText(/not shown: the identity proof isn't on this page/i)).toBeInTheDocument();
      expect(getDisclosureRequestsByVerifier).toHaveBeenCalledWith(VERIFIER);
    });

    it('checks the identity proof and the question together from one link', async () => {
      renderAt(`${ID_TX},${GRADE_TX}`);
      expect(await screen.findByText('All 2 proofs are valid')).toBeInTheDocument();
      expect(screen.getByText(/same holder, including the identity check/i)).toBeInTheDocument();
      expect(await screen.findByText(/confirmed by the identity proof on this page/i)).toBeInTheDocument();
      expect(screen.getByText('DNI (National ID · ARG) matches the document checked')).toBeInTheDocument();
      expect(screen.queryByText(/identity proof missing/i)).not.toBeInTheDocument();
    });

    it('lets the verifier add the missing identity proof from its link', async () => {
      renderAt(GRADE_TX);
      await screen.findByText(/identity proof missing/i);
      await userEvent.type(
        screen.getByLabelText(/identity proof link or transaction hash/i),
        `https://velum.example/app/verify?tx=${ID_TX}`,
      );
      await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
      expect(await screen.findByText('All 2 proofs are valid')).toBeInTheDocument();
      expect(await screen.findByText(/confirmed by the identity proof on this page/i)).toBeInTheDocument();
      expect(screen.queryByText(/identity proof missing/i)).not.toBeInTheDocument();
    });
  });

  it('says when the transaction does not exist', async () => {
    graphqlReturns([]);
    renderAt(TX);
    expect(await screen.findByText(/no transaction with this hash exists/i)).toBeInTheDocument();
  });
});
