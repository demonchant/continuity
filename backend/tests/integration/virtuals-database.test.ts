import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaVirtualsJobRepository } from '../../src/integrations/virtuals/prisma-virtuals-job-repository.js';
import { PrismaMissionRepository } from '../../src/missions/prisma-mission-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PrismaVirtualsJobRepository', () => {
  const client = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;

  beforeEach(async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    await client.virtualsJob.deleteMany();
    await client.missionTransition.deleteMany();
    await client.mission.deleteMany();
  });

  afterAll(async () => client?.$disconnect());

  it('durably records provider job state, result, and verification', async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    const mission = await new PrismaMissionRepository(client).create({
      objective: 'Execute a real Virtuals agent',
      constraints: {},
      budget: '1.00',
    });
    const repository = new PrismaVirtualsJobRepository(client);
    const created = await repository.createOrGet({
      missionId: mission.id,
      actionId: 'virtuals-execute-1',
      externalJobId: '901',
      chainId: 8453,
      agentId: 'virtuals:8453:0xabc',
      providerAddress: '0xabc',
      offeringName: 'research',
      requirement: { topic: 'X' },
    });
    const completed = await repository.update({
      id: created.id,
      state: 'COMPLETED',
      result: { summary: 'Verified X' },
      verification: { passed: true, score: 1 },
    });

    await expect(
      repository.findByMissionAndAction(mission.id, 'virtuals-execute-1'),
    ).resolves.toEqual(completed);
    expect(completed).toMatchObject({
      externalJobId: '901',
      state: 'COMPLETED',
      result: { summary: 'Verified X' },
      verification: { passed: true, score: 1 },
      completedAt: expect.any(Date),
    });
  });
});
