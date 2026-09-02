import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaVirtualsDiscoveryCredentialRepository } from '../../src/integrations/virtuals/prisma-virtuals-discovery-credential-repository.js';
import { EncryptedVirtualsDiscoveryCredentialStore } from '../../src/integrations/virtuals/virtuals-discovery-credential-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PrismaVirtualsDiscoveryCredentialRepository', () => {
  const client = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;

  beforeEach(async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    await client.virtualsDiscoveryCredential.deleteMany();
  });

  afterAll(async () => client?.$disconnect());

  it('atomically persists an encrypted rotation that survives store reconstruction', async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    const key = randomBytes(32).toString('base64');
    const bootstrap = {
      accessToken: 'database-bootstrap-access-token-secret',
      refreshToken: 'database-bootstrap-refresh-token-secret',
    };
    const rotated = {
      accessToken: 'database-rotated-access-token-secret',
      refreshToken: 'database-rotated-refresh-token-secret',
    };
    const repository = new PrismaVirtualsDiscoveryCredentialRepository(client);
    const initialized = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      repository,
      key,
      bootstrap,
    );
    await initialized.store.persistRotated(rotated);

    const row = await client.virtualsDiscoveryCredential.findUniqueOrThrow({
      where: { id: 'virtuals-oauth-discovery' },
    });
    expect(row).toMatchObject({ encryptionVersion: 1, revision: 2 });
    const atRest = Buffer.concat([row.ciphertext, row.iv, row.authenticationTag]).toString('utf8');
    expect(atRest).not.toContain(bootstrap.accessToken);
    expect(atRest).not.toContain(bootstrap.refreshToken);
    expect(atRest).not.toContain(rotated.accessToken);
    expect(atRest).not.toContain(rotated.refreshToken);
    expect(JSON.stringify(row)).not.toContain(key);

    const restarted = await EncryptedVirtualsDiscoveryCredentialStore.initialize(
      new PrismaVirtualsDiscoveryCredentialRepository(client),
      key,
      bootstrap,
    );
    expect(restarted.credentials).toEqual(rotated);
    expect(restarted.source).toBe('durable');
  });
});
