import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateEvent from '../../../jsx/drawer/views/createEvent';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import { uploadJSONToIPFS } from '../../../services/ipfs.service';
import { getOrganizerProfile, saveOrganizerProfile } from '../../../midnight/organizer-profile';

jest.mock('../../../services/ipfs.service', () => ({
  uploadImageToIPFS: jest.fn(),
  uploadJSONToIPFS: jest.fn(),
}));
const buildDrawerValue = (createEvent) => ({
  ...mockDrawerContext,
  midnight: {
    ...mockDrawerContext.midnight,
    provider: { address: 'aa'.repeat(32), wallet: 'Lace', service: { createEvent } },
  },
});

const clickNext = () => userEvent.click(screen.getByRole('button', { name: /^next$/i }));
const clickBack = () => userEvent.click(screen.getByRole('button', { name: /^back$/i }));
const clickCreate = () => userEvent.click(screen.getByRole('button', { name: /^create$/i }));

// Every category walks details → image → supply → channels → taxonomy → org profile, then
// private fields only for Credential, and STEP_POAP_IMAGE only for self-mint categories
// (Event/Subscription) — Credential skips it, since its tokens get their own per-recipient image later via push-mint, not a shared one set
// here (see createEvent.jsx's steps useMemo). Every step after supply is fully optional, so this
// just keeps clicking Next until Create appears instead of hardcoding a step count per category.
// The POAP image switch starts on (Event/Subscription only); flows that don't test the image turn it
// off so they can submit without picking one.
async function useEventImageForPoap() {
  const toggle = screen.queryByLabelText('Use a different image for the POAP');
  if (toggle && toggle.checked) await userEvent.click(toggle);
}

async function fillThroughToSubmit({ categoryLabel, name, maxSupply, configureBeforeLastNext }) {
  await userEvent.click(screen.getByText(categoryLabel));
  await clickNext(); // step 0 -> details
  // Label text is category-specific ("Event Name"/"Subscription Name"/"Credential Name" — see
  // eventCategories.js's detailsFields), so match on the common "Name" suffix rather than one
  // category's exact wording.
  await userEvent.type(screen.getByLabelText(/Name/i), name);
  await clickNext(); // details -> image
  await clickNext(); // image -> supply (no image picked, nothing to crop)
  await userEvent.clear(screen.getByLabelText(/Maximum Supply/i));
  await userEvent.type(screen.getByLabelText(/Maximum Supply/i), maxSupply);
  let pendingConfigure = configureBeforeLastNext;
  while (screen.queryByRole('button', { name: /^next$/i })) {
    // Runs once, on the private-fields step (Credential only), right before clicking past it — lets callers fill
    // in an attribute row without hardcoding this wizard's exact step count/order.
    if (pendingConfigure && screen.queryByRole('button', { name: /add private field/i })) {
      await pendingConfigure();
      pendingConfigure = null;
    }
    await clickNext();
  }
  // Credential has no POAP-image step, so private fields is its LAST step (Create, no Next).
  if (pendingConfigure && screen.queryByRole('button', { name: /add private field/i })) {
    await pendingConfigure();
  }
  await useEventImageForPoap();
  await clickCreate(); // submit
}

describe('CreateEvent drawer view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadJSONToIPFS.mockResolvedValue('ipfs://Qmmetadata');
  });

  it('shows Step 0 with the three categories, Next disabled until one is picked', async () => {
    renderWithProviders(<CreateEvent />);

    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Credential')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();

    await userEvent.click(screen.getByText('Event'));
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled();
  });

  it('uses a category-specific header title and shows a Back button once past Step 0', async () => {
    renderWithProviders(<CreateEvent />);

    await userEvent.click(screen.getByText('Credential'));
    await clickNext();

    expect(screen.getByRole('heading', { name: /create credential/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument();
  });

  it('going back from the first content step returns to the category picker without losing entered data', async () => {
    renderWithProviders(<CreateEvent />);

    await userEvent.click(screen.getByText('Event'));
    await clickNext();
    await userEvent.type(screen.getByLabelText(/Event Name/i), 'DevCon');
    await clickBack();

    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('Credential')).toBeInTheDocument();

    await clickNext();
    expect(screen.getByLabelText(/Event Name/i)).toHaveValue('DevCon');
  });

  it('does not offer an editable public/private switch on the supply step — it is fixed by category', async () => {
    renderWithProviders(<CreateEvent />);

    await userEvent.click(screen.getByText('Event'));
    await clickNext();
    await userEvent.type(screen.getByLabelText(/Event Name/i), 'DevCon');
    await clickNext(); // details -> image
    await clickNext(); // image -> supply

    expect(screen.queryByRole('checkbox', { name: /public mint/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Public Mint$/i)).not.toBeInTheDocument();
  });

  it('shows the fixed mint type as a badge on each category card at Step 0', () => {
    renderWithProviders(<CreateEvent />);

    const eventCard = screen.getByText('Event').closest('[role="button"]');
    const subscriptionCard = screen.getByText('Subscription').closest('[role="button"]');
    const credentialCard = screen.getByText('Credential').closest('[role="button"]');

    expect(within(eventCard).getByText('Public Mint')).toBeInTheDocument();
    expect(within(subscriptionCard).getByText('Public Mint')).toBeInTheDocument();
    expect(within(credentialCard).getByText('Invite-Only Mint')).toBeInTheDocument();
  });

  it('completes the Event flow: public mint, category/taxonomy/channels land in the metadata JSON', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await userEvent.click(screen.getByText('Event'));
    await clickNext(); // step 0 -> details
    await userEvent.type(screen.getByLabelText(/Event Name/i), 'DevCon');
    await clickNext(); // details -> image
    await clickNext(); // image -> supply
    await userEvent.clear(screen.getByLabelText(/Maximum Supply/i));
    await userEvent.type(screen.getByLabelText(/Maximum Supply/i), '10');
    await clickNext(); // supply -> channels
    await userEvent.click(screen.getByRole('button', { name: /add channel/i }));
    await userEvent.type(screen.getByLabelText('Channel value'), 'hello@devcon.com');
    await clickNext(); // channels -> taxonomy
    await userEvent.click(screen.getByLabelText('Format'));
    await userEvent.click(screen.getByRole('option', { name: 'In-person' }));
    await clickNext(); // taxonomy -> org profile
    await clickNext(); // org profile -> POAP image (no private-fields step outside Credential)
    await useEventImageForPoap();
    await clickCreate(); // submit

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'DevCon',
        category: 'event',
        modality: 'in_person',
        channels: [{ type: 'email', value: 'hello@devcon.com' }],
      }),
    );
    const [, , , isPublicMintArg, metadataURIArg] = createEvent.mock.calls[0];
    expect(isPublicMintArg).toBe(true);
    expect(metadataURIArg).toBe('ipfs://Qmmetadata');
  });

  it('has no private-fields step on Event or Subscription, and leaves privateAttributesRoot all-zero', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    const sawPrivateFieldsStep = jest.fn();
    await fillThroughToSubmit({
      categoryLabel: 'Subscription',
      name: 'DevCon Pass',
      maxSupply: '0',
      configureBeforeLastNext: sawPrivateFieldsStep,
    });

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(sawPrivateFieldsStep).not.toHaveBeenCalled();
    expect(createEvent.mock.calls[0][6]).toEqual(new Uint8Array(32));
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.not.objectContaining({ privateAttributeFields: expect.anything() }),
    );
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.not.objectContaining({ credentialAttributeFields: expect.anything() }),
    );
  });

  it('completes the Credential flow with a fixed invite-only mint type', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await fillThroughToSubmit({ categoryLabel: 'Credential', name: 'Diplomas 2026', maxSupply: '0' });

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(expect.objectContaining({ category: 'credential' }));
    const [, , , isPublicMintArg] = createEvent.mock.calls[0];
    expect(isPublicMintArg).toBe(false);
  });

  it("puts the organizer's update-request key in a Credential's metadata", async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    const drawerValue = buildDrawerValue(createEvent);
    drawerValue.midnight.provider.service.getInboxKeyPair = jest.fn().mockResolvedValue({ publicKeyHex: 'ef'.repeat(32) });
    renderWithProviders(<CreateEvent />, { drawerValue });

    await fillThroughToSubmit({ categoryLabel: 'Credential', name: 'Diplomas 2026', maxSupply: '0' });

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(expect.objectContaining({ updateRequestKey: 'ef'.repeat(32) }));
  });

  it('on a Credential, private fields are a template: names only, no values and no event-level root', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await fillThroughToSubmit({
      categoryLabel: 'Credential',
      name: 'Recital',
      maxSupply: '0',
      configureBeforeLastNext: async () => {
        await userEvent.click(screen.getByRole('button', { name: /add private field/i }));
        expect(screen.queryByLabelText('Attribute value')).not.toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Attribute label'), 'Sector');
      },
    });

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][6]).toEqual(new Uint8Array(32));
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialAttributeFields: [{ fieldId: expect.stringMatching(/^[0-9a-f]{64}$/), label: 'Sector', type: 'text' }],
      }),
    );
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.not.objectContaining({ privateAttributeFields: expect.anything() }),
    );
  });

  it('saves each private field with its type: number limits and list options', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await fillThroughToSubmit({
      categoryLabel: 'Credential',
      name: 'Licencia',
      maxSupply: '0',
      configureBeforeLastNext: async () => {
        await userEvent.click(screen.getByRole('button', { name: /add private field/i }));
        await userEvent.type(screen.getByLabelText('Attribute label'), 'Age');
        await userEvent.click(screen.getByLabelText('Field type'));
        await userEvent.click(screen.getByRole('option', { name: 'Number' }));
        await userEvent.type(screen.getByLabelText('Minimum value'), '0');
        await userEvent.type(screen.getByLabelText('Maximum value'), '120');

        await userEvent.click(screen.getByRole('button', { name: /add private field/i }));
        await userEvent.type(screen.getAllByLabelText('Attribute label')[1], 'Sector');
        await userEvent.click(screen.getAllByLabelText('Field type')[1]);
        await userEvent.click(screen.getByRole('option', { name: 'List' }));
        await userEvent.type(screen.getByLabelText('List options'), 'Campo');
        expect(screen.getByText(/at least two options/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
        await userEvent.type(screen.getByLabelText('List options'), ', Platea');
      },
    });

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialAttributeFields: [
          { fieldId: expect.any(String), label: 'Age', type: 'number', min: 0, max: 120 },
          { fieldId: expect.any(String), label: 'Sector', type: 'list', options: ['Campo', 'Platea'] },
        ],
      }),
    );
  });

  it('saves the validity, and gives a Credential with validity its private "Valid until" field', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await userEvent.click(screen.getByText('Credential'));
    await clickNext();
    await userEvent.type(screen.getByLabelText(/Credential Name/i), 'Matrícula');
    await clickNext(); // details -> image
    await clickNext(); // image -> supply
    await userEvent.type(screen.getByLabelText(/Maximum Supply/i), '0');
    expect(screen.getByLabelText('Validity')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Validity unit'));
    await userEvent.click(screen.getByRole('option', { name: 'Years' }));
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled(); // unit without an amount
    await userEvent.type(screen.getByLabelText('Validity'), '5');
    while (screen.queryByRole('button', { name: /^next$/i })) {
      await clickNext();
    }
    await clickCreate();

    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        validity: { amount: 5, unit: 'years' },
        credentialAttributeFields: [
          { fieldId: expect.stringMatching(/^[0-9a-f]{64}$/), label: 'Valid until', type: 'date', auto: 'validUntil' },
        ],
      }),
    );
  });

  it('leaves validity out when it is "No expiry"', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });
    await fillThroughToSubmit({ categoryLabel: 'Subscription', name: 'Club', maxSupply: '0' });
    await waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(uploadJSONToIPFS).toHaveBeenCalledWith(expect.not.objectContaining({ validity: expect.anything() }));
  });

  it('starts with a separate POAP image switched on, and needs an image until it is switched off', async () => {
    const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

    await userEvent.click(screen.getByText('Event'));
    await clickNext();
    await userEvent.type(screen.getByLabelText(/Name/i), 'DevCon');
    await clickNext();
    await clickNext();
    while (screen.queryByRole('button', { name: /^next$/i })) {
      await clickNext();
    }

    const toggle = screen.getByLabelText('Use a different image for the POAP');
    expect(toggle).toBeChecked();
    expect(screen.getByText('Different POAP Image')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();

    await userEvent.click(toggle);
    expect(screen.getByText('Same as Event Image')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeEnabled();
  });

  describe('organizer profile', () => {
    beforeEach(() => window.localStorage.clear());

    const walkToOrgProfile = async () => {
      await userEvent.click(screen.getByText('Event'));
      await clickNext();
      await userEvent.type(screen.getByLabelText(/Name/i), 'DevCon');
      await clickNext();
      await clickNext();
      while (!screen.queryByLabelText('Organizer Name') && !screen.queryByLabelText('Use my organizer profile')) {
        await clickNext();
      }
    };

    it('with a saved profile, shows the switch on and a summary instead of the fields', async () => {
      saveOrganizerProfile('aa'.repeat(32), { name: 'Acme Labs', country: 'AR' });
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(jest.fn()) });

      await walkToOrgProfile();

      expect(screen.getByLabelText('Use my organizer profile')).toBeChecked();
      expect(screen.getByText('Acme Labs')).toBeInTheDocument();
      expect(screen.queryByLabelText('Organizer Name')).not.toBeInTheDocument();
    });

    it('turning the switch off opens the fields prefilled, not saving by default', async () => {
      saveOrganizerProfile('aa'.repeat(32), { name: 'Acme Labs' });
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(jest.fn()) });

      await walkToOrgProfile();
      await userEvent.click(screen.getByLabelText('Use my organizer profile'));

      expect(screen.getByLabelText('Organizer Name')).toHaveValue('Acme Labs');
      expect(screen.getByLabelText(/save as my organizer profile/i)).not.toBeChecked();
    });

    it('without a saved profile, shows the fields with saving on', async () => {
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(jest.fn()) });

      await walkToOrgProfile();

      expect(screen.queryByLabelText('Use my organizer profile')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/save as my organizer profile/i)).toBeChecked();
    });

    it('creates with the saved profile when the switch stays on', async () => {
      saveOrganizerProfile('aa'.repeat(32), { name: 'Acme Labs' });
      const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

      await walkToOrgProfile();
      while (screen.queryByRole('button', { name: /^next$/i })) await clickNext();
      await useEventImageForPoap();
      await clickCreate();

      await waitFor(() => expect(createEvent).toHaveBeenCalled());
      expect(uploadJSONToIPFS).toHaveBeenCalledWith(expect.objectContaining({ organization: { name: 'Acme Labs' } }));
    });

    it('saves what was used as the profile after a successful create', async () => {
      const createEvent = jest.fn().mockResolvedValue({ txHash: '0xabc' });
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

      await walkToOrgProfile();
      await userEvent.type(screen.getByLabelText('Organizer Name'), 'New Org');
      while (screen.queryByRole('button', { name: /^next$/i })) await clickNext();
      await useEventImageForPoap();
      await clickCreate();

      await waitFor(() => expect(createEvent).toHaveBeenCalled());
      expect(getOrganizerProfile('aa'.repeat(32))).toEqual({ name: 'New Org' });
    });

    it('leaves the profile alone when the switch is off or the create fails', async () => {
      saveOrganizerProfile('aa'.repeat(32), { name: 'Acme Labs' });
      const createEvent = jest.fn().mockRejectedValue(new Error('failed assert: Contract is paused'));
      renderWithProviders(<CreateEvent />, { drawerValue: buildDrawerValue(createEvent) });

      await walkToOrgProfile();
      await userEvent.click(screen.getByLabelText('Use my organizer profile'));
      await userEvent.clear(screen.getByLabelText('Organizer Name'));
      await userEvent.type(screen.getByLabelText('Organizer Name'), 'Other');
      while (screen.queryByRole('button', { name: /^next$/i })) await clickNext();
      await useEventImageForPoap();
      await clickCreate();

      await waitFor(() => expect(createEvent).toHaveBeenCalled());
      expect(getOrganizerProfile('aa'.repeat(32))).toEqual({ name: 'Acme Labs' });
    });
  });

  it('does not ask for a shared POAP image on the Credential flow — tokens get their own image later via push-mint', async () => {
    renderWithProviders(<CreateEvent />);

    await userEvent.click(screen.getByText('Credential'));
    await clickNext(); // step 0 -> details
    await userEvent.type(screen.getByLabelText(/Credential Name/i), 'Diplomas 2026');
    await clickNext(); // details -> image
    await clickNext(); // image -> supply
    await userEvent.clear(screen.getByLabelText(/Maximum Supply/i));
    await userEvent.type(screen.getByLabelText(/Maximum Supply/i), '0');

    let sawPoapImageStep = false;
    while (screen.queryByRole('button', { name: /^next$/i })) {
      if (screen.queryByText(/different poap image/i) || screen.queryByText(/same as event image/i)) {
        sawPoapImageStep = true;
      }
      await clickNext();
    }

    expect(sawPoapImageStep).toBe(false);
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });

  it('shows an error and does not call the service when submitting without a connected wallet', async () => {
    const createEvent = jest.fn();
    const drawerValue = buildDrawerValue(createEvent);
    drawerValue.midnight.provider = null;
    renderWithProviders(<CreateEvent />, { drawerValue });

    await fillThroughToSubmit({ categoryLabel: 'Subscription', name: 'AdaSouls Updates', maxSupply: '0' });

    expect(createEvent).not.toHaveBeenCalled();
  });

  it('dispatches CLOSE_DRAWER when the close button is clicked', async () => {
    const dispatch = jest.fn();
    renderWithProviders(<CreateEvent />, { drawerDispatch: dispatch });

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'CLOSE_DRAWER' });
  });
});
