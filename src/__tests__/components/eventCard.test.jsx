import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventCard from '../../jsx/components/eventCard';
import { mockDrawerContext, mockUserRoles, renderWithProviders } from '../../testUtils';
import { getAllDisclosureRequests, getEvent, getTokensByEvent, getTokensByOwner } from '../../midnight/indexer.service';

jest.mock('../../midnight/indexer.service');

describe('EventCard Component', () => {
  const mockEvent = {
    eventId: 'aa'.repeat(32),
    issuerPk: 'bb'.repeat(32),
    maxSupply: 100,
    minted: 50,
    expiration: Math.floor(Date.now() / 1000) + 86400, // tomorrow
    isActive: true,
    isPublicMint: true,
    createdBlock: 42,
  };

  // Push-minting (mintTo) is only offered for the organizer's own private (organizer-minted)
  // events — public events are meant to be self-claimed via claimOrUpdate/"Subscribe" instead, see
  // eventCard.jsx's canMintForEvent comment. Used by every test that expects the Mint POAP button
  // to actually show.
  const privateMockEvent = { ...mockEvent, isPublicMint: false };

  beforeEach(() => {
    jest.clearAllMocks();
    getEvent.mockResolvedValue({ ...mockEvent, liveTokens: 7 });
    getTokensByEvent.mockResolvedValue([]);
    getTokensByOwner.mockResolvedValue([]);
    getAllDisclosureRequests.mockResolvedValue([]);
  });

  it('renders a truncated event id', () => {
    renderWithProviders(<EventCard event={mockEvent} />);
    expect(screen.getByText(/Event aaaaaaaa/i)).toBeInTheDocument();
  });

  it('shows the active status badge', () => {
    renderWithProviders(<EventCard event={mockEvent} />);
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
  });

  it('does not show block info in the collapsed tile (only in expanded details)', () => {
    renderWithProviders(<EventCard event={mockEvent} />);
    expect(screen.queryByText(/Block:/i)).not.toBeInTheDocument();
  });

  it('does not show the description in the collapsed tile (only in expanded details)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', description: 'A great event' }),
    });
    // Distinct URI from other tests in this file — useEventMetadata caches by URI at module scope,
    // reusing one would leak this test's (imageless) response into another test's assertions.
    const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-description-only.json' };

    renderWithProviders(<EventCard event={eventWithMetadata} />);

    await screen.findByText('DevCon 2026');
    expect(screen.queryByText('A great event')).not.toBeInTheDocument();
  });

  it('shows the fetched description in the expanded details', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', description: 'A great event' }),
    });
    const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-description-expanded.json' };

    renderWithProviders(<EventCard event={eventWithMetadata} isExpanded />);

    expect(await screen.findByText('A great event')).toBeInTheDocument();
  });

  it('calls onExpand when card is clicked', async () => {
    const onExpand = jest.fn();
    renderWithProviders(<EventCard event={mockEvent} onExpand={onExpand} />);

    const card = screen.getByText(/Event aaaaaaaa/i).closest('.card');
    await userEvent.click(card);

    // Text fades out first (TEXT_FADE_MS), THEN onExpand fires — see eventCard.jsx's handleExpand.
    await waitFor(() => expect(onExpand).toHaveBeenCalled());
  });

  it('displays mint progress, beside the image and in the phone row below it (CSS shows one)', () => {
    const { container } = renderWithProviders(<EventCard event={mockEvent} />);
    expect(screen.getAllByText(/Minted:/i)).toHaveLength(2);
    expect(screen.getAllByText(/50\/100/i)).toHaveLength(2);
    expect(container.querySelector('.card-event-footer-row-inline')).not.toBeNull();
    expect(container.querySelector('.card-event-footer-row-below')).not.toBeNull();
  });

  it('shows expired status for expired events', () => {
    const expiredEvent = { ...mockEvent, expiration: Math.floor(Date.now() / 1000) - 86400 };
    renderWithProviders(<EventCard event={expiredEvent} />);
    expect(screen.getAllByText(/expired/i).length).toBeGreaterThan(0);
  });

  it('shows full status when max supply is reached', () => {
    const fullEvent = { ...mockEvent, minted: 100 };
    renderWithProviders(<EventCard event={fullEvent} />);
    expect(screen.getAllByText(/full/i).length).toBeGreaterThan(0);
  });

  it('shows inactive status when the event is deactivated', () => {
    const inactiveEvent = { ...mockEvent, isActive: false };
    renderWithProviders(<EventCard event={inactiveEvent} />);
    expect(screen.getAllByText(/inactive/i).length).toBeGreaterThan(0);
  });

  it('never shows an action button in the collapsed tile, regardless of ownership or variant — actions live only in the expanded card', () => {
    const drawerValue = {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: privateMockEvent.issuerPk } },
    };
    renderWithProviders(<EventCard event={privateMockEvent} />, {
      drawerValue,
      userRolesValue: { ...mockUserRoles, isIssuer: false },
    });

    expect(screen.queryByRole('button', { name: /mint poap/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view poaps/i })).not.toBeInTheDocument();
  });

  // isExpanded resizes this same card instance in place (see eventCard.jsx's own top-of-file
  // comment) — no separate floating overlay, no ghost placeholder left behind in the grid.
  describe('expanded card', () => {
    it('dispatches SHOW_BLOCKCHAIN_INFO with the full (untruncated) event id and issuer when View Info is clicked', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, { drawerDispatch: dispatch });

      await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_BLOCKCHAIN_INFO',
        payload: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ key: 'eventId', value: mockEvent.eventId }),
            expect.objectContaining({ key: 'organizer', value: mockEvent.issuerPk }),
          ]),
        }),
      });
    });

    it('links Block, Tx and Contract Address to midnightexplorer.com', async () => {
      const dispatch = jest.fn();
      const event = { ...mockEvent, createdTx: 'dd'.repeat(32) };
      renderWithProviders(<EventCard event={event} isExpanded />, { drawerDispatch: dispatch });

      await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));

      const { fields } = dispatch.mock.calls.find(([a]) => a.type === 'SHOW_BLOCKCHAIN_INFO')[0].payload;
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
      expect(byKey.block.href).toBe('https://www.midnightexplorer.com/blocks/42');
      expect(byKey.tx.href).toBe(`https://www.midnightexplorer.com/transactions/${'dd'.repeat(32)}`);
      expect(byKey.contractAddress.href).toBe(
        `https://www.midnightexplorer.com/contracts/${process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS}`,
      );
      expect(byKey.eventId.href).toBeUndefined();
    });

    // The organizer-key copy badge (hint + copy button) is only for the organizer of a Credential —
    // the one case where the key has to be handed to the recipient (push-mint via mintTo).
    describe('organizer key badge', () => {
      const openInfo = async (event, variant, waitForName) => {
        const dispatch = jest.fn();
        renderWithProviders(<EventCard event={event} variant={variant} isExpanded />, { drawerDispatch: dispatch });
        if (waitForName) await screen.findAllByText(waitForName);
        await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));
        const { fields } = dispatch.mock.calls.find(([a]) => a.type === 'SHOW_BLOCKCHAIN_INFO')[0].payload;
        return fields.find((f) => f.key === 'organizer');
      };

      it('is shown to the organizer of a credential event', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({ name: 'Diploma', category: 'credential' }),
        });
        const event = { ...privateMockEvent, metadataURI: 'https://example.com/meta-credential-key-manage.json' };
        const organizer = await openInfo(event, 'manage', 'Diploma');
        expect(organizer).toEqual(expect.objectContaining({ copyable: true, hint: expect.any(String) }));
      });

      it('is not shown to the organizer of a non-credential event', async () => {
        const organizer = await openInfo(mockEvent, 'manage');
        expect(organizer.copyable).toBeFalsy();
        expect(organizer.hint).toBeUndefined();
      });

      it('is never shown to a subscriber, even for a credential event', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({ name: 'Diploma', category: 'credential' }),
        });
        const event = { ...mockEvent, metadataURI: 'https://example.com/meta-credential-key-explore.json' };
        const organizer = await openInfo(event, 'explore', 'Diploma');
        expect(organizer.copyable).toBeFalsy();
        expect(organizer.hint).toBeUndefined();
      });
    });

    it('does not show an Ask for a Disclosure button when the event has no private credential fields', async () => {
      renderWithProviders(<EventCard event={mockEvent} isExpanded />);
      expect(screen.queryByRole('button', { name: /ask for a disclosure/i })).not.toBeInTheDocument();
    });

    it('shows an Ask for a Disclosure button and dispatches PUBLISH_DISCLOSURE_REQUEST with the event id and field list when clicked', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'DevCon 2026',
          credentialAttributeFields: [{ fieldId: 'cc'.repeat(32), label: 'Sector' }],
        }),
      });
      const dispatch = jest.fn();
      const eventWithAttributes = { ...mockEvent, metadataURI: 'https://example.com/meta-with-attributes.json' };
      renderWithProviders(<EventCard event={eventWithAttributes} isExpanded />, { drawerDispatch: dispatch });

      const askButton = await screen.findByRole('button', { name: /ask for a disclosure/i });
      await userEvent.click(askButton);

      expect(dispatch).toHaveBeenCalledWith({
        type: 'PUBLISH_DISCLOSURE_REQUEST',
        payload: {
          eventId: eventWithAttributes.eventId,
          fields: [{ fieldId: 'cc'.repeat(32), label: 'Sector' }],
        },
      });
    });

    it('fetches and shows the live token count for this event', async () => {
      renderWithProviders(<EventCard event={mockEvent} isExpanded />);

      expect(getEvent).toHaveBeenCalledWith(mockEvent.eventId);
      expect(await screen.findByText(/7 minted/i)).toBeInTheDocument();
    });

    it('does not show a View Subscribers button when no tokens have been minted for this event', async () => {
      renderWithProviders(<EventCard event={mockEvent} isExpanded />);
      await waitFor(() => expect(getTokensByEvent).toHaveBeenCalledWith(mockEvent.eventId));
      expect(await screen.findByText(/7 minted/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /view subscribers/i })).not.toBeInTheDocument();
    });

    it('shows a "View Subscribers (N)" button once tokens have been minted, and dispatches SHOW_SUBSCRIBERS with the event + token list on click', async () => {
      const dispatch = jest.fn();
      const tokens = [
        { tokenId: 1, ownerPk: 'cc'.repeat(32), isBurned: false },
        { tokenId: 2, ownerPk: 'dd'.repeat(32), isBurned: true },
      ];
      getTokensByEvent.mockResolvedValue(tokens);
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, { drawerDispatch: dispatch });

      const button = await screen.findByRole('button', { name: /view subscribers \(2\)/i });
      await userEvent.click(button);

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_SUBSCRIBERS',
        payload: { event: mockEvent, tokens, label: 'Subscribers', eventName: null, credentialFields: [] },
      });
    });

    it('calls onCollapse when the close button is clicked', async () => {
      const onCollapse = jest.fn();
      renderWithProviders(<EventCard event={mockEvent} isExpanded onCollapse={onCollapse} />);

      await userEvent.click(screen.getByRole('button', { name: /collapse event details/i }));

      // Text fades out first (TEXT_FADE_MS), THEN onCollapse fires — see handleCollapse.
      await waitFor(() => expect(onCollapse).toHaveBeenCalled());
    });

    it('does not show a Mint POAP button for a regular attendee', () => {
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, {
        userRolesValue: { ...mockUserRoles, isAdmin: false, isIssuer: false },
      });
      expect(screen.queryByRole('button', { name: /mint poap/i })).not.toBeInTheDocument();
    });

    it('shows a Mint POAP button for the admin on a private event', () => {
      renderWithProviders(<EventCard event={privateMockEvent} isExpanded />, {
        userRolesValue: { ...mockUserRoles, isAdmin: true },
      });
      expect(screen.getByRole('button', { name: /mint poap/i })).toBeInTheDocument();
    });

    it('shows a Mint POAP button for the owner of this private event, even without the verified-issuer badge', () => {
      // Event creation is permissionless — a caller can own an event (issuerPk match) without
      // being separately admin-registered via registerIssuer(), so isIssuer must NOT be required
      // here. Regression test for the bug where an event owner without the badge couldn't mint.
      const drawerValue = {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: privateMockEvent.issuerPk } },
      };
      renderWithProviders(<EventCard event={privateMockEvent} isExpanded />, {
        drawerValue,
        userRolesValue: { ...mockUserRoles, isIssuer: false },
      });
      expect(screen.getByRole('button', { name: /mint poap/i })).toBeInTheDocument();
    });

    it('gives the owner an Invite Link that opens the link popup with this event in it', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<EventCard event={privateMockEvent} isExpanded />, {
        drawerValue: {
          ...mockDrawerContext,
          midnight: { ...mockDrawerContext.midnight, provider: { address: privateMockEvent.issuerPk } },
        },
        drawerDispatch: dispatch,
      });

      await userEvent.click(screen.getByRole('button', { name: /invite link/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_LINK_QR',
        payload: expect.objectContaining({
          title: 'Invite Link',
          url: `${window.location.origin}/app/key#organizer=${privateMockEvent.issuerPk}&event=${privateMockEvent.eventId}`,
        }),
      });
    });

    it('does not show a Mint POAP button for a non-owner, even with the verified-issuer badge', () => {
      const otherEvent = { ...privateMockEvent, issuerPk: 'cc'.repeat(32) };
      const drawerValue = {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: privateMockEvent.issuerPk } },
      };
      renderWithProviders(<EventCard event={otherEvent} isExpanded />, {
        drawerValue,
        userRolesValue: { ...mockUserRoles, isIssuer: true },
      });
      expect(screen.queryByRole('button', { name: /mint poap/i })).not.toBeInTheDocument();
    });

    it('does not show a Mint POAP button for the owner\'s own PUBLIC event, even as admin', () => {
      // Public events are meant to be self-claimed via "Subscribe" — the contract's mintTo doesn't
      // itself forbid push-minting into one, but the UI shouldn't offer a way to bypass that flow.
      const drawerValue = {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: mockEvent.issuerPk } },
      };
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, {
        drawerValue,
        userRolesValue: { ...mockUserRoles, isAdmin: true },
      });
      expect(screen.queryByRole('button', { name: /mint poap/i })).not.toBeInTheDocument();
    });

    it('dispatches CREATE_MINT with the event when Mint POAP is clicked', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<EventCard event={privateMockEvent} isExpanded />, {
        drawerDispatch: dispatch,
        userRolesValue: { ...mockUserRoles, isAdmin: true },
      });

      await userEvent.click(screen.getByRole('button', { name: /mint poap/i }));

      expect(dispatch).toHaveBeenCalledWith({ type: 'CREATE_MINT', payload: privateMockEvent });
    });
  });

  describe('metadataURI display', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('does not fetch and shows the hex fallback when the event has no metadataURI', () => {
      global.fetch = jest.fn();
      renderWithProviders(<EventCard event={mockEvent} />);
      expect(screen.getByText(/Event aaaaaaaa/i)).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('shows the fetched name and image once metadataURI resolves', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', image: 'https://example.com/img.png' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-with-image.json' };

      const { container } = renderWithProviders(<EventCard event={eventWithMetadata} />);

      expect(await screen.findByText('DevCon 2026')).toBeInTheDocument();
      expect(screen.queryByText(/Event aaaaaaaa/i)).not.toBeInTheDocument();
      const img = container.querySelector('.card-media-thumb-photo');
      expect(img).toHaveAttribute('src', 'https://example.com/img.png');
      expect(container.querySelector('.card-media-thumb-broken-icon')).not.toBeInTheDocument();
    });

    it('shows a loading skeleton (never a stale/placeholder image, never the broken-image icon) while metadata is still loading', () => {
      global.fetch = jest.fn(() => new Promise(() => {})); // never resolves
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-still-loading.json' };

      const { container } = renderWithProviders(<EventCard event={eventWithMetadata} />);

      expect(container.querySelector('.skeleton-block')).toBeInTheDocument();
      expect(container.querySelector('.card-media-thumb-broken-icon')).not.toBeInTheDocument();
      expect(container.querySelector('.card-media-thumb-photo')).not.toBeInTheDocument();
    });

    it('shows the broken-image icon when the event has no metadataURI at all', () => {
      const { container } = renderWithProviders(<EventCard event={mockEvent} />);
      expect(container.querySelector('.card-media-thumb-broken-icon')).toBeInTheDocument();
    });

    it('falls back to the broken-image icon if the resolved image URL fails to load', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', image: 'https://example.com/broken.png' }),
      });
      // Distinct URI — useEventMetadata caches by URI at module scope, reusing another test's URI
      // in the same file risks a stale cache hit instead of this test's own fetch mock resolving.
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-broken-image.json' };

      const { container } = renderWithProviders(<EventCard event={eventWithMetadata} />);

      await screen.findByText('DevCon 2026');
      const img = container.querySelector('.card-media-thumb-photo');
      fireEvent.error(img);

      // Scoped to this render's own container (not global `document`) and a generous timeout —
      // this test was flaking under CPU contention when the full suite runs in parallel workers.
      await waitFor(
        () => {
          expect(container.querySelector('.card-media-thumb-broken-icon')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('variant="explore"', () => {
    it('does not show a Subscribe button in the collapsed tile — only in the expanded card', () => {
      renderWithProviders(<EventCard event={mockEvent} variant="explore" />);
      expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /view poaps/i })).not.toBeInTheDocument();
    });

    it('calls onClaim with the event when the expanded card\'s Subscribe button is clicked', async () => {
      const onClaim = jest.fn();
      renderWithProviders(<EventCard event={mockEvent} isExpanded variant="explore" onClaim={onClaim} />);

      await userEvent.click(screen.getByRole('button', { name: /subscribe/i }));

      expect(onClaim).toHaveBeenCalledWith(mockEvent);
    });

    it('never shows Mint to Recipient, even for the event\'s own issuer', () => {
      const drawerValue = {
        ...mockDrawerContext,
        midnight: {
          ...mockDrawerContext.midnight,
          provider: {
            address: mockEvent.issuerPk,
            service: { getHolderPkHex: jest.fn().mockResolvedValue('ab'.repeat(32)) },
          },
        },
      };
      renderWithProviders(<EventCard event={mockEvent} isExpanded variant="explore" />, {
        drawerValue,
        userRolesValue: { ...mockUserRoles, isAdmin: true, isIssuer: true },
      });
      expect(screen.queryByRole('button', { name: /mint poap/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
    });
  });

  describe('category badge & channels/organization (event-creation wizard fields)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('shows a category badge in the collapsed tile when metadata.category is present', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', category: 'event' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-category.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} />);

      // Beside the image and in the phone row below it (CSS shows one).
      expect(await screen.findAllByText('Event')).toHaveLength(2);
    });

    it('does not render a category badge for legacy events without metadata.category', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-no-category.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} />);

      await screen.findByText('DevCon 2026');
      expect(screen.queryByText('Event')).not.toBeInTheDocument();
      expect(screen.queryByText('Subscription')).not.toBeInTheDocument();
      expect(screen.queryByText('Credential')).not.toBeInTheDocument();
    });

    it('shows the category badge in the expanded card too', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', category: 'credential' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-category-expanded.json' };

      const { container } = renderWithProviders(<EventCard event={eventWithMetadata} isExpanded />);

      // Once in the desktop header row and once in the phone-only badge row (CSS shows one).
      expect(await screen.findAllByText('Credential')).toHaveLength(2);
      const phoneRow = container.querySelector('.card-mobile-badge-row');
      expect(phoneRow).toHaveTextContent('Credential');
      expect(phoneRow.querySelector('.card-mobile-status-badge')).toHaveTextContent('Active');
    });

    it('shows channels and organization address in the expanded card when present', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'DevCon 2026',
          channels: [{ type: 'email', value: 'hello@example.com' }],
          organization: { addressLine: 'Av. Siempre Viva 742', locality: 'Springfield', country: 'AR' },
        }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-channels.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} isExpanded />);

      expect(await screen.findByText('hello@example.com')).toBeInTheDocument();
      expect(screen.getByText(/Av\. Siempre Viva 742/)).toBeInTheDocument();
    });

    it('shows neither block for legacy events without channels/organization', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-no-channels.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} isExpanded />);

      // The organizer's own view also shows the subscriber-preview card, which repeats the event
      // name as its own title — see PoapPreviewCard in eventCard.jsx.
      await waitFor(() => expect(screen.getAllByText('DevCon 2026').length).toBeGreaterThan(0));
      expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    });

    it('shows the organizer\'s display name instead of the raw key when metadata.organization.name is set', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', organization: { name: 'AdaSouls Inc.' } }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-org-name.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} />);

      expect(await screen.findByText('AdaSouls Inc.')).toBeInTheDocument();
      expect(screen.queryByText(/bbbbbbbb…bbbbbb/)).not.toBeInTheDocument();
    });

    it('falls back to the truncated key when no organizer name is set', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026' }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-no-org-name.json' };

      renderWithProviders(<EventCard event={eventWithMetadata} />);

      expect(await screen.findByText(/bbbbbbbb…bbbbbb/)).toBeInTheDocument();
    });

    it('still dispatches the full raw organizer key via View Info, even with an organizer name set', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'DevCon 2026', organization: { name: 'AdaSouls Inc.' } }),
      });
      const eventWithMetadata = { ...mockEvent, metadataURI: 'https://example.com/meta-org-name-expanded.json' };
      const dispatch = jest.fn();

      renderWithProviders(<EventCard event={eventWithMetadata} isExpanded />, { drawerDispatch: dispatch });

      await screen.findByText('AdaSouls Inc.');
      await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_BLOCKCHAIN_INFO',
        payload: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ key: 'organizer', value: mockEvent.issuerPk }),
          ]),
        }),
      });
    });
  });
  describe('Ask for Proof of Ownership', () => {
    const ZERO = '0'.repeat(64);
    const organizerDrawer = (service = {}) => ({
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: mockEvent.issuerPk, service } },
    });

    it("is not offered on someone else's event", () => {
      renderWithProviders(<EventCard event={{ ...mockEvent, issuerPk: 'cc'.repeat(32) }} isExpanded />, {
        drawerValue: organizerDrawer(),
      });
      expect(screen.queryByRole('button', { name: /ask for proof of ownership/i })).not.toBeInTheDocument();
    });

    it('publishes a plain request for the event and then shows it as enabled', async () => {
      const publishDisclosureRequest = jest
        .fn()
        .mockResolvedValue({ public: { txHash: '0xpub' }, private: { result: new Uint8Array(32).fill(3) } });
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, {
        drawerValue: organizerDrawer({ publishDisclosureRequest }),
      });

      const button = await screen.findByRole('button', { name: /ask for proof of ownership/i });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);

      await waitFor(() => expect(screen.getByText(/proof of ownership enabled/i)).toBeInTheDocument());
      const [, eventId, fieldId, setRoot] = publishDisclosureRequest.mock.calls[0];
      expect(Buffer.from(eventId).toString('hex')).toBe(mockEvent.eventId);
      expect(fieldId).toEqual(new Uint8Array(32));
      expect(setRoot).toEqual(new Uint8Array(32));
    });

    it('shows it as already enabled when the organizer published one before', async () => {
      getAllDisclosureRequests.mockResolvedValue([
        { requestId: '11'.repeat(32), verifierPk: mockEvent.issuerPk, eventId: mockEvent.eventId, fieldId: ZERO, setRoot: ZERO },
      ]);
      renderWithProviders(<EventCard event={mockEvent} isExpanded />, { drawerValue: organizerDrawer() });
      expect(await screen.findByText(/proof of ownership enabled/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ask for proof of ownership/i })).not.toBeInTheDocument();
    });
  });
});
