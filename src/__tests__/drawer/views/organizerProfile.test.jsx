import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrganizerProfile from '../../../jsx/drawer/views/organizerProfile';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import { getOrganizerProfile, saveOrganizerProfile } from '../../../midnight/organizer-profile';

const PK = 'aa'.repeat(32);
const connected = {
  ...mockDrawerContext,
  midnight: { ...mockDrawerContext.midnight, provider: { address: PK, wallet: 'Lace', service: {} } },
};

describe('OrganizerProfile popup', () => {
  beforeEach(() => window.localStorage.clear());

  it('asks to connect a wallet first', () => {
    renderWithProviders(<OrganizerProfile />, {
      drawerValue: { ...mockDrawerContext, midnight: { ...mockDrawerContext.midnight, provider: null } },
    });
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Organizer Name')).not.toBeInTheDocument();
  });

  it('loads the saved profile and saves changes for this identity', async () => {
    saveOrganizerProfile(PK, { name: 'Acme Labs' });
    renderWithProviders(<OrganizerProfile />, { drawerValue: connected });

    expect(screen.getByRole('heading', { name: /organizer profile/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Organizer Name')).toHaveValue('Acme Labs');
    expect(screen.getByText(/shown publicly on events you create/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('City'), 'Rosario');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(getOrganizerProfile(PK)).toEqual({ name: 'Acme Labs', locality: 'Rosario' });
    expect(screen.getByText(/new events will use these details/i)).toBeInTheDocument();
  });

  it('shows the key holders seal update requests to', async () => {
    const service = { getInboxKeyPair: jest.fn().mockResolvedValue({ publicKeyHex: 'ef'.repeat(32) }) };
    renderWithProviders(<OrganizerProfile />, {
      drawerValue: { ...connected, midnight: { ...connected.midnight, provider: { ...connected.midnight.provider, service } } },
    });
    expect(await screen.findByText(/update requests: on/i)).toBeInTheDocument();
    expect(screen.getByTitle('ef'.repeat(32))).toBeInTheDocument();
  });
});
