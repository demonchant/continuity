import { describe, expect, it } from 'vitest';
import { MissionService } from '../../src/missions/mission-service.js';
import type { MissionRepository } from '../../src/missions/mission-repository.js';
import { InMemoryMissionRepository } from '../support/in-memory-mission-repository.js';

describe('MissionService', () => {
  it('moves a mission deterministically through the valid main lifecycle', async () => {
    const service = new MissionService(new InMemoryMissionRepository());
    const mission = await service.create({
      objective: 'Complete a verified research mission',
      constraints: {},
      budget: '1',
    });

    await expect(service.transition(mission.id, 'PLANNING')).resolves.toMatchObject({
      status: 'PLANNING',
      currentStep: 'planning',
    });
    await expect(service.transition(mission.id, 'SELECTING_AGENT')).resolves.toMatchObject({
      status: 'SELECTING_AGENT',
      currentStep: 'selecting-agent',
    });
    await expect(service.transition(mission.id, 'EXECUTING')).resolves.toMatchObject({
      status: 'EXECUTING',
      currentStep: 'executing',
    });
    await expect(service.transition(mission.id, 'VERIFYING')).resolves.toMatchObject({
      status: 'VERIFYING',
      currentStep: 'verifying',
    });
    await expect(service.transition(mission.id, 'COMPLETED')).resolves.toMatchObject({
      status: 'COMPLETED',
      currentStep: 'completed',
    });
  });

  it('rejects invalid transitions with a safe conflict', async () => {
    const service = new MissionService(new InMemoryMissionRepository());
    const mission = await service.create({ objective: 'Mission', constraints: {}, budget: '0' });

    await expect(service.transition(mission.id, 'COMPLETED')).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_MISSION_TRANSITION',
    });
  });

  it('returns a typed not-found error', async () => {
    const service = new MissionService(new InMemoryMissionRepository());

    await expect(service.get('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MISSION_NOT_FOUND',
    });
  });

  it('fails closed when persisted mission state is corrupted', async () => {
    const corrupt = {
      findById: () =>
        Promise.resolve({
          id: '00000000-0000-4000-8000-000000000001',
          objective: 'Corrupted mission',
          constraints: {},
          budget: '1',
          status: 'EXECUTED_TWICE',
          currentStep: 'unknown',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    } as unknown as MissionRepository;

    await expect(
      new MissionService(corrupt).get('00000000-0000-4000-8000-000000000001'),
    ).rejects.toMatchObject({ statusCode: 500, code: 'MISSION_STATE_CORRUPT' });
  });
});
