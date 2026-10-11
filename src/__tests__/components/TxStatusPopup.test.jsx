import React from 'react';
import { act, render, screen } from '@testing-library/react';
import TxStatusPopup from '../../jsx/components/TxStatusPopup';
import {
  closeProgress,
  finishProgress,
  pushProgressStep,
  setTxPhase,
  MIN_RUNNING_MS,
  DONE_MS,
  SHIFT_MS,
  RESULT_MS,
} from '../../midnight/tx-status';

// One full step handoff: running (min time) -> check -> shifts up, next one takes its place.
const STEP_HANDOFF_MS = MIN_RUNNING_MS + DONE_MS;
const stepEl = (text) => screen.getByText(text).parentElement;

const advance = (ms) => act(() => jest.advanceTimersByTime(ms));

describe('TxStatusPopup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => closeProgress());
    jest.useRealTimers();
  });

  it('renders nothing while no flow is in progress', () => {
    render(<TxStatusPopup />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows one step at a time in the same card and ends with the result in that card', () => {
    render(<TxStatusPopup />);

    act(() => pushProgressStep('Creating Event', 'Uploading metadata to IPFS…'));
    expect(screen.getByRole('status')).toHaveTextContent('Creating Event');
    expect(stepEl('Uploading metadata to IPFS…')).toHaveClass('is-current', 'is-running');

    act(() => setTxPhase('proving'));
    // The next step only shows up once the current one has had its spinner -> check beat.
    expect(screen.queryByText(/generating zero-knowledge proof/i)).not.toBeInTheDocument();
    advance(MIN_RUNNING_MS);
    expect(stepEl('Uploading metadata to IPFS…')).toHaveClass('is-current', 'is-done');
    advance(DONE_MS);
    // Finished step moves up and dims, the new one takes the live slot.
    expect(stepEl('Uploading metadata to IPFS…')).toHaveClass('is-previous', 'is-done');
    expect(stepEl(/generating zero-knowledge proof/i)).toHaveClass('is-current', 'is-running');

    act(() => setTxPhase('approving'));
    act(() => setTxPhase('submitting'));
    act(() => setTxPhase('confirming'));
    act(() => setTxPhase('confirmed'));
    advance(STEP_HANDOFF_MS);
    // Two steps back slides out, then is gone once its exit transition is over.
    expect(stepEl('Uploading metadata to IPFS…')).toHaveClass('is-exiting');
    expect(stepEl(/generating zero-knowledge proof/i)).toHaveClass('is-previous');
    expect(stepEl(/approve the transaction in your wallet/i)).toHaveClass('is-current');
    advance(SHIFT_MS);
    expect(screen.queryByText('Uploading metadata to IPFS…')).not.toBeInTheDocument();
    advance(STEP_HANDOFF_MS - SHIFT_MS);
    expect(stepEl(/submitting transaction/i)).toHaveClass('is-current');
    advance(STEP_HANDOFF_MS);
    expect(stepEl(/waiting for on-chain confirmation/i)).toHaveClass('is-current', 'is-running');

    let handled;
    act(() => {
      handled = finishProgress({ kind: 'success', title: 'Event Created Successfully', message: 'Transaction: abc' });
    });
    expect(handled).toBe(true);
    advance(STEP_HANDOFF_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Event Created Successfully');
    expect(screen.getByRole('status')).toHaveTextContent('Transaction: abc');

    advance(RESULT_MS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('links a confirmed transaction to the explorer of the network the app runs on', () => {
    const originalNetwork = process.env.REACT_APP_MIDNIGHT_NETWORK_ID;
    process.env.REACT_APP_MIDNIGHT_NETWORK_ID = 'preprod';
    const hash = 'ab'.repeat(32);
    try {
      render(<TxStatusPopup />);
      act(() => pushProgressStep('Creating Event', 'Preparing transaction…'));
      act(() => {
        finishProgress({ kind: 'success', title: 'Event Created Successfully', message: `Transaction: ${hash}` });
      });
      advance(MIN_RUNNING_MS + DONE_MS + SHIFT_MS);

      const link = screen.getByRole('link', { name: /view on midnight explorer/i });
      expect(link).toHaveAttribute('href', `https://preprod.midnightexplorer.com/transactions/${hash}`);
      expect(link).toHaveAttribute('target', '_blank');
    } finally {
      if (originalNetwork === undefined) delete process.env.REACT_APP_MIDNIGHT_NETWORK_ID;
      else process.env.REACT_APP_MIDNIGHT_NETWORK_ID = originalNetwork;
    }
  });

  it('shows no explorer link for a failed transaction or on a local devnet', () => {
    const hash = 'ab'.repeat(32);
    render(<TxStatusPopup />);
    act(() => pushProgressStep('Creating Event', 'Preparing transaction…'));
    act(() => {
      finishProgress({ kind: 'success', title: 'Event Created Successfully', message: `Transaction: ${hash}` });
    });
    advance(MIN_RUNNING_MS + DONE_MS + SHIFT_MS);

    expect(screen.getByText('Event Created Successfully')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view on midnight explorer/i })).not.toBeInTheDocument();
  });

  it('cuts straight to the error without marking the failed step as done', () => {
    render(<TxStatusPopup />);
    act(() => pushProgressStep('Minting POAP', 'Preparing transaction…'));
    act(() => setTxPhase('proving'));
    advance(STEP_HANDOFF_MS);
    act(() => setTxPhase('idle'));
    act(() => {
      finishProgress({ kind: 'error', title: 'Error', message: 'Request failed' });
    });

    expect(screen.queryByText(/generating zero-knowledge proof/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Request failed');
  });

  it('lets callers fall back to a normal alert when no flow is in progress', () => {
    expect(finishProgress({ kind: 'error', title: 'Validation Error', message: 'x' })).toBe(false);
  });
});
