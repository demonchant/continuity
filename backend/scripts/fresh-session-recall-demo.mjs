import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import pino from 'pino';
import { createConfiguredMemoryProvider } from '../dist/config/memory-provider.js';
import {
  FreshSessionRecallDemo,
  freshSessionAgents,
} from '../dist/demo/fresh-session-recall-demo.js';
import { MemoryService } from '../dist/memory/memory-service.js';

const proofLabel =
  'Production Sibyl cross-process causal proof using controlled simulated agent results.';
const timestamp = () => new Date().toISOString();

function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolve('..'),
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: timestamp(), event, ...fields })}\n`);
}

async function runSession(session) {
  const runId = process.env.CONTINUITY_DEMO_RUN_ID;
  const database = process.env.SIBYL_MEMORY_DB;
  const expectedParentPid = Number(process.env.CONTINUITY_DEMO_PARENT_PID);
  if (!runId) throw new Error('CONTINUITY_DEMO_RUN_ID is required');
  if (!database) throw new Error('SIBYL_MEMORY_DB is required');
  if (
    !Number.isInteger(expectedParentPid) ||
    expectedParentPid <= 0 ||
    expectedParentPid === process.pid
  ) {
    throw new Error('The proof child does not have a distinct orchestrator process');
  }

  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { component: 'continuity-sibyl-causal-proof', session, processId: process.pid },
  });
  const memory = new MemoryService(
    createConfiguredMemoryProvider({
      enabled: true,
      command: process.env.SIBYL_MCP_COMMAND ?? 'sibyl-memory-mcp',
      databasePath: resolve(database),
      callTimeoutMs: 30_000,
      ...(process.env.SIBYL_CREDENTIALS
        ? { credentialsPath: resolve(process.env.SIBYL_CREDENTIALS) }
        : {}),
    }),
    logger,
  );
  const [agentA, agentB] = freshSessionAgents(runId);
  const demo = new FreshSessionRecallDemo(runId, memory, logger, {
    missionCreated(mission) {
      emit('mission.created', { runId, processId: process.pid, missionId: mission.id });
    },
    decisionCompleted(mission, decision) {
      emit('decision.completed', {
        runId,
        processId: process.pid,
        missionId: mission.id,
        candidates: decision.evidence.map((item) => ({
          agentId: item.agentId,
          finalScore: item.score,
          historicalObservations: item.metrics.observationCount,
          historicalFailures: item.metrics.failureCount,
        })),
        selectedAgentId: decision.selectedAgent.id,
        selectedAgent: decision.selectedAgent.name,
        selectionReason: decision.reason,
        decisionCitations: decision.memoryReferences,
      });
    },
    agentResultReceived(mission, agent, resultSummary) {
      emit('controlled.agent.result', {
        runId,
        processId: process.pid,
        missionId: mission.id,
        agentId: agent.id,
        simulationDisclosure:
          'Controlled simulated agent result; no live external agent execution.',
        resultSummary,
      });
    },
    verificationCompleted(mission, decision, verification) {
      emit('verification.completed', {
        runId,
        processId: process.pid,
        missionId: mission.id,
        verificationId: verification.id,
        selectedAgentId: decision.selectedAgent.id,
        passed: verification.passed,
        score: verification.score,
        failedRequirements: verification.failedRequirements,
        memoryRecordId: verification.memoryRecordId,
        sibylRecordId: verification.sibylRecordId,
        sibylEventId: verification.sibylEventId,
      });
    },
  });

  emit('application.start', {
    proofLabel,
    session,
    processId: process.pid,
    parentProcessId: expectedParentPid,
    runId,
    gitCommit: gitCommit(),
    sibylDatabase: resolve(database),
    candidates: [
      { id: agentA.id, name: agentA.name, price: agentA.cost },
      { id: agentB.id, name: agentB.name, price: agentB.cost },
    ],
  });

  try {
    const result = session === 'session-a' ? await demo.sessionA() : await demo.sessionB();
    emit('session.result', {
      session,
      processId: process.pid,
      runId,
      missionId: result.mission.id,
      candidateIds: [agentA.id, agentB.id],
      selectedAgentId: result.decision.selectedAgent.id,
      verificationId: result.verification.id,
      verificationPassed: result.verification.passed,
      memoryRecordId: result.verification.memoryRecordId,
      sibylRecordId: result.verification.sibylRecordId,
      sibylEventId: result.verification.sibylEventId,
      decisionCitations: result.decision.memoryReferences,
      decisionReason: result.decision.reason,
    });
  } finally {
    await memory.close();
    emit('application.stop', { session, processId: process.pid, runId });
  }
}

function childEnvironment(runId, database) {
  const environment = {
    ...process.env,
    CONTINUITY_DEMO_RUN_ID: runId,
    CONTINUITY_DEMO_PARENT_PID: String(process.pid),
    SIBYL_MEMORY_DB: database,
  };
  for (const key of Object.keys(environment)) {
    if (/CONTINUITY_DEMO_(FAILURE|MEMORY|RESULT|CITATION)/.test(key)) delete environment[key];
  }
  return environment;
}

async function launchChild(session, runId, database, transcript) {
  process.stdout.write(
    `\n=== ${session === 'session-a' ? 'SESSION A — BEFORE MEMORY' : 'SESSION B — NEW PROCESS, SIBYL RECALL'} ===\n`,
  );
  const child = spawn(
    process.execPath,
    [resolve('scripts/fresh-session-recall-demo.mjs'), '--child', session],
    {
      cwd: process.cwd(),
      env: childEnvironment(runId, database),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let pending = '';
  let result;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    transcript.write(chunk);
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'session.result') result = parsed;
      } catch {
        // Application logs are relayed; only proof events are parsed.
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    transcript.write(chunk);
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (exitCode !== 0) throw new Error(`${session} exited with code ${exitCode}`);
  if (!result) throw new Error(`${session} did not emit machine-readable session evidence`);
  return result;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function orchestrate() {
  const runId = `proof-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const evidenceRoot = process.env.CONTINUITY_DEMO_EVIDENCE_DIR
    ? resolve(process.env.CONTINUITY_DEMO_EVIDENCE_DIR)
    : resolve('..', '.continuity-demo', 'phase28');
  const proofDirectory = resolve(evidenceRoot, runId);
  const database = resolve(proofDirectory, 'sibyl-memory.db');
  const artifact = resolve(proofDirectory, 'sibyl-causal-proof.json');
  const transcriptPath = resolve(proofDirectory, 'sibyl-causal-proof.jsonl');
  if (await pathExists(database))
    throw new Error('Fresh-proof database unexpectedly already exists');
  await mkdir(proofDirectory, { recursive: true });
  const transcript = createWriteStream(transcriptPath, { flags: 'wx' });
  const commit = gitCommit();
  if (!commit && process.env.CONTINUITY_REQUIRE_GIT_COMMIT === 'true') {
    throw new Error(
      'A real git commit is required but this checkout has no recoverable Git metadata',
    );
  }

  process.stdout.write(
    `${proofLabel}\nRun ID: ${runId}\nOrchestrator PID: ${process.pid}\nTimestamp: ${timestamp()}\n`,
  );
  process.stdout.write(
    `Git commit: ${commit ?? 'UNAVAILABLE (checkout currently has no Git metadata)'}\n`,
  );

  try {
    const sessionA = await launchChild('session-a', runId, database, transcript);
    if (!(await pathExists(database)))
      throw new Error('Session A did not create the persistent Sibyl database');
    process.stdout.write('\nSession A terminated. Its Node process is no longer running.\n');
    const sessionB = await launchChild('session-b', runId, database, transcript);

    const [agentA, agentB] = freshSessionAgents(runId);
    if (
      sessionA.processId === sessionB.processId ||
      sessionA.processId === process.pid ||
      sessionB.processId === process.pid
    ) {
      throw new Error('Process-separation assertion failed');
    }
    if (sessionA.missionId === sessionB.missionId) throw new Error('Mission IDs were reused');
    if (sessionA.selectedAgentId !== agentA.id || sessionA.verificationPassed !== false) {
      throw new Error(
        'Session A did not select cheap Agent A and produce verifier-generated failure',
      );
    }
    if (sessionB.selectedAgentId !== agentB.id || sessionB.verificationPassed !== true) {
      throw new Error('Session B did not select Agent B and pass verification');
    }
    if (!sessionB.decisionCitations.includes(sessionA.sibylRecordId)) {
      throw new Error("Session B did not cite Session A's persisted Sibyl record");
    }
    if (
      !sessionA.sibylRecordId ||
      !sessionA.sibylEventId ||
      !sessionB.sibylRecordId ||
      !sessionB.sibylEventId
    ) {
      throw new Error('Sibyl did not return all required durable record/event identifiers');
    }

    const evidence = {
      schemaVersion: 1,
      proofLabel,
      generatedAt: timestamp(),
      gitCommit: commit,
      orchestratorPid: process.pid,
      runId,
      persistentSibylDatabase: database,
      simulationDisclosure:
        'Candidate execution and deliverables are controlled simulations. Sibyl MCP, recall, decision, verification, and writes use production code.',
      directFailureInputToSessionB: false,
      sessionA,
      sessionB,
      assertions: {
        freshDatabase: true,
        uniqueRunId: true,
        separateNodeProcesses: true,
        distinctMissionIds: true,
        verifierGeneratedFailure: true,
        sibylPersistedFailure: true,
        sessionBRecalledSessionARecord: true,
        selectionChanged: true,
        successWrittenToSibyl: true,
      },
    };
    await writeFile(artifact, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write('\n=== CAUSAL PROOF PASSED ===\n');
    process.stdout.write('BEFORE: Agent A cheaper; Agent A selected; verification failed.\n');
    process.stdout.write(
      `MEMORY: Sibyl record ${sessionA.sibylRecordId}; event ${sessionA.sibylEventId}.\n`,
    );
    process.stdout.write(
      `AFTER NEW PROCESS: recalled ${sessionB.decisionCitations.join(', ')}; Agent B selected.\n`,
    );
    process.stdout.write(`Machine evidence: ${artifact}\nTranscript: ${transcriptPath}\n`);
  } finally {
    transcript.end();
  }
}

if (process.argv[2] === '--child') {
  const session = process.argv[3];
  if (session !== 'session-a' && session !== 'session-b')
    throw new Error('Invalid proof child session');
  await runSession(session);
} else if (process.argv[2] === 'session-a' || process.argv[2] === 'session-b') {
  throw new Error(
    'Use `npm run demo:sibyl-proof`; direct sessions cannot prove process separation',
  );
} else {
  await orchestrate();
}
