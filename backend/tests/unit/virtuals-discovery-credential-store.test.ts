import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeCredentialEncryptionKey,
  EncryptedVirtualsDiscoveryCredentialStore,
  virtualsDiscoveryCredentialId,
  type VirtualsDiscoveryCredentialRecord,
  type VirtualsDiscoveryCredentialRepository,
} from '../../src/integrations/virtuals/virtuals-discovery-credential-store.js';

const key = randomBytes(32).toString('base64');
const bootstrap = {
  accessToken: 'bootstrap-access-token-that-must-stay-secret',
  refreshToken: 'bootstrap-refresh-token-that-must-stay-secret',
};
const rotated = {
  accessToken: 'rotated-access-token-that-must-stay-secret',
  refreshToken: 'rotated-refresh-token-that-must-stay-secret',
};

class MemoryCredentialRepository implements VirtualsDiscoveryCredentialRepository {
  record: VirtualsDiscoveryCredentialRecord | null = null;
  failReplace = false;

  find(id: string): Promise<VirtualsDiscoveryCredentialRecord | null> {
    return Promise.resolve(this.record?.id === id ? this.record : null);
  }

  initialize(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
  ): Promise<VirtualsDiscoveryCredentialRecord> {
    this.record ??= { ...record, updatedAt: new Date() };
    return Promise.resolve(this.record);
  }

  replace(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
    expectedRevision: number,
  ): Promise<void> {
    if (this.failReplace) {
      return Promise.reject(new Error('database diagnostics containing a secret'));
    }
    if (!this.record || this.record.revision !== expectedRevision) {
      return Promise.reject(new Error('conflict'));
    }
    this.record = { ...record, updatedAt: new Date() };
    return Promise.resolve();
  }

  delete(id: string): Promise<boolean> {
    if (this.record?.id !== id) return Promise.resolve(false);
    this.record = null;
    return Promise.resolve(true);
  }
}

describe('EncryptedVirtualsDiscoveryCredentialStore', () => {
  it('decodes common lossless 32-byte key representations', () => {
    const raw = randomBytes(32);
    for (const encoded of [
      raw.toString('base64'),
      raw.toString('base64').replace(/=$/, ''),
      raw.toString('base64url'),
      raw.toString('hex'),
      `'${raw.toString('base64')}'`,
    ]) {
      expect(decodeCredentialEncryptionKey(encoded)).toEqual(raw);
    }
    expect(() => decodeCredentialEncryptionKey('not-a-32-byte-key')).toThrow(
      'Durable Virtuals discovery credentials are unavailable',
    );
  });

  it('bootstraps once from environment input and encrypts tokens at rest', async () => {
    const repository = new MemoryCredentialRepository();
    const initialized = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      bootstrap,
    );
    expect(initialized).toMatchObject({ credentials: bootstrap, source: 'bootstrap' });
    expect(repository.record).toMatchObject({
      id: virtualsDiscoveryCredentialId,
      encryptionVersion: 1,
      revision: 1,
    });
    const stored = JSON.stringify(repository.record);
    expect(stored).not.toContain(bootstrap.accessToken);
    expect(stored).not.toContain(bootstrap.refreshToken);
    expect(stored).not.toContain(key);
  });

  it('persists rotation and reloads it after restart instead of stale bootstrap values', async () => {
    const repository = new MemoryCredentialRepository();
    const first = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      bootstrap,
    );
    await first.store.persistRotated(rotated);
    expect(repository.record?.revision).toBe(2);

    const restarted = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      bootstrap,
    );
    expect(restarted).toMatchObject({ credentials: rotated, source: 'durable' });
  });

  it('records access-token expiry metadata without storing the plaintext JWT', async () => {
    const repository = new MemoryCredentialRepository();
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');
    const accessToken = `header.${payload}.signature`;
    await EncryptedVirtualsDiscoveryCredentialStore.initialize(repository, key, {
      accessToken,
      refreshToken: bootstrap.refreshToken,
    });
    expect(repository.record?.accessTokenExpiresAt?.toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(JSON.stringify(repository.record)).not.toContain(accessToken);
  });

  it('fails safely with the wrong encryption key and does not fall back to bootstrap', async () => {
    const repository = new MemoryCredentialRepository();
    await EncryptedVirtualsDiscoveryCredentialStore.initialize(repository, key, bootstrap);
    const error = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      randomBytes(32).toString('base64'),
      rotated,
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'VIRTUALS_CONFIGURATION_ERROR',
      message: 'Durable Virtuals discovery credentials are unavailable',
    });
    expect(String(error)).not.toMatch(/bootstrap|rotated|secret/);
  });

  it('fails safely when encrypted state is malformed', async () => {
    const repository = new MemoryCredentialRepository();
    await EncryptedVirtualsDiscoveryCredentialStore.initialize(repository, key, bootstrap);
    repository.record = { ...repository.record!, authenticationTag: new Uint8Array(3) };
    await expect(
      EncryptedVirtualsDiscoveryCredentialStore.initialize(repository, key, rotated),
    ).rejects.toMatchObject({
      code: 'VIRTUALS_CONFIGURATION_ERROR',
      message: 'Durable Virtuals discovery credentials are unavailable',
    });
  });

  it('surfaces a safe error when rotated credentials cannot be persisted', async () => {
    const repository = new MemoryCredentialRepository();
    const initialized = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      bootstrap,
    );
    repository.failReplace = true;
    const error = await initialized.store
      .persistRotated(rotated)
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      code: 'VIRTUALS_DISCOVERY_FAILED',
      message: 'Rotated Virtuals discovery credentials could not be persisted',
    });
    expect(String(error)).not.toMatch(
      /rotated-access-token|rotated-refresh-token|database diagnostics|secret/,
    );
    const restarted = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      rotated,
    );
    expect(restarted.credentials).toEqual(bootstrap);
  });
});
