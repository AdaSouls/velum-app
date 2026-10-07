import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PublishDisclosureRequest from '../../../jsx/drawer/views/publishDisclosureRequest';
import { mockDrawerContext, renderWithProviders } from '../../../testUtils';
import { getDisclosureRequestsByVerifier, getTokensByEvent } from '../../../midnight/indexer.service';
import { buildMerkleTree } from '../../../midnight/merkle';
import { publishRequestRule } from '../../../midnight/disclosure-sets';

jest.mock('../../../midnight/disclosure-sets', () => ({
  publishRequestRule: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../midnight/indexer.service', () => ({
  getDisclosureRequestsByVerifier: jest.fn(),
  getTokensByEvent: jest.fn(),
}));
// Pulls in @midnight-ntwrk/compact-runtime (WASM-bindgen, unloadable under this project's Jest —
// see src/__tests__/midnight/merkle.test.ts's header comment), so it's mocked wholesale here same
// as in createEvent.test.jsx.
jest.mock('../../../midnight/merkle', () => ({
  buildMerkleTree: jest.fn(),
}));
// Same reason: the identity check's computeIdentityValue is a pure circuit of the compiled contract.
jest.mock('../../../midnight/contract.service', () => ({
  computeIdentityValue: jest.fn(() => new Uint8Array(32).fill(9)),
}));
const { computeIdentityValue } = jest.requireMock('../../../midnight/contract.service');

const FIELD = { fieldId: 'cc'.repeat(32), label: 'Region' };
const EVENT_ID_HEX = 'aa'.repeat(32);
const RECIPIENT = 'b7'.repeat(32);

// Every request is addressed to one holder (publishDisclosureRequest's 5th argument).
const fillRecipient = (key = RECIPIENT) => userEvent.type(screen.getByLabelText(/holder's key/i), key);

function buildDrawerValue({ publishDisclosureRequest, address = 'dd'.repeat(32) } = {}) {
  return {
    ...mockDrawerContext,
    midnight: {
      ...mockDrawerContext.midnight,
      provider: { address, wallet: 'Lace', service: { publishDisclosureRequest } },
    },
    disclosureEvent: { eventId: EVENT_ID_HEX, fields: [FIELD] },
  };
}

describe('PublishDisclosureRequest drawer view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTokensByEvent.mockResolvedValue([{ tokenId: 1, ownerPk: RECIPIENT }]);
    buildMerkleTree.mockResolvedValue({
      rootBytes: new Uint8Array(32).fill(5),
      leafCount: 2,
      pathForIndex: jest.fn(),
      pathForLeaf: jest.fn(),
    });
  });

  it('shows a connect-wallet message when there is no provider', () => {
    renderWithProviders(<PublishDisclosureRequest />, {
      drawerValue: { ...mockDrawerContext, disclosureEvent: { eventId: EVENT_ID_HEX, fields: [FIELD] } },
    });
    expect(screen.getByText(/connect your wallet first/i)).toBeInTheDocument();
  });

  it("prefills the holder's key when opened from a request link", async () => {
    const drawerValue = buildDrawerValue({ publishDisclosureRequest: jest.fn() });
    drawerValue.disclosureEvent = { eventId: EVENT_ID_HEX, fields: [FIELD], recipient: RECIPIENT };
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });
    expect(screen.getByLabelText(/holder's key/i)).toHaveValue(RECIPIENT);
    await waitFor(() => expect(getTokensByEvent).toHaveBeenCalled());
  });

  it('shows a no-attributes message when the event has no private attribute fields', () => {
    const drawerValue = buildDrawerValue({ publishDisclosureRequest: jest.fn() });
    drawerValue.disclosureEvent = { eventId: EVENT_ID_HEX, fields: [] };
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });
    expect(screen.getByText(/no private attributes to ask about/i)).toBeInTheDocument();
  });

  it('falls back to the indexer for the requestId, builds a depth-16 set tree, and publishes the accepted values', async () => {
    const publishDisclosureRequest = jest.fn().mockResolvedValue({ txHash: '0xabc' });
    publishRequestRule.mockResolvedValue(undefined);
    const drawerValue = buildDrawerValue({ publishDisclosureRequest });
    getDisclosureRequestsByVerifier.mockResolvedValue([
      {
        requestId: 'ee'.repeat(32),
        verifierPk: drawerValue.midnight.provider.address,
        eventId: EVENT_ID_HEX,
        fieldId: FIELD.fieldId,
        setRoot: Buffer.from(new Uint8Array(32).fill(5)).toString('hex'),
        recipientPk: RECIPIENT,
      },
    ]);

    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

    const memberInputs = screen.getAllByLabelText('Candidate value');
    await userEvent.type(memberInputs[0], 'EU');
    await userEvent.type(memberInputs[1], 'APAC');
    await fillRecipient();
    await userEvent.click(screen.getByRole('button', { name: /^publish request$/i }));

    await waitFor(() => expect(publishDisclosureRequest).toHaveBeenCalled());
    const [, eventIdArg, fieldIdArg, setRootArg, recipientArg] = publishDisclosureRequest.mock.calls[0];
    expect(eventIdArg).toEqual(Uint8Array.from(Buffer.from(EVENT_ID_HEX, 'hex')));
    expect(fieldIdArg).toEqual(Uint8Array.from(Buffer.from(FIELD.fieldId, 'hex')));
    expect(setRootArg).toEqual(new Uint8Array(32).fill(5));
    expect(recipientArg).toEqual(Uint8Array.from(Buffer.from(RECIPIENT, 'hex')));
    expect(buildMerkleTree).toHaveBeenCalledWith([expect.any(Uint8Array), expect.any(Uint8Array)], 16);

    await waitFor(() =>
      expect(publishRequestRule).toHaveBeenCalledWith('ee'.repeat(32), { op: 'oneOf', values: ['EU', 'APAC'] }),
    );
  });

  it('uses the returned requestId and publishes the accepted values for holders', async () => {
    const requestIdBytes = new Uint8Array(32).fill(0xee);
    const publishDisclosureRequest = jest
      .fn()
      .mockResolvedValue({ public: { txHash: '0xabc' }, private: { result: requestIdBytes } });
    publishRequestRule.mockResolvedValue(undefined);
    const drawerValue = buildDrawerValue({ publishDisclosureRequest });
    drawerValue.disclosureEvent = { eventId: EVENT_ID_HEX, fields: [{ ...FIELD, label: 'Sector' }] };
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

    const memberInputs = screen.getAllByLabelText('Candidate value');
    await userEvent.type(memberInputs[0], 'Campo');
    await userEvent.type(memberInputs[1], 'Platea');
    await fillRecipient();
    await userEvent.click(screen.getByRole('button', { name: /^publish request$/i }));

    expect(await screen.findByText(/Sector is one of: Campo, Platea/)).toBeInTheDocument();
    expect(publishRequestRule).toHaveBeenCalledWith('ee'.repeat(32), { op: 'oneOf', values: ['Campo', 'Platea'] });
    expect(getDisclosureRequestsByVerifier).not.toHaveBeenCalled();
    expect(screen.queryByText(/requestId=/)).not.toBeInTheDocument();
  });

  it('asks a range question about a number field: the rule is published, the whole range goes in the tree', async () => {
    const requestIdBytes = new Uint8Array(32).fill(0xee);
    const publishDisclosureRequest = jest
      .fn()
      .mockResolvedValue({ public: { txHash: '0xabc' }, private: { result: requestIdBytes } });
    const drawerValue = buildDrawerValue({ publishDisclosureRequest });
    drawerValue.disclosureEvent = {
      eventId: EVENT_ID_HEX,
      fields: [{ ...FIELD, label: 'Age', type: 'number', min: 0, max: 120 }],
    };
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

    // First option for a number field: "is at least (≥)"; the upper end comes from the field's max.
    await userEvent.type(screen.getByLabelText(/^value$/i), '18');
    expect(screen.getByLabelText(/up to/i)).toHaveValue(120);
    expect(screen.getByText(/accepts 103 values/i)).toBeInTheDocument();
    await fillRecipient();
    await userEvent.click(screen.getByRole('button', { name: /^publish request$/i }));

    expect(await screen.findByText(/Age ≥ 18/)).toBeInTheDocument();
    expect(publishRequestRule).toHaveBeenCalledWith('ee'.repeat(32), { op: 'gte', type: 'number', min: 18, max: 120 });
    expect(buildMerkleTree.mock.calls[0][0]).toHaveLength(103);
  });

  it('rejects submission with no candidate values', async () => {
    const publishDisclosureRequest = jest.fn();
    const drawerValue = buildDrawerValue({ publishDisclosureRequest });
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

    expect(screen.getByRole('button', { name: /^publish request$/i })).toBeDisabled();
    expect(publishDisclosureRequest).not.toHaveBeenCalled();
  });

  it("can't publish without the holder's key, and flags a key that isn't one", async () => {
    const publishDisclosureRequest = jest.fn();
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue: buildDrawerValue({ publishDisclosureRequest }) });

    const memberInputs = screen.getAllByLabelText('Candidate value');
    await userEvent.type(memberInputs[0], 'EU');
    expect(screen.getByRole('button', { name: /^publish request$/i })).toBeDisabled();

    await fillRecipient('not-a-key');
    expect(screen.getByText(/doesn't look like a holder's key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^publish request$/i })).toBeDisabled();
    expect(publishDisclosureRequest).not.toHaveBeenCalled();
  });

  it('warns when the key holds no POAP of this event (still publishable)', async () => {
    getTokensByEvent.mockResolvedValue([{ tokenId: 1, ownerPk: 'e1'.repeat(32) }]);
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue: buildDrawerValue({ publishDisclosureRequest: jest.fn() }) });

    await userEvent.type(screen.getAllByLabelText('Candidate value')[0], 'EU');
    await fillRecipient();

    expect(await screen.findByText(/holds no POAP of this event/i)).toBeInTheDocument();
    expect(getTokensByEvent).toHaveBeenCalledWith(EVENT_ID_HEX, { includeBurned: false });
    expect(screen.getByRole('button', { name: /^publish request$/i })).toBeEnabled();
  });

  it('asks about a "Valid until" date in plain words, anchored on today', async () => {
    const publishDisclosureRequest = jest.fn().mockResolvedValue({ private: { result: new Uint8Array(32).fill(0xee) } });
    const drawerValue = buildDrawerValue({ publishDisclosureRequest });
    drawerValue.disclosureEvent = {
      eventId: EVENT_ID_HEX,
      fields: [{ fieldId: FIELD.fieldId, label: 'Valid until', type: 'date', auto: 'validUntil' }],
      recipient: RECIPIENT,
    };
    renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

    // First question offered: "still valid", no dates to type.
    expect(screen.queryByLabelText(/^value$/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^publish request$/i }));

    await waitFor(() => expect(publishRequestRule).toHaveBeenCalled());
    const today = new Date().toISOString().slice(0, 10);
    expect(publishRequestRule.mock.calls[0][1]).toMatchObject({
      op: 'onOrAfter',
      type: 'date',
      from: today,
      preset: { kind: 'valid', asOf: today },
    });
    expect(await screen.findByText(/Still valid \(checked on/)).toBeInTheDocument();
  });

  describe('identity check', () => {
    const DNI = { fieldId: '0d'.repeat(32), label: 'DNI', type: 'identity', country: 'ARG', docType: 'national_id' };
    const SALT = 'ab'.repeat(32);

    it('publishes the identity check and the question to the same holder, the code prefilled from the link', async () => {
      computeIdentityValue.mockReturnValue(new Uint8Array(32).fill(9));
      const publishDisclosureRequest = jest
        .fn()
        .mockResolvedValueOnce({ private: { result: new Uint8Array(32).fill(0x01) } })
        .mockResolvedValueOnce({ private: { result: new Uint8Array(32).fill(0x02) } });
      const drawerValue = buildDrawerValue({ publishDisclosureRequest });
      drawerValue.disclosureEvent = {
        eventId: EVENT_ID_HEX,
        fields: [{ ...FIELD, label: 'Sector' }, DNI],
        recipient: RECIPIENT,
        idCodes: { [DNI.fieldId]: SALT },
      };
      renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

      expect(screen.getByLabelText(/identity code/i)).toHaveValue(SALT);
      await userEvent.type(screen.getByLabelText(/number, as seen on the document/i), '12.345.678');
      await userEvent.type(screen.getAllByLabelText('Candidate value')[0], 'Campo');
      await userEvent.click(screen.getByRole('button', { name: /^publish request$/i }));

      await waitFor(() => expect(publishDisclosureRequest).toHaveBeenCalledTimes(2));
      const [country, docType, number, salt] = computeIdentityValue.mock.calls[0];
      const text = (b) => Buffer.from(b).toString('utf8').replace(/\0+$/, '');
      expect([text(country), text(docType), text(number)]).toEqual(['ARG', 'national_id', '12345678']);
      expect(Buffer.from(salt).toString('hex')).toBe(SALT);
      // The identity set holds that one value.
      expect(buildMerkleTree.mock.calls[0]).toEqual([[new Uint8Array(32).fill(9)], 16]);
      const [first, second] = publishDisclosureRequest.mock.calls;
      expect(first[2]).toEqual(Uint8Array.from(Buffer.from(DNI.fieldId, 'hex')));
      expect(second[2]).toEqual(Uint8Array.from(Buffer.from(FIELD.fieldId, 'hex')));
      expect(first[4]).toEqual(second[4]);
      expect(publishRequestRule).toHaveBeenCalledWith('01'.repeat(32), { op: 'identity' });
      expect(publishRequestRule).toHaveBeenCalledWith('02'.repeat(32), { op: 'oneOf', values: ['Campo'] });
      expect(await screen.findByText(/DNI matches the document checked/)).toBeInTheDocument();
    });

    it('needs the number and a valid code before publishing', async () => {
      const publishDisclosureRequest = jest.fn();
      const drawerValue = buildDrawerValue({ publishDisclosureRequest });
      drawerValue.disclosureEvent = { eventId: EVENT_ID_HEX, fields: [DNI], recipient: RECIPIENT };
      renderWithProviders(<PublishDisclosureRequest />, { drawerValue });

      const publish = screen.getByRole('button', { name: /^publish request$/i });
      expect(publish).toBeDisabled();
      await userEvent.type(screen.getByLabelText(/number, as seen on the document/i), '12345678');
      await userEvent.type(screen.getByLabelText(/identity code/i), '00'.repeat(32));
      expect(screen.getByText(/enter the holder's identity code/i)).toBeInTheDocument();
      expect(publish).toBeDisabled();
    });
  });

  it('dispatches CLOSE_DRAWER when the close button is clicked', async () => {
    const dispatch = jest.fn();
    renderWithProviders(<PublishDisclosureRequest />, {
      drawerValue: buildDrawerValue({ publishDisclosureRequest: jest.fn() }),
      drawerDispatch: dispatch,
    });

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'CLOSE_DRAWER' });
  });
});
