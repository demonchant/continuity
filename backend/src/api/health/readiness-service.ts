import type { MemoryService } from '../../memory/memory-service.js';
import type { DatabaseHealthRepository } from './health-repository.js';

export interface ReadinessResult {
  readonly status: 'ready' | 'not_ready';
  readonly database: 'connected' | 'unavailable';
  readonly sibyl: 'connected' | 'unavailable';
}

export class ReadinessService {
  constructor(
    private readonly database: DatabaseHealthRepository,
    private readonly memory: MemoryService,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [database, sibyl] = await Promise.allSettled([
      this.database.check(),
      this.memory.recall({
        mission: 'Continuity readiness probe',
        capabilities: ['continuity-readiness-probe'],
        categories: ['mission'],
        limit: 1,
      }),
    ]);
    const databaseStatus = database.status === 'fulfilled' ? 'connected' : 'unavailable';
    const sibylStatus = sibyl.status === 'fulfilled' ? 'connected' : 'unavailable';
    return {
      status: databaseStatus === 'connected' && sibylStatus === 'connected' ? 'ready' : 'not_ready',
      database: databaseStatus,
      sibyl: sibylStatus,
    };
  }
}
