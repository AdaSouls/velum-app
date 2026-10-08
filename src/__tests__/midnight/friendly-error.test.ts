import { friendlyErrorMessage } from '../../midnight/friendly-error';

const FALLBACK = 'Failed to create the event. Please try again.';

describe('friendlyErrorMessage', () => {
  it('asks to wait when the wallet still has a transaction pending', () => {
    const error = new Error("Unexpected error submitting scoped transaction '<unnamed>': Error: A transaction is already pending.");
    expect(friendlyErrorMessage(error, FALLBACK)).toMatch(/still sending your previous transaction/);
  });

  it('explains an unreachable proof server instead of the raw scoped-transaction error', () => {
    const error = new Error(
      "Unexpected error submitting scoped transaction '<unnamed>': Error: 'check' returned an error: TypeError: Failed to fetch",
      { cause: new Error("'check' returned an error: TypeError: Failed to fetch") },
    );
    const message = friendlyErrorMessage(error, FALLBACK);
    expect(message).toMatch(/couldn't reach the proof server/i);
    expect(message).toContain('localhost:6300');
  });

  it('reports a proof server that answers with an error differently from one that is down', () => {
    const error = new Error("'prove' returned an error: Error: 400 Bad Request");
    expect(friendlyErrorMessage(error, FALLBACK)).toMatch(/couldn't create the proof/i);
  });

  it('maps a contract assert found deep in the cause chain', () => {
    const error = new Error("Unexpected error submitting scoped transaction '<unnamed>'", {
      cause: new Error('Error', { cause: new Error('failed assert: Organizer cannot claim their own event') }),
    });
    expect(friendlyErrorMessage(error, FALLBACK)).toBe("You organize this event, so you can't claim it yourself.");
  });

  it('keeps an unknown contract assert readable', () => {
    expect(friendlyErrorMessage(new Error('failed assert: Something new'), FALLBACK)).toBe(
      'The contract rejected this transaction: Something new',
    );
  });

  it('recognizes a wallet rejection by its connector error code', () => {
    const error = Object.assign(new Error('Transaction rejected'), { code: 'Rejected' });
    expect(friendlyErrorMessage(error, FALLBACK)).toBe('You cancelled the request in your wallet.');
  });

  it('explains a missing DUST balance', () => {
    expect(friendlyErrorMessage(new Error('Insufficient funds to cover fees'), FALLBACK)).toMatch(/enough DUST/);
  });

  it('passes through a message the app wrote itself', () => {
    expect(friendlyErrorMessage(new Error('That recovery code is not valid.'), FALLBACK)).toBe(
      'That recovery code is not valid.',
    );
  });

  it('falls back for internal library errors and empty messages', () => {
    expect(friendlyErrorMessage(new TypeError("Cannot read properties of undefined (reading 'x')"), FALLBACK)).toBe(FALLBACK);
    expect(friendlyErrorMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
    expect(friendlyErrorMessage(Object.assign(new Error(''), { code: 'InternalError' }), FALLBACK)).toBe(FALLBACK);
    expect(friendlyErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
