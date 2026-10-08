import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HolderProofs from '../../../jsx/drawer/views/holderProofs';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import {
  isIdentityCondition,
  listAnswerableRequests,
  proveAttendance,
  proveAttributes,
  valueQualifies,
} from '../../../midnight/holder-proofs';
import { getEvent } from '../../../midnight/indexer.service';
import { addProofRecord, getProofHistory } from '../../../midnight/proof-history';

// holder-proofs pulls in the compiled contract (WASM) — mocked, see merkle.test.ts.
jest.mock('../../../midnight/holder-proofs', () => ({
  isIdentityCondition: jest.fn(),
  listAnswerableRequests: jest.fn(),
  proveAttendance: jest.fn(),
  proveAttributes: jest.fn(),
  setTreeFor: jest.fn(),
  valueQualifies: jest.fn(),
}));
jest.mock('../../../midnight/indexer.service', () => ({
  getEvent: jest.fn(),
}));

const ORGANIZER = 'bb'.repeat(32);
const SECTOR = '01'.repeat(32);
const TOKEN = { tokenId: 4, eventId: 'aa'.repeat(32), issuerPk: ORGANIZER, holderPk: 'cc'.repeat(32) };
const PKG = { fields: [{ fieldId: SECTOR, label: 'Sector', valueHex: '00', randHex: '00' }] };
const request = (id, fieldId = '0'.repeat(64)) => ({ requestId: id, verifierPk: ORGANIZER, eventId: TOKEN.eventId, fieldId });
// A credential request as listAnswerableRequests returns it: one entry per condition.
const condition = (slot, label, rule, fieldId = SECTOR) => ({
  slot,
  fieldId,
  setRoot: '44'.repeat(32),
  field: { fieldId, label },
  label,
  rule,
  verified: true,
});
const credentialItem = (id, conditions) => ({
  kind: 'attribute',
  request: { requestId: id, verifierPk: ORGANIZER, eventId: TOKEN.eventId, recipientPk: TOKEN.holderPk },
  conditions,
});

function renderView(mode = 'ownership') {
  return renderWithProviders(<HolderProofs />, {
    drawerValue: {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: 'ee'.repeat(32), service: {} } },
      holderProofsContext: { mode, token: TOKEN, eventName: 'Recital', credentialFields: [{ fieldId: SECTOR, label: 'Sector' }], pkg: PKG },
    },
  });
}

describe('HolderProofs drawer view', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getEvent.mockResolvedValue({ eventId: TOKEN.eventId, liveTokens: 40 });
    isIdentityCondition.mockImplementation((c) => c.rule?.op === 'identity');
  });

  it('says how many holders the proof hides among', async () => {
    listAnswerableRequests.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText(/anonymous among 40 holders of this event/i)).toBeInTheDocument();
    expect(getEvent).toHaveBeenCalledWith(TOKEN.eventId);
  });

  it('warns, without blocking, when the event has fewer than 5 holders', async () => {
    getEvent.mockResolvedValue({ eventId: TOKEN.eventId, liveTokens: 3 });
    listAnswerableRequests.mockResolvedValue([{ kind: 'attendance', request: request('11'.repeat(32)) }]);
    renderView();
    expect(await screen.findByText(/only 3 holders of this event so far/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^prove$/i })).toBeEnabled();
  });

  it('says it plainly when the holder is the only one', async () => {
    getEvent.mockResolvedValue({ eventId: TOKEN.eventId, liveTokens: 1 });
    listAnswerableRequests.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText(/you're the only holder of this event so far/i)).toBeInTheDocument();
  });

  it('explains when the organizer has not enabled proofs yet', async () => {
    listAnswerableRequests.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText(/hasn't enabled proofs on this event yet/i)).toBeInTheDocument();
  });

  it('shows the holder their key for addressed questions, and lists only those addressed to them', async () => {
    listAnswerableRequests.mockResolvedValue([]);
    renderView('detail');
    expect(await screen.findByText(/nobody has asked you/i)).toBeInTheDocument();
    expect(screen.getByText(TOKEN.holderPk)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy your key/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy the link to ask you/i })).toBeInTheDocument();
    expect(screen.queryByText(/anonymous among/i)).not.toBeInTheDocument();
    expect(listAnswerableRequests).toHaveBeenCalledWith(
      TOKEN.eventId,
      [{ fieldId: SECTOR, label: 'Sector' }],
      TOKEN.holderPk,
      expect.objectContaining({ fields: expect.any(Array) }),
    );
  });

  it('shows only the questions of its own mode', async () => {
    listAnswerableRequests.mockResolvedValue([
      { kind: 'attendance', request: request('11'.repeat(32)) },
      credentialItem('22'.repeat(32), [condition(0, 'Sector', { op: 'oneOf', values: ['Campo'] })]),
    ]);
    valueQualifies.mockReturnValue(true);
    renderView('detail');
    expect(await screen.findByText('Sector is one of: Campo')).toBeInTheDocument();
    expect(screen.queryByText('Holds a valid POAP of this event')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /prove a private detail/i })).toBeInTheDocument();
  });

  it('answers an identity check and its question in one proof, one signature', async () => {
    const item = credentialItem('31'.repeat(32), [
      condition(0, 'DNI', { op: 'identity' }, '0d'.repeat(32)),
      condition(1, 'Sector', { op: 'oneOf', values: ['Campo'] }),
    ]);
    const pkg = { fields: [...PKG.fields, { fieldId: '0d'.repeat(32), label: 'DNI', valueHex: '00', randHex: '00' }] };
    listAnswerableRequests.mockResolvedValue([item]);
    valueQualifies.mockReturnValue(true);
    proveAttributes.mockResolvedValue({ txHash: 'a1'.repeat(32) });
    renderWithProviders(<HolderProofs />, {
      drawerValue: {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: 'ee'.repeat(32), service: {} } },
        holderProofsContext: { mode: 'detail', token: TOKEN, eventName: 'Recital', credentialFields: [], pkg },
      },
    });

    expect(await screen.findByText(/2 answers, one proof/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^respond$/i }));
    await waitFor(() => expect(proveAttributes).toHaveBeenCalledTimes(1));
    expect(proveAttributes).toHaveBeenCalledWith({}, TOKEN, item.request, item.conditions, pkg);
    const link = await screen.findByDisplayValue(/\/app\/verify\?tx=/);
    expect(link.value).toMatch(new RegExp(`/app/verify\\?tx=${'a1'.repeat(32)}$`));
    const [record] = getProofHistory(TOKEN.holderPk, TOKEN.tokenId);
    expect(record).toMatchObject({ kind: 'proveCredentialAttributes', requestId: '31'.repeat(32), txHash: 'a1'.repeat(32) });
  });

  it("blocks the whole request when one condition can't be answered", async () => {
    isIdentityCondition.mockImplementation((c) => c.rule?.op === 'identity');
    listAnswerableRequests.mockResolvedValue([
      credentialItem('31'.repeat(32), [
        { ...condition(0, 'DNI', { op: 'identity' }, SECTOR), verified: false },
        condition(1, 'Sector', { op: 'oneOf', values: ['Campo'] }),
      ]),
    ]);
    valueQualifies.mockReturnValue(true);
    renderView('detail');
    expect(await screen.findByText(/doesn't match the document on your credential/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^respond$/i })).toBeDisabled();
  });

  it('leaves out requests this browser already answered', async () => {
    addProofRecord(TOKEN.holderPk, TOKEN.tokenId, {
      kind: 'proveEventAttendance',
      question: 'Holds a valid POAP of this event',
      txHash: 'ab'.repeat(32),
      provenAt: '2026-10-08T00:00:00.000Z',
      requestId: '11'.repeat(32),
    });
    listAnswerableRequests.mockResolvedValue([{ kind: 'attendance', request: request('11'.repeat(32)) }]);
    renderView();
    expect(await screen.findByText(/answered every request on this poap/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^prove$/i })).not.toBeInTheDocument();
  });

  it('answers an attendance request anonymously and shows the receipt', async () => {
    listAnswerableRequests.mockResolvedValue([{ kind: 'attendance', request: request('11'.repeat(32)) }]);
    proveAttendance.mockResolvedValue({ txHash: 'ab'.repeat(32) });
    renderView();

    await userEvent.click(await screen.findByRole('button', { name: /^prove$/i }));

    await waitFor(() => expect(screen.getByText(/anonymous ownership proof/i)).toBeInTheDocument());
    expect(proveAttendance).toHaveBeenCalledWith({}, TOKEN, '11'.repeat(32), PKG);
    expect(screen.getByText('Holds a valid POAP of this event')).toBeInTheDocument();
    expect(screen.queryByText(/^token$/i)).not.toBeInTheDocument();
  });

  it('answers a question about a private field when the value qualifies', async () => {
    const item = credentialItem('22'.repeat(32), [condition(0, 'Sector', { op: 'oneOf', values: ['Campo', 'Platea'] })]);
    listAnswerableRequests.mockResolvedValue([item]);
    valueQualifies.mockReturnValue(true);
    proveAttributes.mockResolvedValue({ txHash: 'cd'.repeat(32) });
    renderView('detail');

    expect(await screen.findByText('Sector is one of: Campo, Platea')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^prove$/i }));

    await waitFor(() => expect(screen.getByText(/private detail proof/i)).toBeInTheDocument());
    expect(proveAttributes).toHaveBeenCalledWith({}, TOKEN, item.request, item.conditions, PKG);
  });

  it("disables the answer when the holder's value isn't accepted", async () => {
    listAnswerableRequests.mockResolvedValue([
      credentialItem('22'.repeat(32), [condition(0, 'Sector', { op: 'oneOf', values: ['Platea'] })]),
    ]);
    valueQualifies.mockReturnValue(false);
    renderView('detail');

    expect(await screen.findByText(/your sector isn't one of the accepted values/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^prove$/i })).toBeDisabled();
  });

  it('shows a range question in words', async () => {
    listAnswerableRequests.mockResolvedValue([
      credentialItem('33'.repeat(32), [condition(0, 'Age', { op: 'gte', type: 'number', min: 18, max: 150 })]),
    ]);
    valueQualifies.mockReturnValue(true);
    renderView('detail');
    expect(await screen.findByText('Age ≥ 18')).toBeInTheDocument();
  });
});
