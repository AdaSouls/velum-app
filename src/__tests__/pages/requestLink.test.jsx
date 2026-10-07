import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import RequestLink from '../../jsx/pages/requestLink';
import { mockDrawerContext, renderWithProviders } from '../../testUtils';
import { getEvent } from '../../midnight/indexer.service';
import { fetchMetadata } from '../../jsx/hooks/useEventMetadata';

jest.mock('../../midnight/indexer.service', () => ({
  getEvent: jest.fn(),
}));
jest.mock('../../jsx/hooks/useEventMetadata', () => ({
  fetchMetadata: jest.fn(),
}));
jest.mock('../../jsx/layout/layout', () => ({ children }) => <div>{children}</div>);

const ORG = 'ab'.repeat(32);
const VERIFIER = 'ee'.repeat(32);
const EVENT_ID = 'cd'.repeat(32);
const HOLDER = '11'.repeat(32);
const FIELDS = [{ fieldId: '33'.repeat(32), label: 'Birth date', type: 'date' }];
const EVENT = { eventId: EVENT_ID, issuerPk: ORG, isPublicMint: false, metadataURI: 'ipfs://meta' };

function openAt(hash, address, dispatch = jest.fn()) {
  window.history.pushState({}, '', `/app/request${hash}`);
  renderWithProviders(<RequestLink />, {
    drawerValue: {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: address ? { address } : null },
    },
    drawerDispatch: dispatch,
  });
  return dispatch;
}

describe('RequestLink page', () => {
  beforeEach(() => {
    getEvent.mockResolvedValue(EVENT);
    fetchMetadata.mockResolvedValue({ name: 'Diploma', credentialAttributeFields: FIELDS });
  });

  it('rejects an incomplete link', () => {
    openAt(`#event=${EVENT_ID}`, VERIFIER);
    expect(screen.getByText(/this link isn't complete/i)).toBeInTheDocument();
  });

  it('opens Ask for a Disclosure with the event and the holder filled in, for any wallet', async () => {
    const dispatch = openAt(`#event=${EVENT_ID}&to=${HOLDER}`, VERIFIER);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: 'PUBLISH_DISCLOSURE_REQUEST',
        payload: { eventId: EVENT_ID, fields: FIELDS, recipient: HOLDER, idCodes: {} },
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('asks to connect a wallet first', async () => {
    const dispatch = openAt(`#event=${EVENT_ID}&to=${HOLDER}`, null);
    expect(await screen.findByText(/connect your wallet to ask the holder/i)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('says so when the credential has no private details', async () => {
    fetchMetadata.mockResolvedValue({ name: 'Diploma' });
    const dispatch = openAt(`#event=${EVENT_ID}&to=${HOLDER}`, VERIFIER);
    expect(await screen.findByText(/no private details to ask about/i)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("says so when the event doesn't exist", async () => {
    getEvent.mockResolvedValue(null);
    openAt(`#event=${EVENT_ID}&to=${HOLDER}`, VERIFIER);
    expect(await screen.findByText(/could not find the event/i)).toBeInTheDocument();
  });
});
