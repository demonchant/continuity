import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { SibylMemoryAdapter } from '../dist/integrations/sibyl/sibyl-memory-adapter.js';
import { SibylMcpToolClient } from '../dist/integrations/sibyl/sibyl-tool-client.js';
import { MemoryService } from '../dist/memory/memory-service.js';

const script = fileURLToPath(import.meta.url);
const [mode, databasePath, token] = process.argv.slice(2);

/** @param {string} database */
function service(database) {
  return new MemoryService(
    new SibylMemoryAdapter(
      new SibylMcpToolClient({
        command: process.env.SIBYL_MCP_COMMAND ?? 'sibyl-memory-mcp',
        databasePath: database,
      }),
    ),
    pino({ level: 'silent' }),
  );
}

/**
 * @param {string} childMode
 * @param {string} database
 * @param {string} uniqueToken
 */
async function child(childMode, database, uniqueToken) {
  const memory = service(database);
  try {
    if (childMode === '--write') {
      const record = await memory.recordFailure({
        missionId: `smoke-mission-${uniqueToken}`,
        mission: 'Cross-process Sibyl verification',
        capability: uniqueToken,
        agentId: 'smoke-agent-a',
        result: 'Synthetic integration probe failed verification',
        verification: { status: 'FAIL', summary: 'Expected smoke-test failure' },
        cost: { amount: '0', currency: 'USDC' },
        failureReason: 'Expected smoke-test failure',
        decisionReason: 'Exercise the real Sibyl write boundary',
        confidence: 1,
        recommendation: 'Avoid smoke-agent-a for this probe capability',
      });
      process.stdout.write(`${JSON.stringify({ phase: 'write', recordId: record.id })}\n`);
      return;
    }
    const recalled = await memory.recall({
      mission: 'A fresh comparable mission',
      capabilities: [uniqueToken],
      categories: ['failure'],
    });
    if (recalled.records.length === 0) throw new Error('Fresh process recalled no Sibyl record');
    process.stdout.write(
      `${JSON.stringify({
        phase: 'recall',
        sibylRecordIds: recalled.records.map(({ sibylRecordId }) => sibylRecordId),
      })}\n`,
    );
  } finally {
    await memory.close();
  }
}

async function parent() {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-sibyl-smoke-'));
  const database = join(directory, 'memory.db');
  const uniqueToken = `continuitysmoke${Date.now()}`;
  try {
    for (const childMode of ['--write', '--recall']) {
      const run = spawnSync(process.execPath, [script, childMode, database, uniqueToken], {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      });
      process.stdout.write(run.stdout);
      process.stderr.write(run.stderr);
      if (run.status !== 0) process.exit(run.status ?? 1);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if ((mode === '--write' || mode === '--recall') && databasePath && token) {
  await child(mode, databasePath, token);
} else {
  await parent();
}
