import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventsPage from '../../jsx/pages/myEvents';
import { mockDrawerContext, mockUserRoles, renderWithProviders } from '../../testUtils';
import { getAllEvents } from '../../midnight/indexer.service';

jest.mock('../../midnight/indexer.service');

describe('My Events Flow Integration', () => {
  const mockEvents = [
    { eventId: 'aa'.repeat(32), issuerPk: 'bb'.repeat(32), maxSupply: 100, minted: 50, expiration: 0, isActive: true, isPublicMint: true, createdBlock: 1 },
    { eventId: 'cc'.repeat(32), issuerPk: 'dd'.repeat(32), maxSupply: 200, minted: 100, expiration: 0, isActive: true, isPublicMint: true, createdBlock: 2 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    getAllEvents.mockResolvedValue(mockEvents);
  });

  it('loads events from the indexer, displays them, and lets an organizer create a new one', async () => {
    const dispatch = jest.fn();
    const drawerValue = {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: 'bb'.repeat(32) } },
    };

    renderWithProviders(<EventsPage />, {
      drawerValue,
      drawerDispatch: dispatch,
      userRolesValue: { ...mockUserRoles, isIssuer: true },
    });

    await waitFor(() => expect(getAllEvents).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Event aaaaaaaa/i).length).toBeGreaterThan(0));

    const createButton = screen.getByRole('button', { name: /create event/i });
    await userEvent.click(createButton);

    expect(dispatch).toHaveBeenCalledWith({ type: 'CREATE_EVENT' });
  });

  // The badge counts the connected organizer's own events, not everything the indexer returns —
  // My Events is a strict "mine only" list (see myEvents.jsx's ownEvents).
  it('shows the correct event count badge once events load', async () => {
    getAllEvents.mockResolvedValue([
      ...mockEvents,
      { eventId: 'ee'.repeat(32), issuerPk: 'bb'.repeat(32), maxSupply: 10, minted: 0, expiration: 0, isActive: true, isPublicMint: true, createdBlock: 3 },
    ]);
    const drawerValue = {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: 'bb'.repeat(32) } },
    };

    renderWithProviders(<EventsPage />, { drawerValue });

    await waitFor(() => expect(getAllEvents).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/^2 Events$/i)).toBeInTheDocument());
  });

  it('counts no events while no wallet is connected', async () => {
    renderWithProviders(<EventsPage />);

    await waitFor(() => expect(getAllEvents).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByAltText(/loading events/i)).not.toBeInTheDocument());
    expect(screen.getByText(/^0 Events$/i)).toBeInTheDocument();
  });
});
