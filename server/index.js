// Local-only proxy: holds the Pinata secret server-side so it never ends up in the frontend's
// public JS bundle. The frontend's src/services/ipfs.service.ts calls these two routes instead of
// Pinata directly. See the "structured event metadata via IPFS" plan for the full architecture
// note (server/ is a stand-in for wherever this ends up hosted for real later — same API shape).
require('dotenv/config');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const PORT = process.env.PORT || 4000;
const PINATA_JWT = process.env.PINATA_JWT;
const CORS_ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || 'http://localhost:3000';
const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';
const PINATA_GATEWAYS_URL = 'https://api.pinata.cloud/v3/gateways';
const PINATA_SIGNED_URL_URL = 'https://api.pinata.cloud/v3/files/private/download_link';
const PINATA_PRIVATE_FILES_URL = 'https://api.pinata.cloud/v3/files/private';
// How long a signed URL stays valid — just long enough for the frontend to fetch it once right
// after asking, not meant to be cached/reused by the client.
const SIGNED_URL_EXPIRES_SECONDS = 300;

if (!PINATA_JWT) {
  console.error('[ipfs-server] Missing PINATA_JWT env var — copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: CORS_ALLOWED_ORIGIN }));
// Encrypted backups (see /api/backup below) are the largest JSON bodies this server takes.
app.use(express.json({ limit: '1mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function pinToIpfs(blob, filename, network, keyvalues) {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('network', network);
  if (keyvalues) form.append('keyvalues', JSON.stringify(keyvalues));

  const response = await fetch(PINATA_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pinata upload failed (${response.status}): ${text || response.statusText}`);
  }

  const { data } = await response.json();
  return { uri: `ipfs://${data.cid}`, id: data.id, cid: data.cid };
}

app.post('/api/ipfs/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image file provided (expected multipart field "image")' });
    return;
  }
  try {
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    const { uri } = await pinToIpfs(blob, req.file.originalname || 'image', 'public');
    res.json({ uri });
  } catch (error) {
    console.error('[ipfs-server] upload-image failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ipfs/upload-json', async (req, res) => {
  try {
    const blob = new Blob([JSON.stringify(req.body)], { type: 'application/json' });
    const { uri } = await pinToIpfs(blob, 'metadata.json', 'public');
    res.json({ uri });
  } catch (error) {
    console.error('[ipfs-server] upload-json failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Private-event free-text metadata (see poap.compact's privateMetadataCommit/
// computePrivateMetadataCommit/revealPrivateMetadata) — same shape as /upload-json, but pinned to
// Pinata's private network so the content is genuinely unreachable from any public IPFS gateway
// until the frontend explicitly asks this server for a signed URL (see /private-signed-url below).
// Verified directly against the real Pinata API: private-network uploads still produce a CID whose
// digest equals sha256(the exact uploaded bytes) — same as public network — which is what lets the
// frontend compute `value` (the on-chain commit input) locally and reconstruct this same CID later
// from nothing but those 32 bytes.
app.post('/api/ipfs/upload-json-private', async (req, res) => {
  try {
    const blob = new Blob([JSON.stringify(req.body)], { type: 'application/json' });
    const { uri } = await pinToIpfs(blob, 'private-metadata.json', 'private');
    res.json({ uri });
  } catch (error) {
    console.error('[ipfs-server] upload-json-private failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// RFC4648 base32 (lowercase, no padding) — the alphabet multibase's "b" prefix uses.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
function base32Encode(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  // Pad the bit string out to a multiple of 5 so the final group encodes cleanly; multibase's
  // base32 variant is unpadded (no trailing '='), so we just stop once we've consumed every bit.
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

// Reconstructs the ipfs:// CID for a private-metadata blob purely from its committed digest — no
// URI is ever stored anywhere. Fixed header matches exactly what Pinata's v3 API returns for a
// single JSON upload (confirmed empirically this session, not assumed): CIDv1 (0x01), codec=raw
// (0x55), hash-fn=sha2-256 (0x12), digest length=32 (0x20). See src/utils/cid.ts on the frontend
// side for the matching encoder — kept as two independent implementations (this is a separate JS
// runtime/package from the frontend) but must stay byte-for-byte identical if either ever changes.
const CID_HEADER = [0x01, 0x55, 0x12, 0x20];
function cidFromDigestHex(digestHex) {
  const digest = Buffer.from(digestHex, 'hex');
  if (digest.length !== 32) throw new Error('Expected a 32-byte (64 hex char) digest');
  return 'b' + base32Encode([...CID_HEADER, ...digest]);
}

// Cached for the process lifetime — this account has exactly one gateway, and it doesn't change
// between requests. Re-fetched lazily rather than hardcoded so a gateway change on Pinata's side
// doesn't silently start producing dead signed URLs.
let cachedGatewayDomain = null;
async function getGatewayDomain() {
  if (cachedGatewayDomain) return cachedGatewayDomain;
  const response = await fetch(PINATA_GATEWAYS_URL, { headers: { Authorization: `Bearer ${PINATA_JWT}` } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pinata gateway lookup failed (${response.status}): ${text || response.statusText}`);
  }
  const { data } = await response.json();
  const domain = data?.rows?.[0]?.domain;
  if (!domain) throw new Error('No Pinata gateway configured for this account');
  cachedGatewayDomain = domain;
  return domain;
}

// Lets the frontend read PUBLIC metadata/images through this account's own dedicated gateway
// instead of the shared gateway.pinata.cloud one — the shared gateway 404s on recently-pinned
// content (propagation lag) and rate-limits (429) under normal browsing, while the dedicated
// gateway serves this account's own pins immediately and isn't shared with other Pinata users.
// No secret in the response, just the domain string, so this route needs no auth.
app.get('/api/ipfs/gateway-domain', async (req, res) => {
  try {
    const domain = await getGatewayDomain();
    res.json({ domain });
  } catch (error) {
    console.error('[ipfs-server] gateway-domain failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Short-lived signed URL for one private-network file of this account.
async function createSignedUrl(cid) {
  const gatewayDomain = await getGatewayDomain();
  const response = await fetch(PINATA_SIGNED_URL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `https://${gatewayDomain}.mypinata.cloud/files/${cid}`,
      expires: SIGNED_URL_EXPIRES_SECONDS,
      date: Math.floor(Date.now() / 1000),
      method: 'GET',
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pinata signed-URL request failed (${response.status}): ${text || response.statusText}`);
  }
  const { data: url } = await response.json();
  return url;
}

// Given the 32-byte `value` a client already has (either because it's the organizer who computed
// it at createEvent time, or because it read it off the public ledger's eventRevealedMetadata
// after a reveal — see contract.service.ts), mints a short-lived signed URL for the matching
// private-network file. No on-chain/reveal check happens here on purpose: possessing `value` is
// already the authorization (same "knowing the commit opening IS the authorization" model the
// contract itself uses for revealPrivateMetadata) — value is a persistentCommit-strength 256-bit
// value, not brute-forceable, so this endpoint needs no additional gate.
app.post('/api/ipfs/private-signed-url', async (req, res) => {
  try {
    const { value } = req.body;
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
      res.status(400).json({ error: 'Expected a 32-byte hex "value" (64 hex characters)' });
      return;
    }
    const url = await createSignedUrl(cidFromDigestHex(value));
    res.json({ url });
  } catch (error) {
    console.error('[ipfs-server] private-signed-url failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Encrypted backups ──────────────────────────────────────────────────────────
//
// The frontend (src/midnight/backup.ts) encrypts the backup in the browser with the user's password
// before sending it; this server only ever sees ciphertext. Files are tagged with a Pinata keyvalue
// `velumBackup=<lookupId>` — lookupId is derived from the password + wallet, so someone who
// only knows the wallet can't even fetch the ciphertext. Filter syntax (metadata[key]=value on
// GET /v3/files/private) verified against the real Pinata API on 2026-09-23.
const LOOKUP_ID_PATTERN = /^[0-9a-f]{64}$/;
const BACKUP_KEYVALUE = 'velumBackup';

async function listPrivateFiles(keyName, value) {
  const params = new URLSearchParams({ [`metadata[${keyName}]`]: value, order: 'DESC', limit: '20' });
  const response = await fetch(`${PINATA_PRIVATE_FILES_URL}?${params}`, {
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pinata list failed (${response.status}): ${text || response.statusText}`);
  }
  const { data } = await response.json();
  return data?.files ?? [];
}

function listBackups(lookupId) {
  return listPrivateFiles(BACKUP_KEYVALUE, lookupId);
}

async function downloadPrivateJson(cid) {
  const response = await fetch(await createSignedUrl(cid));
  if (!response.ok) throw new Error(`Private file download failed (${response.status})`);
  return response.json();
}

app.post('/api/backup', async (req, res) => {
  try {
    const { lookupId, envelope } = req.body ?? {};
    if (typeof lookupId !== 'string' || !LOOKUP_ID_PATTERN.test(lookupId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex "lookupId"' });
      return;
    }
    if (envelope?.format !== 'velum-backup' || typeof envelope.ciphertext !== 'string') {
      res.status(400).json({ error: 'Expected an encrypted Velum backup envelope' });
      return;
    }
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    const { id } = await pinToIpfs(blob, `velum-backup-${lookupId}.json`, 'private', {
      [BACKUP_KEYVALUE]: lookupId,
    });
    // Keep only the newest backup per lookupId. Best-effort: a failed cleanup doesn't fail the backup.
    try {
      const older = (await listBackups(lookupId)).filter((file) => file.id !== id);
      await Promise.all(
        older.map((file) =>
          fetch(`${PINATA_PRIVATE_FILES_URL}/${file.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${PINATA_JWT}` },
          }),
        ),
      );
    } catch (cleanupError) {
      console.error('[ipfs-server] backup cleanup failed:', cleanupError);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[ipfs-server] backup upload failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/backup/:lookupId', async (req, res) => {
  try {
    const { lookupId } = req.params;
    if (!LOOKUP_ID_PATTERN.test(lookupId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex lookupId' });
      return;
    }
    const [latest] = await listBackups(lookupId);
    if (!latest) {
      res.status(404).json({ error: 'No backup found' });
      return;
    }
    res.json(await downloadPrivateJson(latest.cid));
  } catch (error) {
    console.error('[ipfs-server] backup fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Credential delivery ────────────────────────────────────────────────────────
//
// When an organizer issues a credential with private attributes (mintPoap.jsx), their browser
// encrypts the openings (value/rand per field) for the recipient's per-organizer encryption key
// (src/midnight/credential-crypto.ts) and posts the sealed envelope here. lookupId =
// sha256(domain, holderPk, eventId), which the holder can recompute from their own token.
// Nothing is deleted on a new upload: anyone can post under a lookupId, so the holder's browser
// downloads every candidate and keeps the one that decrypts and matches the credential on-chain.
const DELIVERY_KEYVALUE = 'velumCredential';
const MAX_CANDIDATES = 10;

app.post('/api/credential-delivery', async (req, res) => {
  try {
    const { lookupId, envelope } = req.body ?? {};
    if (typeof lookupId !== 'string' || !LOOKUP_ID_PATTERN.test(lookupId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex "lookupId"' });
      return;
    }
    if (envelope?.format !== 'velum-credential' || typeof envelope.ciphertext !== 'string') {
      res.status(400).json({ error: 'Expected an encrypted Velum credential envelope' });
      return;
    }
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    await pinToIpfs(blob, `velum-credential-${lookupId}.json`, 'private', { [DELIVERY_KEYVALUE]: lookupId });
    res.json({ ok: true });
  } catch (error) {
    console.error('[ipfs-server] credential delivery upload failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/credential-delivery/:lookupId', async (req, res) => {
  try {
    const { lookupId } = req.params;
    if (!LOOKUP_ID_PATTERN.test(lookupId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex lookupId' });
      return;
    }
    const files = (await listPrivateFiles(DELIVERY_KEYVALUE, lookupId)).slice(0, MAX_CANDIDATES);
    const envelopes = await Promise.all(files.map((file) => downloadPrivateJson(file.cid).catch(() => null)));
    res.json({ envelopes: envelopes.filter(Boolean) });
  } catch (error) {
    console.error('[ipfs-server] credential delivery fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Credential update requests ─────────────────────────────────────────────────
//
// A holder asking the organizer to re-issue a credential (src/midnight/credential-update.ts) seals
// the request for the organizer's inbox key and posts it here, keyed by payloadCommit = sha256 of
// the envelope — the same value requestCredentialUpdate puts on-chain, so the organizer finds it
// from the indexer's pending list. Anyone can post under a commitment; the organizer's browser keeps
// only an envelope whose own hash is the commitment and that opens with its key.
const UPDATE_KEYVALUE = 'velumUpdateRequest';

app.post('/api/credential-update', async (req, res) => {
  try {
    const { payloadCommit, envelope } = req.body ?? {};
    if (typeof payloadCommit !== 'string' || !LOOKUP_ID_PATTERN.test(payloadCommit)) {
      res.status(400).json({ error: 'Expected a 32-byte hex "payloadCommit"' });
      return;
    }
    if (envelope?.format !== 'velum-credential' || typeof envelope.ciphertext !== 'string') {
      res.status(400).json({ error: 'Expected an encrypted Velum envelope' });
      return;
    }
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    await pinToIpfs(blob, `velum-update-${payloadCommit}.json`, 'private', { [UPDATE_KEYVALUE]: payloadCommit });
    res.json({ ok: true });
  } catch (error) {
    console.error('[ipfs-server] update request upload failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/credential-update/:payloadCommit', async (req, res) => {
  try {
    const { payloadCommit } = req.params;
    if (!LOOKUP_ID_PATTERN.test(payloadCommit)) {
      res.status(400).json({ error: 'Expected a 32-byte hex payloadCommit' });
      return;
    }
    const files = (await listPrivateFiles(UPDATE_KEYVALUE, payloadCommit)).slice(0, MAX_CANDIDATES);
    const envelopes = await Promise.all(files.map((file) => downloadPrivateJson(file.cid).catch(() => null)));
    res.json({ envelopes: envelopes.filter(Boolean) });
  } catch (error) {
    console.error('[ipfs-server] update request fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Disclosure request sets ────────────────────────────────────────────────────
//
// A disclosure request only puts the ROOT of its accepted-values set on-chain. Whoever answers
// needs the values themselves to build the membership path, so publishDisclosureRequest.jsx posts
// the question's RULE here, keyed by requestId: either a short list ({ op: 'oneOf', values }) or a
// number/date range that every browser expands itself (src/midnight/attribute-types.ts) — a range
// can accept tens of thousands of values, too many to post. Not secret (the holder has to see the
// question to answer it). Same anyone-can-post caveat as above: the client expands the rule,
// recomputes the root and ignores rules that don't match the request's on-chain setRoot.
// Older entries stored a bare { members } list; they're served back as a oneOf rule.
const SET_KEYVALUE = 'velumRequestSet';
const MAX_SET_MEMBERS = 64;
const MAX_RULE_BYTES = 4096;
const RANGE_OPS = { number: ['gte', 'lte', 'between'], date: ['onOrAfter', 'onOrBefore', 'between'] };

function validRule(rule) {
  if (!rule || typeof rule !== 'object' || JSON.stringify(rule).length > MAX_RULE_BYTES) return false;
  // An identity check (src/midnight/identity.ts): only the kind of question, never the document.
  if (rule.op === 'identity') return Object.keys(rule).length === 1;
  if (rule.op === 'oneOf') {
    return (
      Array.isArray(rule.values) &&
      rule.values.length > 0 &&
      rule.values.length <= MAX_SET_MEMBERS &&
      rule.values.every((v) => typeof v === 'string' && Buffer.byteLength(v.trim(), 'utf8') <= 32)
    );
  }
  if (rule.type === 'number') {
    return RANGE_OPS.number.includes(rule.op) && Number.isSafeInteger(rule.min) && Number.isSafeInteger(rule.max);
  }
  if (rule.type === 'date') {
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return RANGE_OPS.date.includes(rule.op) && isDate(rule.from) && isDate(rule.to);
  }
  return false;
}

app.post('/api/disclosure-sets', async (req, res) => {
  try {
    const { requestId, members } = req.body ?? {};
    const rule = req.body?.rule ?? (Array.isArray(members) ? { op: 'oneOf', values: members } : null);
    if (typeof requestId !== 'string' || !LOOKUP_ID_PATTERN.test(requestId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex "requestId"' });
      return;
    }
    if (!validRule(rule)) {
      res.status(400).json({
        error: `Expected a rule: 1-${MAX_SET_MEMBERS} values of at most 32 bytes each, or a number/date range`,
      });
      return;
    }
    const blob = new Blob([JSON.stringify({ requestId, rule })], { type: 'application/json' });
    await pinToIpfs(blob, `velum-request-set-${requestId}.json`, 'private', { [SET_KEYVALUE]: requestId });
    res.json({ ok: true });
  } catch (error) {
    console.error('[ipfs-server] disclosure set upload failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/disclosure-sets/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!LOOKUP_ID_PATTERN.test(requestId)) {
      res.status(400).json({ error: 'Expected a 32-byte hex requestId' });
      return;
    }
    const files = (await listPrivateFiles(SET_KEYVALUE, requestId)).slice(0, MAX_CANDIDATES);
    const entries = await Promise.all(files.map((file) => downloadPrivateJson(file.cid).catch(() => null)));
    const rules = entries
      .map((entry) => entry?.rule ?? (Array.isArray(entry?.members) ? { op: 'oneOf', values: entry.members } : null))
      .filter(validRule);
    res.json({ rules });
  } catch (error) {
    console.error('[ipfs-server] disclosure set fetch failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ipfs-server] listening on http://localhost:${PORT}`);
});
