// The links that replace copy-pasting keys (1 and 2 when a credential is issued, 3 after):
//   1. Invite link — the organizer shares it from a Credential event: /app/key#organizer=…&event=…
//      Opening it generates the holder's code for that organizer (keyInvite.jsx).
//   2. Mint link — the holder sends it back: /app/mint#to=<holder code>[&event=…]
//      Opening it opens Mint POAP with the recipient (and event) filled in (mintLink.jsx).
// Everything rides in the URL fragment, which the browser never sends to a server. Nothing in them
// is secret anyway: the organizer's pk is public, and the holder code is a per-organizer pseudonym
// plus a public encryption key (credential-crypto.ts).
import { formatHolderCode, parseHolderCode } from './credential-crypto';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams((hash || '').replace(/^#/, ''));
}

export function inviteLink(origin: string, organizerPkHex: string, eventIdHex: string): string {
  return `${origin}/app/key#organizer=${organizerPkHex}&event=${eventIdHex}`;
}

export function parseInviteFragment(hash: string): { organizerPkHex: string; eventIdHex: string | null } | null {
  const params = fragmentParams(hash);
  const organizer = params.get('organizer') || '';
  const event = params.get('event');
  if (!HEX_64.test(organizer)) return null;
  if (event !== null && !HEX_64.test(event)) return null;
  return { organizerPkHex: organizer.toLowerCase(), eventIdHex: event ? event.toLowerCase() : null };
}

export function mintLink(origin: string, holderCode: string, eventIdHex?: string | null): string {
  const event = eventIdHex ? `&event=${eventIdHex}` : '';
  return `${origin}/app/mint#to=${holderCode}${event}`;
}

export function parseMintFragment(hash: string): { holderCode: string; eventIdHex: string | null } | null {
  const params = fragmentParams(hash);
  const to = params.get('to') || '';
  const event = params.get('event');
  if (!parseHolderCode(to)) return null;
  if (event !== null && !HEX_64.test(event)) return null;
  return { holderCode: to.trim(), eventIdHex: event ? event.toLowerCase() : null };
}

// 3. Request link — a holder hands it to whoever wants to ask about a private detail of their
//    credential: /app/request#event=<eventId>&to=<holder pk>. Opening it opens Ask for a Disclosure
//    with both filled in (requestLink.jsx). The holder pk is their pseudonym under the event's
//    organizer, already public as their token's owner.
export function requestLink(origin: string, eventIdHex: string, holderPkHex: string): string {
  return `${origin}/app/request#event=${eventIdHex}&to=${holderPkHex}`;
}

export function parseRequestFragment(hash: string): { eventIdHex: string; holderPkHex: string } | null {
  const params = fragmentParams(hash);
  const event = params.get('event') || '';
  const to = params.get('to') || '';
  if (!HEX_64.test(event) || !HEX_64.test(to)) return null;
  return { eventIdHex: event.toLowerCase(), holderPkHex: to.toLowerCase() };
}

export type PastedInput =
  | { kind: 'invite' | 'mint' | 'request'; route: string }
  | { kind: 'key'; organizerPkHex: string };

// What someone pasted into "Paste Link" (getHolderKey.jsx): an invite link, a mint link, or an
// organizer's bare key. Links come back as an in-app route (path + fragment) so opening them is a
// client-side navigation that keeps the wallet connected. Their origin is ignored, so a link built
// on another deployment of the portal still opens here.
export function parsePastedInput(text: string): PastedInput | null {
  const trimmed = (text || '').trim();
  if (HEX_64.test(trimmed)) return { kind: 'key', organizerPkHex: trimmed.toLowerCase() };
  let url: URL;
  try {
    url = new URL(trimmed, 'http://paste.invalid');
  } catch {
    return null;
  }
  if (url.pathname === '/app/key' && parseInviteFragment(url.hash)) return { kind: 'invite', route: `/app/key${url.hash}` };
  if (url.pathname === '/app/mint' && parseMintFragment(url.hash)) return { kind: 'mint', route: `/app/mint${url.hash}` };
  if (url.pathname === '/app/request' && parseRequestFragment(url.hash)) {
    return { kind: 'request', route: `/app/request${url.hash}` };
  }
  return null;
}

// Mint POAP's and Ask for a Disclosure's recipient fields take either the holder code or the whole
// mint/request link it came in.
export function holderCodeFromInput(text: string): string {
  const pasted = parsePastedInput(text);
  if (!pasted || pasted.kind === 'key') return text;
  const hash = pasted.route.slice(pasted.route.indexOf('#'));
  if (pasted.kind === 'mint') return parseMintFragment(hash)?.holderCode ?? text;
  if (pasted.kind === 'request') return parseRequestFragment(hash)?.holderPkHex ?? text;
  return text;
}

type HolderCodeService = {
  getHolderPkHex(issuerId: Uint8Array): Promise<string>;
  getEncryptionKeyPair(issuerId: Uint8Array): Promise<{ publicKeyHex: string }>;
};

// This wallet's code for one organizer: `<holderPk>.<encryptionKey>`, both derived from local_sk,
// so generating it again always gives the same value (see getHolderKey.jsx).
export async function generateHolderCode(service: HolderCodeService, organizerPkHex: string): Promise<string> {
  const organizerId = Uint8Array.from(Buffer.from(organizerPkHex, 'hex'));
  const holderPkHex = await service.getHolderPkHex(organizerId);
  const { publicKeyHex } = await service.getEncryptionKeyPair(organizerId);
  return formatHolderCode(holderPkHex, publicKeyHex);
}
