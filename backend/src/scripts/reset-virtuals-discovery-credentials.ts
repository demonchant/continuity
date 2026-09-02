import { PrismaClient } from '@prisma/client';
import { virtualsDiscoveryCredentialId } from '../integrations/virtuals/virtuals-discovery-credential-store.js';

const confirmation = 'RESET_VIRTUALS_DISCOVERY_CREDENTIALS';

async function main(): Promise<void> {
  if (process.env.VIRTUALS_DISCOVERY_CREDENTIAL_RESET_CONFIRM !== confirmation) {
    throw new Error(
      `Refusing reset: set VIRTUALS_DISCOVERY_CREDENTIAL_RESET_CONFIRM=${confirmation}`,
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient();
  try {
    const result = await prisma.virtualsDiscoveryCredential.deleteMany({
      where: { id: virtualsDiscoveryCredentialId },
    });
    process.stdout.write(`Durable Virtuals discovery credential rows removed: ${result.count}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown reset failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
