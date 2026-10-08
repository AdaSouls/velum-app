// Turns whatever a failed flow threw into one sentence a user can act on. Raw errors from the
// Midnight stack are unreadable ("Unexpected error submitting scoped transaction '<unnamed>':
// Error: 'check' returned an error: TypeError: Failed to fetch") and the useful part is often
// buried in a nested `cause`, so this looks through the whole chain for something it recognizes:
// a contract assert, an unreachable proof server, a wallet rejection, and so on. A message that
// already reads like a sentence (most errors this app throws itself) passes through unchanged;
// anything else falls back to the caller's own message. The raw error still goes to the console
// from each catch block, so nothing is lost for debugging.
import { Cause } from 'effect';

const PROOF_SERVER_URL = process.env.REACT_APP_MIDNIGHT_PROOF_SERVER_URL || 'http://localhost:6300';

// Every assert in poap.compact, as the contract words it (the runtime throws
// "failed assert: <message>").
const CONTRACT_MESSAGES: Record<string, string> = {
  'Contract is paused': 'Velum is paused by the admin right now. Try again later.',
  'Only admin can pause': 'Only the Velum admin can do this.',
  'Only admin can unpause': 'Only the Velum admin can do this.',
  'Only admin can register issuers': 'Only the Velum admin can register organizers.',
  'Only admin can deactivate issuers': 'Only the Velum admin can block organizers.',
  'Only admin can reactivate events': 'Only the Velum admin can reactivate an event.',
  'Issuer already registered': 'This organizer is already registered.',
  'Issuer is deactivated':
    'This organizer has been blocked by the admin, so no new events or POAPs can be issued under it.',
  'Event already exists': 'This event already exists.',
  'Event does not exist': "This event doesn't exist on-chain.",
  'Not authorized': "Only this event's organizer can do this.",
  'Not authorized to mint for this event': "Only this event's organizer can issue its POAPs.",
  'Event is not active': 'This event has been deactivated.',
  'Event has expired': 'This event has expired.',
  'Event has reached maximum supply': 'This event has reached its maximum supply.',
  'Event requires organizer to mint': 'This event is invite-only: its organizer issues the POAPs directly.',
  'Wallet already claimed this event': 'This wallet already has a POAP for this event.',
  'Organizer cannot claim their own event': "You organize this event, so you can't claim it yourself.",
  'Cannot mint to yourself': "You can't issue a POAP to yourself. Use the recipient's key.",
  'Credential tree is full': "This contract can't issue any more credentials.",
  'Token does not exist': "This POAP doesn't exist on-chain.",
  'Unknown token': "This POAP doesn't exist on-chain.",
  'Token already burned': 'This POAP has already been burned.',
  'Token burned': 'This POAP has been burned.',
  'Not authorized to burn this token': 'Only the holder, its organizer or the admin can burn this POAP.',
  'Not the owner': "This POAP isn't held by your wallet.",
  'Token is not for the requested event': 'This POAP is for a different event than the one requested.',
  'Event has no private metadata': 'This event has no private details to reveal.',
  'Token has no private metadata': 'This POAP has no private details to reveal.',
  'Value does not match the committed metadata': "These details don't match what was committed on-chain.",
  'Unknown disclosure request': "This verification request doesn't exist.",
  'Request already published': 'This verification request has already been published.',
  'Disclosure already redeemed for this request': "You've already answered this verification request.",
  'Event has no committed attributes': "This event's credentials have no private fields to prove.",
  'Attribute not committed for this event': "Your credential's details don't match what was committed on-chain.",
  'Path does not match the recomputed leaf': "Your credential's details don't match what was committed on-chain.",
  "Path does not match this holder's credential":
    "Your credential's details don't match what was committed on-chain.",
  'Set path does not match the hidden value': "Your credential's details don't match what was committed on-chain.",
  'Credential not in tree': "Your credential's details don't match what was committed on-chain.",
  'Value is not a member of the requested set': "Your credential doesn't meet this request's condition.",
};

const USER_REJECTION_CODES = ['Rejected', 'PermissionRejected'];

// Every readable piece of the error and its nested causes. compact-js's FiberFailure has an empty
// `.message` and keeps the real failure in an Effect Cause, which Cause.pretty renders.
function collectTexts(error: unknown, depth = 0, out: string[] = []): string[] {
  if (error == null || depth > 6) return out;
  if (typeof error === 'string') {
    out.push(error);
    return out;
  }
  if (typeof error !== 'object') return out;
  const { message, reason, code, cause } = error as { message?: unknown; reason?: unknown; code?: unknown; cause?: unknown };
  for (const value of [message, reason, code]) {
    if (typeof value === 'string' && value) out.push(value);
  }
  if (cause && typeof cause === 'object' && (cause as { _id?: unknown })._id === 'Cause') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.push(Cause.pretty(cause as any));
    } catch {
      // Not renderable; the other texts still apply.
    }
  } else {
    collectTexts(cause, depth + 1, out);
  }
  return out;
}

function contractMessage(text: string): string | null {
  const match = /failed assert: ([^\n]+)/.exec(text);
  if (!match) return null;
  const raw = match[1].trim();
  const known = Object.keys(CONTRACT_MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((key) => raw.startsWith(key));
  return known ? CONTRACT_MESSAGES[known] : `The contract rejected this transaction: ${raw}`;
}

function proofServerMessage(): string {
  return /localhost|127\.0\.0\.1/.test(PROOF_SERVER_URL)
    ? `Couldn't reach the proof server, which creates the zero-knowledge proof for this transaction. Make sure it's running at ${PROOF_SERVER_URL.replace(/^https?:\/\//, '')} and try again.`
    : "Couldn't reach the proof server, which creates the zero-knowledge proof for this transaction. Try again in a moment.";
}

// A message this app wrote itself (or any plain sentence) vs. a library's internal error text.
function looksTechnical(text: string): boolean {
  return (
    !/\s/.test(text.trim()) ||
    text.length > 180 ||
    /\b(TypeError|ReferenceError|SyntaxError|FiberFailure|Unexpected error|returned an error|wasm|undefined|null|NaN|0x[0-9a-f]{6,}|[0-9a-f]{40,})\b/i.test(
      text,
    ) ||
    /[{}[\]<>]|=>|\bat \w/.test(text)
  );
}

export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const texts = collectTexts(error);
  const all = texts.join('\n');

  for (const text of texts) {
    const fromContract = contractMessage(text);
    if (fromContract) return fromContract;
  }

  const code = (error as { code?: unknown } | null)?.code;
  if ((typeof code === 'string' && USER_REJECTION_CODES.includes(code)) || /user (rejected|denied|cancel+ed)|rejected by (the )?user|request (was )?rejected/i.test(all)) {
    return 'You cancelled the request in your wallet.';
  }
  if (code === 'Disconnected' || /disconnected/i.test(all)) {
    return 'The connection to your wallet was lost. Reconnect it and try again.';
  }
  // The wallet (1AM) sends one transaction at a time: the previous one hasn't confirmed yet.
  if (/transaction is already pending/i.test(all)) {
    return 'Your wallet is still sending your previous transaction. Wait a minute for it to confirm, then try again.';
  }
  if (/mismatched verifier keys/i.test(all)) {
    return "This version of Velum doesn't match the deployed contract, so it can't connect. Reload the page; if it keeps happening, the app needs updating.";
  }
  if (/'(check|prove)' returned an error/i.test(all)) {
    return /failed to fetch|networkerror|load failed|ECONNREFUSED/i.test(all)
      ? proofServerMessage()
      : "The proof server couldn't create the proof for this transaction. Try again; if it keeps failing, the app may be out of sync with the contract.";
  }
  if (/insufficient|not enough (funds|dust|balance|tokens)|balance (is )?too low/i.test(all)) {
    return "Your wallet doesn't have enough DUST to pay the transaction fee.";
  }
  if (/timed? ?out/i.test(all)) {
    return 'The network took too long to respond. Check whether it went through before trying again.';
  }
  if (/Indexer request failed/i.test(all)) {
    return "Couldn't load data from the Velum indexer. Try again in a moment.";
  }
  if (/failed to fetch|networkerror|load failed|ECONNREFUSED/i.test(all)) {
    return "Couldn't reach one of Velum's services. Check your connection and try again.";
  }

  const own = texts.find((text) => text.trim());
  return own && !looksTechnical(own) ? own : fallback;
}
