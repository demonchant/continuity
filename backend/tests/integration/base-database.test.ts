import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaBaseTransactionRepository } from '../../src/integrations/base/prisma-base-transaction-repository.js';
import { PrismaMissionRepository } from '../../src/missions/prisma-mission-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PrismaBaseTransactionRepository', () => {
  const client = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;
  beforeEach(async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required');
    await client.baseTransaction.deleteMany();
    await client.missionTransition.deleteMany();
    await client.mission.deleteMany();
  });
  afterAll(async () => client?.$disconnect());

  it('persists the Base hash, network, action, amount, and confirmation', async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required');
    const mission = await new PrismaMissionRepository(client).create({
      objective: 'Pay agent on Base',
      constraints: {},
      budget: '0.001',
    });
    const repository = new PrismaBaseTransactionRepository(client);
    const intended = await repository.createOrGet({
      missionId: mission.id,
      actionId: 'pay-1',
      paymentId: 'payment-1',
      agentId: 'virtuals:agent',
      network: 'base-sepolia',
      chainId: 84532,
      action: 'AGENT_PAYMENT',
      recipient: '0x2222222222222222222222222222222222222222',
      amount: '0.0001',
      asset: 'ETH',
    });
    const hash = `0x${'d'.repeat(64)}` as const;
    const confirmed = await repository.update({
      id: intended.id,
      status: 'CONFIRMED',
      transactionHash: hash,
      blockNumber: 500n,
      confirmations: 1,
      explorerUrl: `https://sepolia.basescan.org/tx/${hash}`,
    });
    await expect(repository.findByMissionAndAction(mission.id, 'pay-1')).resolves.toEqual(
      confirmed,
    );
    expect(confirmed).toMatchObject({
      transactionHash: hash,
      network: 'base-sepolia',
      action: 'AGENT_PAYMENT',
      amount: '0.0001',
      status: 'CONFIRMED',
      blockNumber: 500n,
      confirmedAt: expect.any(Date),
    });
  });
});
