import type { PrismaClient } from '@prisma/client';
import type {
  VirtualsDiscoveryCredentialRecord,
  VirtualsDiscoveryCredentialRepository,
} from './virtuals-discovery-credential-store.js';

export class PrismaVirtualsDiscoveryCredentialRepository implements VirtualsDiscoveryCredentialRepository {
  constructor(private readonly client: PrismaClient) {}

  find(id: string): Promise<VirtualsDiscoveryCredentialRecord | null> {
    return this.client.virtualsDiscoveryCredential.findUnique({ where: { id } });
  }

  initialize(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
  ): Promise<VirtualsDiscoveryCredentialRecord> {
    return this.client.virtualsDiscoveryCredential.upsert({
      where: { id: record.id },
      create: record,
      update: {},
    });
  }

  async replace(
    record: Omit<VirtualsDiscoveryCredentialRecord, 'updatedAt'>,
    expectedRevision: number,
  ): Promise<void> {
    const result = await this.client.virtualsDiscoveryCredential.updateMany({
      where: { id: record.id, revision: expectedRevision },
      data: {
        ciphertext: record.ciphertext,
        iv: record.iv,
        authenticationTag: record.authenticationTag,
        encryptionVersion: record.encryptionVersion,
        revision: record.revision,
        accessTokenExpiresAt: record.accessTokenExpiresAt,
      },
    });
    if (result.count !== 1) throw new Error('Credential revision conflict');
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.client.virtualsDiscoveryCredential.deleteMany({ where: { id } });
    return result.count === 1;
  }
}
