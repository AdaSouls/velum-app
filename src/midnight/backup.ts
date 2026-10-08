import { VISIBILITY_PREFIX } from './collection-share';
import { CREDENTIAL_PACKAGE_PREFIX } from './credential-store';
import { PROOF_HISTORY_PREFIX } from './proof-history';
import { ORGANIZER_PROFILE_PREFIX } from './organizer-profile';
import {
  getBackupContext,
  getBackupStatus,
  markBackedUp,
  markBackupDirty,
  onBackupDirty,
  setBackupContext,
  setBackupSync,
} from './backup-status';
import {
  getStoragePassword,
  hasStoragePassword,
  normalizeRecoveryCode,
  setStoragePassword,
  storeRecoveryCode,
} from './storage-password';

// Encrypted backup of everything that only exists in this browser: the private state (local_sk —
// the wallet's identity for this contract — plus its claimed-token cache) and the localStorage
// secrets that sit next to it (share-visibility choices, credential packages, proof history, the
// organizer profile).
//
// Encrypted here before it goes anywhere, with the wallet's key — which is also the user's recovery
// code (storage-password.ts): PBKDF2 → AES-GCM (WebCrypto).
// Pinata's "private" network only means "not on the public gateway" — it is not end-to-end
// encryption, which is why nothing reaches server/ unencrypted.
//
// The private state is read/written through the provider's own get/set for our one key rather than
// the SDK's exportPrivateStates/importPrivateStates: those decrypt EVERY entry in the wallet's store
// (all contract addresses), so a single entry left behind by an older deployment under another
// password would make every backup fail.

const IPFS_API_URL = process.env.REACT_APP_IPFS_API_URL || 'http://localhost:4000';

export const BACKUP_FORMAT = 'velum-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_KDF_ITERATIONS = 600_000;
const AUTO_BACKUP_DEBOUNCE_MS = 5_000;
const BACKED_UP_PREFIXES = [
  VISIBILITY_PREFIX,
  CREDENTIAL_PACKAGE_PREFIX,
  PROOF_HISTORY_PREFIX,
  ORGANIZER_PROFILE_PREFIX,
];

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  networkId: string;
  contractAddress: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string; // base64
  ciphertext: string; // base64
};

export type BackupPayload = {
  // Serialized with serializeState (keeps Uint8Array/bigint), null if nothing was stored yet.
  privateState: string | null;
  localStorage: Record<string, string>;
};

// The subset of the SDK's PrivateStateProvider this module needs.
export type BackupPrivateStateProvider = {
  get(privateStateId: string): Promise<unknown>;
  set(privateStateId: string, state: any): Promise<void>;
};

export class BackupPasswordError extends Error {
  constructor() {
    super('Wrong recovery code, or the backup is damaged.');
    this.name = 'BackupPasswordError';
  }
}

export class BackupFormatError extends Error {
  constructor(message = 'This is not a Velum backup file.') {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export class BackupContractMismatchError extends Error {
  constructor() {
    super('This backup belongs to a different deployment of the POAP contract, so it cannot be restored here.');
    this.name = 'BackupContractMismatchError';
  }
}

export class BackupNotFoundError extends Error {
  constructor() {
    super('No cloud backup found for this wallet and recovery code.');
    this.name = 'BackupNotFoundError';
  }
}

// ── Crypto ────────────────────────────────────────────────────────────────────

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const fromBase64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

async function passwordKeyMaterial(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
    'deriveBits',
  ]);
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    await passwordKeyMaterial(password),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackupPayload(
  payload: BackupPayload,
  password: string,
  meta: { networkId: string; contractAddress: string },
): Promise<BackupEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, BACKUP_KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    networkId: meta.networkId,
    contractAddress: meta.contractAddress,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: BACKUP_KDF_ITERATIONS, salt: toHex(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

export async function decryptBackupPayload(envelope: BackupEnvelope, password: string): Promise<BackupPayload> {
  const salt = new Uint8Array(Buffer.from(envelope.kdf.salt, 'hex'));
  const key = await deriveAesKey(password, salt, envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    throw new BackupPasswordError();
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload;
}

export function parseBackupEnvelope(text: string): BackupEnvelope {
  let parsed: Partial<BackupEnvelope>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError();
  }
  if (parsed?.format !== BACKUP_FORMAT || !parsed.kdf || !parsed.iv || !parsed.ciphertext) {
    throw new BackupFormatError();
  }
  if (parsed.version !== BACKUP_VERSION) {
    throw new BackupFormatError(`Unsupported backup version (${parsed.version}).`);
  }
  return parsed as BackupEnvelope;
}

// Cloud lookup key: derived from the recovery code AND the wallet, so knowing the wallet alone isn't
// enough to even download the ciphertext and attack it offline. Different salt string from the
// encryption key, so it reveals nothing about that key.
export async function computeBackupLookupId(password: string, coinPublicKey: string): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`velum-backup-lookup:${coinPublicKey}`),
      iterations: BACKUP_KDF_ITERATIONS,
    },
    await passwordKeyMaterial(password),
    256,
  );
  return toHex(new Uint8Array(bits));
}

// ── Create / apply ────────────────────────────────────────────────────────────

// JSON with the two non-JSON types the POAP private state holds (secretKey: Uint8Array,
// tokenId: bigint), tagged so they come back as the same types.
export function serializeState(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === 'bigint') return { __bigint: v.toString() };
    if (v instanceof Uint8Array) return { __bytes: toHex(v) };
    // A Buffer's own toJSON runs before this replacer and hands over { type: 'Buffer', data }.
    if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
      return { __bytes: toHex(Uint8Array.from(v.data)) };
    }
    return v;
  });
}

export function deserializeState(text: string): unknown {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === 'object' && typeof v.__bigint === 'string') return BigInt(v.__bigint);
    if (v && typeof v === 'object' && typeof v.__bytes === 'string') return new Uint8Array(Buffer.from(v.__bytes, 'hex'));
    return v;
  });
}

function collectLocalStorage(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && BACKED_UP_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      entries[key] = window.localStorage.getItem(key) ?? '';
    }
  }
  return entries;
}

export async function createBackup(
  provider: BackupPrivateStateProvider,
  privateStateKey: string,
  password: string,
  meta: { networkId: string; contractAddress: string },
): Promise<BackupEnvelope> {
  const state = await provider.get(privateStateKey);
  const payload: BackupPayload = {
    privateState: state ? serializeState(state) : null,
    localStorage: collectLocalStorage(),
  };
  return encryptBackupPayload(payload, password, meta);
}

// Decrypts and writes a backup into this browser. The private state is written through the
// provider, i.e. encrypted under the current session key. Overwrites whatever identity was stored
// for this contract.
export async function applyBackup(
  provider: BackupPrivateStateProvider,
  privateStateKey: string,
  envelope: BackupEnvelope,
  password: string,
  expectedContractAddress: string,
): Promise<void> {
  if (envelope.contractAddress !== expectedContractAddress) throw new BackupContractMismatchError();
  const payload = await decryptBackupPayload(envelope, password);
  if (payload.privateState) {
    await provider.set(privateStateKey, deserializeState(payload.privateState));
  }
  Object.entries(payload.localStorage ?? {}).forEach(([key, value]) => {
    if (BACKED_UP_PREFIXES.some((prefix) => key.startsWith(prefix))) window.localStorage.setItem(key, value);
  });
}

// ── Transport ─────────────────────────────────────────────────────────────────

export async function uploadCloudBackup(lookupId: string, envelope: BackupEnvelope): Promise<void> {
  const response = await fetch(`${IPFS_API_URL}/api/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookupId, envelope }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Cloud backup failed (${response.status}).`);
  }
}

export async function fetchCloudBackup(lookupId: string): Promise<BackupEnvelope> {
  const response = await fetch(`${IPFS_API_URL}/api/backup/${lookupId}`);
  if (response.status === 404) throw new BackupNotFoundError();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Could not load the cloud backup (${response.status}).`);
  }
  return parseBackupEnvelope(JSON.stringify(await response.json()));
}

export function downloadBackupFile(envelope: BackupEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `velum-backup-${envelope.createdAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Session (the connected wallet) ────────────────────────────────────────────

type BackupSession = {
  provider: BackupPrivateStateProvider;
  privateStateKey: string;
  coinPublicKey: string;
  contractAddress: string;
  networkId: string;
};

let session: BackupSession | null = null;
let autoBackupTimer: ReturnType<typeof setTimeout> | undefined;

function requireSession(): BackupSession {
  if (!session || !hasStoragePassword()) throw new Error('Connect your wallet first.');
  return session;
}

// Backs up the connected wallet with its key (= recovery code). `cloud` and `file` pick the
// destinations; at least one should be true.
export async function backupNow({ cloud, file }: { cloud: boolean; file: boolean }): Promise<BackupEnvelope> {
  const { provider, privateStateKey, coinPublicKey, contractAddress, networkId } = requireSession();
  const password = getStoragePassword();
  if (cloud) setBackupSync({ syncing: true });
  try {
    const envelope = await createBackup(provider, privateStateKey, password, { networkId, contractAddress });
    if (cloud) await uploadCloudBackup(await computeBackupLookupId(password, coinPublicKey), envelope);
    if (file) downloadBackupFile(envelope);
    markBackedUp();
    if (cloud) setBackupSync({ syncing: false });
    return envelope;
  } catch (error) {
    if (cloud) setBackupSync({ syncing: false, syncFailed: true });
    throw error;
  }
}

// Restores into the connected wallet's store. `recoveryCode` is the one the backup was made with.
// This browser adopts that code as the wallet's key (so the code the user saved keeps working for
// every later backup too). The caller has to reconnect afterwards: the running contract service
// still holds the previous identity.
export async function restoreIntoSession(
  recoveryCode: string,
  source: { kind: 'cloud' } | { kind: 'file'; text: string },
): Promise<void> {
  const { provider, privateStateKey, coinPublicKey, contractAddress } = requireSession();
  const code = normalizeRecoveryCode(recoveryCode);
  const envelope =
    source.kind === 'file'
      ? parseBackupEnvelope(source.text)
      : await fetchCloudBackup(await computeBackupLookupId(code, coinPublicKey));
  const previousKey = getStoragePassword();
  setStoragePassword(code);
  try {
    await applyBackup(provider, privateStateKey, envelope, code, contractAddress);
  } catch (error) {
    setStoragePassword(previousKey);
    throw error;
  }
  storeRecoveryCode(coinPublicKey, code, true);
  markBackupDirty();
}

function scheduleAutoBackup(): void {
  clearTimeout(autoBackupTimer);
  // The debounce counts as "saving" too — that's when the header shows the syncing icon.
  if (getBackupStatus()?.autoBackup) setBackupSync({ syncing: true });
  autoBackupTimer = setTimeout(() => {
    if (!session || !hasStoragePassword() || !getBackupStatus()?.autoBackup) {
      setBackupSync({ syncing: false });
      return;
    }
    backupNow({ cloud: true, file: false }).catch((error) => {
      // Stays "dirty", so the header keeps showing "Backup outdated" and the user can retry by hand.
      console.error('[backup] automatic cloud backup failed:', error);
    });
  }, AUTO_BACKUP_DEBOUNCE_MS);
}

let unsubscribeDirty: (() => void) | null = null;

export function startBackupSession(next: BackupSession): void {
  session = next;
  setBackupContext({ coinPublicKey: next.coinPublicKey, contractAddress: next.contractAddress });
  unsubscribeDirty?.();
  unsubscribeDirty = onBackupDirty(scheduleAutoBackup);
  // A wallet that was never backed up (new, migrated) or that changed while nothing could upload
  // (last session ended first, or the upload failed) gets backed up right away.
  const status = getBackupStatus();
  if (status && (!status.lastBackupAt || status.dirty)) scheduleAutoBackup();
}

export function endBackupSession(): void {
  clearTimeout(autoBackupTimer);
  unsubscribeDirty?.();
  unsubscribeDirty = null;
  session = null;
  if (getBackupContext()) setBackupContext(null);
}
