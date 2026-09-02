import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { VirtualsProtocolError } from './virtuals-errors.js';

const CREDENTIAL_ID = 'virtuals-oauth-discovery';
const ENCRYPTION_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;

const plaintextSchema = z.object({
  schemaVersion: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export interface VirtualsDiscoveryCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface VirtualsDiscoveryCredentialRecord {
  readonly id: string;
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authenticationTag: Uint8Array;
  readonly encryptionVersion: number;
  readonly revision: number;
  readonly accessTokenExpiresAt: Date | null;
  readonly updatedAt: Date;
}

export interface VirtualsDiscoveryCredentialRepository {
  find(id: string): Promise<VirtualsDiscoveryCredentialRecord | null>;
  initialize(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
  ): Promise<VirtualsDiscoveryCredentialRecord>;
  replace(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
    expectedRevision: number,
  ): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface VirtualsDiscoveryCredentialPersistence {
  persistRotated(credentials: VirtualsDiscoveryCredentials): Promise<void>;
}

function safeConfigurationError(): VirtualsProtocolError {
  return new VirtualsProtocolError(
    'VIRTUALS_CONFIGURATION_ERROR',
    'Durable Virtuals discovery credentials are unavailable',
    false,
  );
}

function safePersistenceError(): VirtualsProtocolError {
  return new VirtualsProtocolError(
    'VIRTUALS_DISCOVERY_FAILED',
    'Rotated Virtuals discovery credentials could not be persisted',
    true,
  );
}

function associatedData(id: string, version: number): Buffer {
  return Buffer.from(`continuity:${id}:v${version}`, 'utf8');
}

export function decodeCredentialEncryptionKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw safeConfigurationError();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw safeConfigurationError();
  return key;
}

export function accessTokenExpiry(accessToken: string): Date | null {
  try {
    const segment = accessToken.split('.')[1];
    if (!segment) return null;
    const payload: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || !('exp' in payload)) return null;
    const exp = (payload as { readonly exp?: unknown }).exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    const expiry = new Date(exp * 1000);
    return Number.isNaN(expiry.getTime()) ? null : expiry;
  } catch {
    return null;
  }
}

function encrypt(
  credentials: VirtualsDiscoveryCredentials,
  key: Buffer,
  revision: number,
): Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTHENTICATION_TAG_BYTES });
  cipher.setAAD(associatedData(CREDENTIAL_ID, ENCRYPTION_VERSION));
  const plaintext = Buffer.from(JSON.stringify({ schemaVersion: 1, ...credentials }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    id: CREDENTIAL_ID,
    ciphertext,
    iv,
    authenticationTag: cipher.getAuthTag(),
    encryptionVersion: ENCRYPTION_VERSION,
    revision,
    accessTokenExpiresAt: accessTokenExpiry(credentials.accessToken),
  };
}

function decrypt(
  record: VirtualsDiscoveryCredentialRecord,
  key: Buffer,
): VirtualsDiscoveryCredentials {
  try {
    if (
      record.id !== CREDENTIAL_ID ||
      record.encryptionVersion !== ENCRYPTION_VERSION ||
      record.iv.byteLength !== IV_BYTES ||
      record.authenticationTag.byteLength !== AUTHENTICATION_TAG_BYTES
    ) {
      throw new Error('Invalid credential envelope');
    }
    const decipher = createDecipheriv(ALGORITHM, key, record.iv, {
      authTagLength: AUTHENTICATION_TAG_BYTES,
    });
    decipher.setAAD(associatedData(record.id, record.encryptionVersion));
    decipher.setAuthTag(record.authenticationTag);
    const plaintext = Buffer.concat([
      decipher.update(record.ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const parsed = plaintextSchema.parse(JSON.parse(plaintext));
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    throw safeConfigurationError();
  }
}

export class EncryptedVirtualsDiscoveryCredentialStore implements VirtualsDiscoveryCredentialPersistence {
  private constructor(
    private readonly repository: VirtualsDiscoveryCredentialRepository,
    private readonly key: Buffer,
    private revision: number,
  ) {}

  static async initialize(
    repository: VirtualsDiscoveryCredentialRepository,
    encodedKey: string,
    bootstrap: VirtualsDiscoveryCredentials,
  ): Promise<{
    readonly store: EncryptedVirtualsDiscoveryCredentialStore;
    readonly credentials: VirtualsDiscoveryCredentials;
    readonly source: 'durable' | 'bootstrap';
  }> {
    const key = decodeCredentialEncryptionKey(encodedKey);
    try {
      const existing = await repository.find(CREDENTIAL_ID);
      if (existing) {
        return {
          store: new EncryptedVirtualsDiscoveryCredentialStore(repository, key, existing.revision),
          credentials: decrypt(existing, key),
          source: 'durable',
        };
      }
      const initialized = await repository.initialize(encrypt(bootstrap, key, 1));
      return {
        store: new EncryptedVirtualsDiscoveryCredentialStore(repository, key, initialized.revision),
        credentials: decrypt(initialized, key),
        source: initialized.revision === 1 ? 'bootstrap' : 'durable',
      };
    } catch (error) {
      if (error instanceof VirtualsProtocolError) throw error;
      throw safeConfigurationError();
    }
  }

  async persistRotated(credentials: VirtualsDiscoveryCredentials): Promise<void> {
    const nextRevision = this.revision + 1;
    try {
      await this.repository.replace(encrypt(credentials, this.key, nextRevision), this.revision);
      this.revision = nextRevision;
    } catch {
      throw safePersistenceError();
    }
  }
}

export const virtualsDiscoveryCredentialId = CREDENTIAL_ID;
