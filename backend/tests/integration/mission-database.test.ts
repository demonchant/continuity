import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaMissionRepository } from '../../src/missions/prisma-mission-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PrismaMissionRepository', () => {
  const client = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : undefined;

  beforeEach(async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    await client.missionTransition.deleteMany();
    await client.mission.deleteMany();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('persists, retrieves, and atomically transitions a mission', async () => {
    if (!client) throw new Error('TEST_DATABASE_URL is required for this test');
    const repository = new PrismaMissionRepository(client);
    const created = await repository.create({
      objective: 'Persist this mission',
      constraints: { requiredSources: 2 },
      budget: '1.25',
    });

    await expect(repository.findById(created.id)).resolves.toEqual(created);

    const planned = await repository.transition({
      missionId: created.id,
      expectedStatus: 'CREATED',
      targetStatus: 'PLANNING',
      currentStep: 'planning',
      reason: 'Begin planning',
    });
    expect(planned).toMatchObject({ status: 'PLANNING', currentStep: 'planning' });

    await expect(
      repository.transition({
        missionId: created.id,
        expectedStatus: 'CREATED',
        targetStatus: 'FAILED',
        currentStep: 'failed',
      }),
    ).resolves.toBeNull();

    await expect(
      client.missionTransition.findMany({ where: { missionId: created.id } }),
    ).resolves.toHaveLength(2);
  });
});
