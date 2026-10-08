import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewCredentialUpdate from '../../../jsx/drawer/views/reviewCredentialUpdate';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import { fetchUpdateRequest } from '../../../midnight/credential-update';
import {
  buildCredentialAttributes,
  credentialPathOnChain,
  deliverCredentialPackage,
} from '../../../midnight/credential-delivery';
import { getReissueRecord, saveReissueRecord } from '../../../midnight/reissue-store';

jest.mock('../../../midnight/credential-update', () => {
  const actual = jest.requireActual('../../../midnight/credential-update');
  return { ...actual, fetchUpdateRequest: jest.fn() };
});
// credential-delivery pulls in the compiled contract (WASM) — mocked, see merkle.test.ts.
jest.mock('../../../midnight/credential-delivery', () => ({
  buildCredentialAttributes: jest.fn(),
  credentialPathOnChain: jest.fn(),
  deliverCredentialPackage: jest.fn(),
  packageToLinkFragment: jest.fn(() => 'frag'),
}));

const EVENT = { eventId: 'aa'.repeat(32), issuerPk: 'bb'.repeat(32) };
const HOLDER = 'cc'.repeat(32);
const DNI = '0d'.repeat(32);
const GRADE = '01'.repeat(32);
const gradeHex = Buffer.concat([Buffer.from('9'), Buffer.alloc(31)]).toString('hex');
const PAYLOAD = {
  kind: 'velum-credential-update',
  version: 1,
  tokenId: 5,
  eventId: EVENT.eventId,
  issuerPk: EVENT.issuerPk,
  holderPk: HOLDER,
  currentPackage: {
    version: 1,
    eventId: EVENT.eventId,
    issuerPk: EVENT.issuerPk,
    holderPk: HOLDER,
    credAttrRoot: 'dd'.repeat(32),
    fields: [
      { fieldId: GRADE, label: 'Grade', valueHex: gradeHex, randHex: '11'.repeat(32) },
      {
        fieldId: DNI,
        label: 'DNI',
        valueHex: '77'.repeat(32),
        randHex: '12'.repeat(32),
        identity: { country: 'ARG', docType: 'national_id', number: '12345678', saltHex: 'ab'.repeat(32) },
      },
    ],
  },
  changes: [{ fieldId: DNI, number: '40111222' }],
  reason: 'New DNI',
  holderEncryptionKey: 'ee'.repeat(32),
  createdAt: '2026-10-07T00:00:00.000Z',
};
const TEMPLATE = [
  { fieldId: GRADE, label: 'Grade', type: 'number' },
  { fieldId: DNI, label: 'DNI', type: 'identity', country: 'ARG', docType: 'national_id' },
];
const TOKEN = { tokenId: 5, ownerPk: HOLDER, tokenMetadataURI: 'ipfs://token-meta', isBurned: false };
const CTX = {
  event: EVENT,
  token: TOKEN,
  eventName: 'Diploma',
  credentialFields: TEMPLATE,
  request: { tokenId: 5, payloadCommit: '99'.repeat(32), status: 'pending' },
};

const serviceMock = () => ({
  getInboxKeyPair: jest.fn().mockResolvedValue({ publicKeyHex: 'ef'.repeat(32) }),
  getState: jest.fn().mockResolvedValue({ ledger: { credentials: {} } }),
  dismissCredentialUpdate: jest.fn().mockResolvedValue({ public: { txHash: '0xd' } }),
  burn: jest.fn().mockResolvedValue({ public: { txHash: '0xb' } }),
  mintTo: jest.fn().mockResolvedValue({ public: { txHash: '0xm' } }),
});

// A ledger whose event is expired, for the "can't re-issue" checks (mint-readiness.ts).
const expiredLedger = () => ({
  credentials: {},
  isPaused: false,
  events: {
    member: () => true,
    lookup: () => ({ maxSupply: 0n, minted: 3n, expiration: 1000n, organizer: new Uint8Array(32), isActive: true }),
  },
  issuers: { member: () => false },
});

const render = (service, ctx = CTX, dispatch = jest.fn()) =>
  renderWithProviders(<ReviewCredentialUpdate />, {
    drawerValue: {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: EVENT.issuerPk, wallet: 'Lace', service } },
      reviewUpdateContext: ctx,
    },
    drawerDispatch: dispatch,
  });

describe('ReviewCredentialUpdate wizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchUpdateRequest.mockResolvedValue(PAYLOAD);
    credentialPathOnChain.mockResolvedValue({ path: true });
    buildCredentialAttributes.mockResolvedValue({ fields: [{ fieldId: DNI }], root: new Uint8Array(32).fill(3) });
    deliverCredentialPackage.mockResolvedValue(undefined);
  });

  it('opens the request with the inbox key and shows the old and new document', async () => {
    const service = serviceMock();
    render(service);
    expect(await screen.findByText('40111222')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    expect(screen.getByText('New DNI')).toBeInTheDocument();
    expect(await screen.findByText(/match this credential on-chain/i)).toBeInTheDocument();
    expect(fetchUpdateRequest).toHaveBeenCalledWith('99'.repeat(32), { publicKeyHex: 'ef'.repeat(32) });
  });

  it("won't re-issue from details that don't match the chain", async () => {
    credentialPathOnChain.mockResolvedValue(null);
    render(serviceMock());
    expect(await screen.findByText(/don't match this credential on-chain/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-issue/i })).toBeDisabled();
  });

  it('dismisses the request', async () => {
    const service = serviceMock();
    const dispatch = jest.fn();
    render(service, CTX, dispatch);
    await screen.findByText('40111222');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(service.dismissCredentialUpdate).toHaveBeenCalledWith(5n));
    expect(dispatch).toHaveBeenCalledWith({ type: 'CLOSE_DRAWER' });
  });

  it('re-issues in steps: revoke (saving a record first), then mint the updated credential to the same holder', async () => {
    const service = serviceMock();
    render(service);
    await screen.findByText(/match this credential on-chain/i);
    await userEvent.click(screen.getByRole('button', { name: /re-issue/i }));
    await userEvent.click(screen.getByRole('button', { name: /revoke and continue/i }));

    await waitFor(() => expect(service.burn).toHaveBeenCalledWith(5n));
    expect(getReissueRecord(EVENT.eventId, 5)).toMatchObject({
      stage: 'burned',
      holderPk: HOLDER,
      tokenMetadataURI: 'ipfs://token-meta',
      values: { [GRADE]: '9', [DNI]: '40111222' },
    });

    await userEvent.click(await screen.findByRole('button', { name: /issue updated credential/i }));
    await waitFor(() => expect(service.mintTo).toHaveBeenCalled());
    expect(buildCredentialAttributes).toHaveBeenCalledWith(TEMPLATE, { [GRADE]: '9', [DNI]: '40111222' });
    const [eventId, holder, uri, commit, root] = service.mintTo.mock.calls[0];
    expect(Buffer.from(eventId).toString('hex')).toBe(EVENT.eventId);
    expect(Buffer.from(holder).toString('hex')).toBe(HOLDER);
    expect(uri).toBe('ipfs://token-meta');
    expect(commit).toEqual(new Uint8Array(32));
    expect(root).toEqual(new Uint8Array(32).fill(3));
    await waitFor(() =>
      expect(deliverCredentialPackage).toHaveBeenCalledWith(expect.objectContaining({ holderPk: HOLDER }), 'ee'.repeat(32)),
    );
    expect(getReissueRecord(EVENT.eventId, 5)).toBeNull();
  });

  it('resumes at the last step from a saved record', async () => {
    const record = {
      stage: 'burned',
      tokenId: 5,
      eventId: EVENT.eventId,
      issuerPk: EVENT.issuerPk,
      holderPk: HOLDER,
      holderEncryptionKey: 'ee'.repeat(32),
      tokenMetadataURI: 'ipfs://token-meta',
      values: { [DNI]: '40111222' },
      payloadCommit: '99'.repeat(32),
      savedAt: '2026-10-07T00:00:00.000Z',
    };
    saveReissueRecord(record);
    const service = serviceMock();
    render(service, { ...CTX, request: undefined, token: { ...TOKEN, isBurned: true }, resume: record });

    expect(screen.getByRole('heading', { name: /finish re-issue/i })).toBeInTheDocument();
    expect(fetchUpdateRequest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /issue updated credential/i }));
    await waitFor(() => expect(service.mintTo).toHaveBeenCalled());
    await waitFor(() => expect(getReissueRecord(EVENT.eventId, 5)).toBeNull());
  });

  it("won't revoke when the event can no longer take a new credential", async () => {
    const service = serviceMock();
    service.getState.mockResolvedValue({ ledger: expiredLedger() });
    render(service);
    expect(await screen.findByText(/this event has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-issue/i })).toBeDisabled();
    expect(service.burn).not.toHaveBeenCalled();
  });

  it('checks again right before revoking and stops if the event expired meanwhile', async () => {
    const service = serviceMock();
    render(service);
    await screen.findByText(/match this credential on-chain/i);
    await userEvent.click(screen.getByRole('button', { name: /re-issue/i }));
    service.getState.mockResolvedValue({ ledger: expiredLedger() });
    await userEvent.click(screen.getByRole('button', { name: /revoke and continue/i }));

    expect(await screen.findByText(/this event has expired/i)).toBeInTheDocument();
    expect(service.burn).not.toHaveBeenCalled();
    expect(getReissueRecord(EVENT.eventId, 5)).toBeNull();
  });
});
