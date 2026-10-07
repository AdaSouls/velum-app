import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PoapCard from '../../jsx/components/poapCard';
import { mockDrawerContext, renderWithProviders } from '../../testUtils';
import { getTokenVisibility } from '../../midnight/collection-share';
import { getCredentialUpdateRequest, getEvent } from '../../midnight/indexer.service';
import { loadCredentialPackage } from '../../midnight/holder-proofs';
import { act } from '@testing-library/react';
import { notifyTokenBurned } from '../../midnight/token-events';
import { blockTimestamp } from '../../midnight/proof-verification';
import { addProofRecord } from '../../midnight/proof-history';

jest.mock('../../midnight/indexer.service');
jest.mock('../../midnight/proof-verification', () => ({
  ...jest.requireActual('../../midnight/proof-verification'),
  blockTimestamp: jest.fn(),
}));
// holder-proofs pulls in the compiled contract (WASM), unloadable under Jest — see merkle.test.ts.
jest.mock('../../midnight/holder-proofs', () => ({
  loadCredentialPackage: jest.fn().mockResolvedValue(null),
}));


describe('PoapCard Component', () => {
  const mockPoap = {
    issuerPkHex: 'aa'.repeat(32),
    tokenId: 1,
    firstEventId: 'bb'.repeat(32),
    isSoulbound: false,
    isBurned: false,
    tokenMetadataURI: null,
    metadataURI: null,
    mintedTx: null,
    mintedBlock: null,
  };

  // The expanded card's embedded "event info" preview (poapCard.jsx) fetches the live event via
  // getEvent(poap.firstEventId) — every test that renders isExpanded needs this to resolve to an
  // actual promise, not automock's default `undefined`, or the component's own .then/.catch chain
  // throws. Individual tests override this where the specific event fields matter.
  beforeEach(() => {
    getEvent.mockResolvedValue({
      eventId: mockPoap.firstEventId,
      issuerPk: mockPoap.issuerPkHex,
      maxSupply: 0,
      expiration: 0,
      isActive: true,
      isPublicMint: true,
      metadataURI: null,
      minted: 1,
      createdBlock: null,
      createdTx: null,
      deactivatedBlock: null,
      liveTokens: 1,
    });
  });

  it('renders the token id', () => {
    renderWithProviders(<PoapCard poap={mockPoap} />);
    expect(screen.getByText(/POAP #1/i)).toBeInTheDocument();
  });

  it('shows the issuer and event for this token', () => {
    renderWithProviders(<PoapCard poap={mockPoap} />);
    expect(screen.getByText(/Issuer:/i)).toBeInTheDocument();
    expect(screen.getByText(/Event:/i)).toBeInTheDocument();
  });

  it('no longer shows a Soulbound badge, even for a token claimed as soulbound', () => {
    renderWithProviders(<PoapCard poap={{ ...mockPoap, isSoulbound: true }} />);
    expect(screen.queryByText(/Soulbound/i)).not.toBeInTheDocument();
  });

  it('shows a burned badge when isBurned is true', () => {
    renderWithProviders(<PoapCard poap={{ ...mockPoap, isBurned: true }} />);
    expect(screen.getByText(/Burned/i)).toBeInTheDocument();
  });

  it('shows a category-aware "done" status badge (top-right, like eventCard.jsx) when not burned', () => {
    renderWithProviders(<PoapCard poap={mockPoap} />);
    // No category/modality/relationship on mockPoap's metadata, so getClaimActionLabel falls back
    // to the generic "Subscribed" — see eventCategories.js.
    expect(screen.getByText(/^Subscribed$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Burned$/i)).not.toBeInTheDocument();
  });

  it('shows a Burned status badge instead of the done-state one once burned — no separate "pending"/claim state exists', () => {
    renderWithProviders(<PoapCard poap={{ ...mockPoap, isBurned: true }} />);
    expect(screen.getByText(/^Burned$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Subscribed$/i)).not.toBeInTheDocument();
  });

  it('calls onExpand when the card is clicked', async () => {
    const onExpand = jest.fn();
    renderWithProviders(<PoapCard poap={mockPoap} onExpand={onExpand} />);

    await userEvent.click(screen.getByText(/POAP #1/i));

    // onExpand is deliberately delayed until the text's own fade-out finishes, so the resize
    // never starts while text is still visible — see poapCard.jsx's TEXT_FADE_MS.
    await waitFor(() => expect(onExpand).toHaveBeenCalled());
  });

  it('renders no action button in the collapsed tile — the card itself is the click target', () => {
    renderWithProviders(<PoapCard poap={mockPoap} />);
    expect(screen.queryByRole('button', { name: /view details/i })).not.toBeInTheDocument();
  });

  describe('expanded state', () => {
    const issuerPkHex = 'bb'.repeat(32);
    const holderPkHex = 'ff'.repeat(32);

    const poap = {
      issuerPkHex,
      tokenId: 42,
      firstEventId: 'aa'.repeat(32),
      isSoulbound: true,
      isBurned: false,
      tokenMetadataURI: null,
      metadataURI: null,
      mintedTx: 'tx-hash-42',
      mintedBlock: 100,
    };

    const drawerValue = {
      ...mockDrawerContext,
      midnight: { ...mockDrawerContext.midnight, provider: { address: holderPkHex } },
    };

    beforeEach(() => {
      window.localStorage.clear();
      navigator.clipboard.writeText.mockClear();
    });

    it('calls onCollapse when the close button is clicked', async () => {
      const onCollapse = jest.fn();
      renderWithProviders(<PoapCard poap={poap} isExpanded onCollapse={onCollapse} />, { drawerValue });

      await userEvent.click(screen.getByRole('button', { name: /collapse poap details/i }));

      await waitFor(() => expect(onCollapse).toHaveBeenCalled());
    });

    it('shows the on-chain mint transaction as verified proof, and dispatches it as a copyable field via View Info', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue, drawerDispatch: dispatch });
      expect(screen.getByText('Verified')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_BLOCKCHAIN_INFO',
        payload: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: 'tx',
              value: 'tx-hash-42',
              copyable: true,
              href: 'https://www.midnightexplorer.com/transactions/tx-hash-42',
            }),
          ]),
        }),
      });
    });

    it('shows an ownership seal and a blurred anonymous seal once proofs were made', () => {
      const owned = { ...poap, ownerPk: 'dd'.repeat(32) };
      const key = `velum:midnight:proofs:${owned.ownerPk}:42`;
      window.localStorage.setItem(
        key,
        JSON.stringify([
          { kind: 'proveEventAttendance', question: 'Holds a valid POAP of this event', txHash: 'a1'.repeat(32), provenAt: '2026-09-24T20:00:00.000Z' },
          { kind: 'proveTokenOwnership', question: 'Owns POAP #42', txHash: 'b2'.repeat(32), provenAt: '2026-09-23T20:00:00.000Z' },
        ]),
      );
      renderWithProviders(<PoapCard poap={owned} isExpanded />, { drawerValue });

      expect(screen.getByText('Ownership proven')).toBeInTheDocument();
      const anonymous = screen.getByText('Ownership proven anonymously').closest('.poap-verified-seal-card');
      expect(anonymous.querySelector('.poap-seal-icon-anonymous')).not.toBeNull();
    });

    it('shows no proof seals before any proof', () => {
      renderWithProviders(<PoapCard poap={{ ...poap, ownerPk: 'dd'.repeat(32) }} isExpanded />, { drawerValue });
      expect(screen.queryByText('Ownership proven')).not.toBeInTheDocument();
      expect(screen.queryByText('Ownership proven anonymously')).not.toBeInTheDocument();
    });

    it('opens the ownership proof popup for this token', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue, drawerDispatch: dispatch });

      await userEvent.click(screen.getByRole('button', { name: /^prove ownership$/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_PROVE_OWNERSHIP',
        payload: expect.objectContaining({
          tokenId: poap.tokenId,
          eventId: poap.firstEventId,
          issuerPkHex: poap.issuerPkHex,
        }),
      });
    });

    it('never shows the organizer-key copy badge to the holder', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue, drawerDispatch: dispatch });

      await userEvent.click(screen.getByRole('button', { name: /^view info$/i }));

      const { fields } = dispatch.mock.calls.find(([a]) => a.type === 'SHOW_BLOCKCHAIN_INFO')[0].payload;
      const issuer = fields.find((f) => f.key === 'issuer');
      expect(issuer.copyable).toBeFalsy();
      expect(issuer.hint).toBeUndefined();
    });

    it('shows no proof message when the token has no mint tx yet', () => {
      renderWithProviders(<PoapCard poap={{ ...poap, mintedTx: null }} isExpanded />, { drawerValue });
      expect(screen.getByText(/no mint transaction found/i)).toBeInTheDocument();
    });

    it('defaults the share-visibility toggle to checked', () => {
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue });
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('unchecking the toggle persists it as hidden via collection-share', async () => {
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue });
      const checkbox = screen.getByRole('checkbox');
      await userEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      expect(getTokenVisibility(issuerPkHex, poap.tokenId)).toBe(false);
    });

    it('copies an /app/share link for this token, without the wallet address', async () => {
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue });

      await userEvent.click(screen.getByText(/copy share link/i));

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copiedUrl = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedUrl).toContain('/app/share?d=');
      expect(copiedUrl).not.toContain(drawerValue.midnight.provider.address);
      expect(screen.getByText(/link copied/i)).toBeInTheDocument();
    });

    it('disables the share button when no wallet is connected', () => {
      const disconnectedValue = { ...drawerValue, midnight: { ...drawerValue.midnight, provider: null } };
      renderWithProviders(<PoapCard poap={poap} isExpanded />, { drawerValue: disconnectedValue });
      expect(screen.getByText(/copy share link/i)).toBeDisabled();
    });
  });

  describe('token metadata', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('shows the fallback POAP # title when no metadata resolves', () => {
      renderWithProviders(<PoapCard poap={mockPoap} />);
      expect(screen.getByText(/POAP #1/i)).toBeInTheDocument();
    });

    it('shows the resolved name and thumbnail once tokenMetadataURI resolves', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'Genesis Meetup', image: 'https://example.com/img.png' }),
      });

      renderWithProviders(
        <PoapCard poap={{ ...mockPoap, tokenId: 2, tokenMetadataURI: 'https://example.com/meta.json' }} />
      );

      expect(await screen.findByText('Genesis Meetup')).toBeInTheDocument();
    });

    it('shows the full-size document image in the expanded view for a push-minted credential', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'Diploma',
          documentImage: 'https://example.com/diploma.png',
        }),
      });

      const { container } = renderWithProviders(
        <PoapCard
          poap={{ ...mockPoap, tokenId: 3, tokenMetadataURI: 'https://example.com/meta-diploma.json' }}
          isExpanded
        />
      );

      await waitFor(() => {
        expect(container.querySelector('.poap-credential-document-image')).toBeInTheDocument();
      });
      expect(container.querySelector('.poap-credential-document-image')).toHaveAttribute(
        'src',
        'https://example.com/diploma.png'
      );
    });

    it('shows no document-image block for a token with no documentImage (self-claimed)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'Genesis Meetup', image: 'https://example.com/img.png' }),
      });

      const { container } = renderWithProviders(
        <PoapCard
          poap={{ ...mockPoap, tokenId: 4, tokenMetadataURI: 'https://example.com/meta-no-doc.json' }}
          isExpanded
        />
      );

      await waitFor(() => {
        expect(container.querySelector('img[src="https://example.com/img.png"]')).toBeInTheDocument();
      });
      // No separate document-image block at all when the token has no documentImageUrl of its own.
      expect(container.querySelector('.poap-credential-document-image')).not.toBeInTheDocument();
    });

    it("shows the organizer's display name instead of the raw issuer key when set", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'Diploma', organization: { name: 'AdaSouls Inc.' } }),
      });

      renderWithProviders(
        <PoapCard poap={{ ...mockPoap, tokenId: 5, tokenMetadataURI: 'https://example.com/meta-issuer-name.json' }} />
      );

      expect(await screen.findByText('AdaSouls Inc.')).toBeInTheDocument();
      expect(screen.queryByText(/aaaaaaaa…aaaaaa/)).not.toBeInTheDocument();
    });
  });
  describe('private details (credential)', () => {
    const FIELDS = [{ fieldId: '01'.repeat(32), label: 'Sector' }];
    const campoHex = Buffer.concat([Buffer.from('Campo'), Buffer.alloc(27)]).toString('hex');
    const PKG = {
      version: 1,
      eventId: 'bb'.repeat(32),
      issuerPk: 'aa'.repeat(32),
      holderPk: 'cc'.repeat(32),
      credAttrRoot: 'dd'.repeat(32),
      fields: [{ fieldId: FIELDS[0].fieldId, label: 'Sector', valueHex: campoHex, randHex: '11'.repeat(32) }],
    };
    const credentialPoap = {
      ...mockPoap,
      ownerPk: 'cc'.repeat(32),
      metadataURI: 'https://example.com/meta-credential-fields.json',
    };
    const connected = (dispatch) => ({
      drawerValue: {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: 'ee'.repeat(32), service: {} } },
      },
      drawerDispatch: dispatch,
    });

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ name: 'Recital', category: 'credential', credentialAttributeFields: FIELDS }),
      });
    });

    it('keeps the values hidden until the holder asks to see them', async () => {
      loadCredentialPackage.mockResolvedValue(PKG);
      renderWithProviders(<PoapCard poap={credentialPoap} isExpanded />, connected(jest.fn()));

      expect(await screen.findByText('Sector')).toBeInTheDocument();
      expect(screen.queryByText('Campo')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /show private details/i }));
      expect(screen.getByText('Campo')).toBeInTheDocument();
      expect(loadCredentialPackage).toHaveBeenCalledWith(
        {},
        { tokenId: 1, eventId: 'bb'.repeat(32), issuerPk: 'aa'.repeat(32), holderPk: 'cc'.repeat(32) },
      );
    });

    it('says so when the organizer has not sent the details', async () => {
      loadCredentialPackage.mockResolvedValue(null);
      renderWithProviders(<PoapCard poap={credentialPoap} isExpanded />, connected(jest.fn()));
      expect(await screen.findByText(/hasn't sent this credential's private details/i)).toBeInTheDocument();
    });

    it('opens Prove a Private Detail with the token, its fields and its details', async () => {
      loadCredentialPackage.mockResolvedValue(PKG);
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={credentialPoap} isExpanded />, connected(dispatch));
      await screen.findByRole('button', { name: /show private details/i });

      await userEvent.click(screen.getByRole('button', { name: /prove a private detail/i }));
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_HOLDER_PROOFS',
        payload: expect.objectContaining({ mode: 'detail', credentialFields: FIELDS, pkg: PKG, eventName: 'Recital' }),
      });
    });

    it('shows an identity document masked, its code, and a pending update request', async () => {
      const DNI = { fieldId: '0d'.repeat(32), label: 'DNI', type: 'identity', country: 'ARG', docType: 'national_id' };
      const identity = { country: 'ARG', docType: 'national_id', number: '12345678', saltHex: 'ab'.repeat(32) };
      const pkg = { ...PKG, fields: [{ fieldId: DNI.fieldId, label: 'DNI', valueHex: '77'.repeat(32), randHex: '12'.repeat(32), identity }] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          name: 'Diploma',
          category: 'credential',
          credentialAttributeFields: [DNI],
          updateRequestKey: 'ef'.repeat(32),
        }),
      });
      loadCredentialPackage.mockResolvedValue(pkg);
      getCredentialUpdateRequest.mockResolvedValue({ tokenId: 1, status: 'pending' });
      const dispatch = jest.fn();
      // Its own metadata URI: useEventMetadata caches per URI across tests.
      const poap = { ...credentialPoap, metadataURI: 'https://example.com/meta-credential-identity.json' };
      renderWithProviders(<PoapCard poap={poap} isExpanded />, connected(dispatch));

      expect(await screen.findByText(/National ID · ARG · ••••5678/)).toBeInTheDocument();
      expect(screen.getByText('Identity code')).toBeInTheDocument();
      expect(await screen.findByText(/update requested/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /request update again/i }));
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_REQUEST_UPDATE',
        payload: expect.objectContaining({ pkg, updateRequestKey: 'ef'.repeat(32), pending: true }),
      });
    });

    it('opens Prove Ownership Anonymously with the credential details it needs', async () => {
      loadCredentialPackage.mockResolvedValue(PKG);
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={credentialPoap} isExpanded />, connected(dispatch));
      await screen.findByRole('button', { name: /show private details/i });

      await userEvent.click(screen.getByRole('button', { name: /prove ownership anonymously/i }));
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_HOLDER_PROOFS',
        payload: expect.objectContaining({ mode: 'ownership', pkg: PKG }),
      });
    });
  });

  describe('burn', () => {
    const drawerFor = (dispatch) => ({
      drawerValue: {
        ...mockDrawerContext,
        midnight: { ...mockDrawerContext.midnight, provider: { address: 'ee'.repeat(32), service: {} } },
      },
      drawerDispatch: dispatch,
    });

    it('opens the burn confirmation for the holder', async () => {
      const dispatch = jest.fn();
      renderWithProviders(<PoapCard poap={mockPoap} isExpanded />, drawerFor(dispatch));

      await userEvent.click(await screen.findByRole('button', { name: /^burn$/i }));

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SHOW_BURN_TOKEN',
        payload: expect.objectContaining({ mode: 'burn', tokenId: 1, eventId: mockPoap.firstEventId }),
      });
    });

    it('has no Burn button once burned', () => {
      renderWithProviders(<PoapCard poap={{ ...mockPoap, isBurned: true }} isExpanded />, drawerFor(jest.fn()));
      expect(screen.queryByRole('button', { name: /^burn$/i })).not.toBeInTheDocument();
    });

    it('shows Burned right away when this token is burned, without waiting for the indexer', async () => {
      renderWithProviders(<PoapCard poap={mockPoap} isExpanded />, drawerFor(jest.fn()));
      await screen.findByRole('button', { name: /^burn$/i });

      act(() => notifyTokenBurned(mockPoap.firstEventId, 1));

      // Desktop status badge plus the phone-only badge row (CSS shows one of them).
      expect((await screen.findAllByText(/^Burned$/i)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /^burn$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /prove ownership/i })).not.toBeInTheDocument();
    });
  });

  describe('validity', () => {
    const withEventMetadata = (meta) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(meta) });
    };
    // useEventMetadata caches by URI, so every test needs its own.
    let uriCounter = 0;
    const poapOf = (extra = {}) => ({
      ...mockPoap,
      ownerPk: 'cc'.repeat(32),
      metadataURI: `https://example.com/validity-${(uriCounter += 1)}.json`,
      ...extra,
    });

    beforeEach(() => window.localStorage.clear());

    it('a Subscription nobody has proven yet shows "Not proven yet"', async () => {
      withEventMetadata({ name: 'Club', category: 'subscription', validity: { amount: 30, unit: 'days' } });
      renderWithProviders(<PoapCard poap={poapOf()} />);
      expect(await screen.findByText('Not proven yet')).toBeInTheDocument();
    });

    it('a Subscription is active for its validity after an ownership proof', async () => {
      withEventMetadata({ name: 'Club', category: 'subscription', validity: { amount: 30, unit: 'days' } });
      const provenAt = new Date();
      addProofRecord('cc'.repeat(32), 1, { kind: 'proveEventAttendance', question: 'q', txHash: null, provenAt: provenAt.toISOString() });
      renderWithProviders(<PoapCard poap={poapOf()} />);
      const until = new Date(provenAt.getTime() + 30 * 24 * 3600 * 1000);
      const dd = String(until.getDate()).padStart(2, '0');
      const mm = String(until.getMonth() + 1).padStart(2, '0');
      expect(await screen.findByText(`Active until ${dd}/${mm}/${until.getFullYear()}`)).toBeInTheDocument();
    });

    it('an Event counts from the block it was minted in, and shows Expired once past', async () => {
      withEventMetadata({ name: 'Recital', category: 'event', validity: { amount: 1, unit: 'days' } });
      blockTimestamp.mockResolvedValue(Date.parse('2020-01-01T12:00:00Z'));
      renderWithProviders(<PoapCard poap={poapOf({ mintedBlock: 77 })} />);
      expect(await screen.findByText(/^Expired · 0?2\/01\/2020/)).toBeInTheDocument();
      expect(blockTimestamp).toHaveBeenCalledWith(77);
    });

    it('opens a pill on tap without expanding the card, and only one pill at a time', async () => {
      withEventMetadata({ name: 'Club', category: 'subscription', validity: { amount: 30, unit: 'days' } });
      addProofRecord('cc'.repeat(32), 1, { kind: 'proveEventAttendance', question: 'q', txHash: null, provenAt: new Date().toISOString() });
      const onExpand = jest.fn();
      renderWithProviders(<PoapCard poap={poapOf()} onExpand={onExpand} />);
      const validity = await screen.findByRole('button', { name: /active until/i });
      const proven = screen.getByRole('button', { name: /proven/i });

      fireEvent.click(validity);
      expect(validity).toHaveClass('is-open');
      expect(validity).toHaveAttribute('aria-expanded', 'true');
      expect(onExpand).not.toHaveBeenCalled();

      fireEvent.click(proven);
      expect(proven).toHaveClass('is-open');
      expect(validity).not.toHaveClass('is-open');

      fireEvent.click(proven);
      expect(proven).not.toHaveClass('is-open');
      expect(onExpand).not.toHaveBeenCalled();
    });

    it('shows nothing when the event has no validity', async () => {
      withEventMetadata({ name: 'Recital', category: 'event' });
      renderWithProviders(<PoapCard poap={poapOf({ mintedBlock: 77 })} />);
      await screen.findByText(/POAP #1/);
      expect(screen.queryByText(/until|Expired|Not proven/)).not.toBeInTheDocument();
    });
  });
});
