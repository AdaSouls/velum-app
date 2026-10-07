import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RequestCredentialUpdate from '../../../jsx/drawer/views/requestCredentialUpdate';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import { submitUpdateRequest } from '../../../midnight/credential-update';

jest.mock('../../../midnight/credential-update', () => {
  const actual = jest.requireActual('../../../midnight/credential-update');
  return { ...actual, submitUpdateRequest: jest.fn() };
});

const DNI = '0d'.repeat(32);
const PKG = {
  version: 1,
  eventId: 'aa'.repeat(32),
  issuerPk: 'bb'.repeat(32),
  holderPk: 'cc'.repeat(32),
  credAttrRoot: 'dd'.repeat(32),
  fields: [
    {
      fieldId: DNI,
      label: 'DNI',
      valueHex: '77'.repeat(32),
      randHex: '12'.repeat(32),
      identity: { country: 'ARG', docType: 'national_id', number: '12345678', saltHex: 'ab'.repeat(32) },
    },
  ],
};
const CTX = {
  token: { tokenId: 5, eventId: PKG.eventId, issuerPk: PKG.issuerPk, holderPk: PKG.holderPk },
  pkg: PKG,
  updateRequestKey: 'ef'.repeat(32),
  eventName: 'Diploma 2026',
  organizerName: 'UTN',
  pending: false,
};

const render = (ctx = CTX, dispatch = jest.fn()) =>
  renderWithProviders(<RequestCredentialUpdate />, {
    drawerValue: {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: 'aa'.repeat(32), wallet: 'Lace', service: {} } },
      requestUpdateContext: ctx,
    },
    drawerDispatch: dispatch,
  });

describe('RequestCredentialUpdate popup', () => {
  it('shows the current document masked and only accepts a different number', async () => {
    render();
    expect(screen.getByText(/National ID · ARG · ••••5678/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: /send request/i });
    expect(send).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/new number/i), '12.345.678');
    expect(screen.getByText(/already has/i)).toBeInTheDocument();
    expect(send).toBeDisabled();
  });

  it('sends the change encrypted and closes', async () => {
    submitUpdateRequest.mockResolvedValue({ txHash: '0x1', payloadCommit: '99'.repeat(32) });
    const dispatch = jest.fn();
    render(CTX, dispatch);

    await userEvent.type(screen.getByLabelText(/new number/i), '40111222');
    await userEvent.type(screen.getByLabelText(/reason/i), 'New DNI');
    await userEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(submitUpdateRequest).toHaveBeenCalled());
    expect(submitUpdateRequest.mock.calls[0][1]).toMatchObject({
      token: CTX.token,
      changes: [{ fieldId: DNI, number: '40111222' }],
      reason: 'New DNI',
      updateRequestKey: CTX.updateRequestKey,
    });
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'CLOSE_DRAWER' }));
  });

  it('says a new request replaces a pending one', () => {
    render({ ...CTX, pending: true });
    expect(screen.getByText(/sending this one replaces it/i)).toBeInTheDocument();
  });
});
