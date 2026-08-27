import { execFileSync } from 'node:child_process';

const baseUrl = process.env.CONTINUITY_URL ?? 'http://127.0.0.1:3000';
const operatorToken = process.env.CONTINUITY_OPERATOR_TOKEN;
const runnerToken = process.env.VIRTUALS_OPERATOR_TOKEN;
if (!operatorToken) throw new Error('CONTINUITY_OPERATOR_TOKEN is required');
if (!runnerToken) throw new Error('VIRTUALS_OPERATOR_TOKEN is required');

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /(token|secret|private.?key|authorization|credential)/i.test(key)
        ? '[REDACTED]'
        : redact(item),
    ]),
  );
}

function required(label, value) {
  if (value === undefined || value === null || value === '')
    throw new Error(`Final mission evidence is missing required field: ${label}`);
  return value;
}

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(redact(body))}`);
  return body;
}

const operatorHeaders = {
  accept: 'application/json',
  authorization: `Bearer ${operatorToken}`,
};
const created = await json('/api/v1/missions', {
  method: 'POST',
  headers: { ...operatorHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({
    objective:
      process.env.RUNNER_LIVE_MISSION ??
      'Research and verify the current purpose of the Virtuals Protocol ACP SDK',
    budget: process.env.RUNNER_LIVE_BUDGET ?? '1.00',
    constraints: {
      capabilities: ['research', 'fact-verification'],
      budgetCurrency: 'USDC',
      output: { format: 'object', requiredFields: ['summary', 'sources'] },
      requiredSources: 1,
      requireEvidence: true,
      baseAction: {
        required: true,
        purpose: 'MISSION_SUCCESS_SETTLEMENT',
        amount: process.env.BASE_LIVE_AMOUNT ?? '0.000001',
        asset: process.env.BASE_LIVE_ASSET ?? 'ETH',
      },
      runner: { maximumRetries: 2, failureThreshold: 3, timeoutMs: 900000 },
    },
  }),
});
const missionId = required('missionId', created.data?.id);
const queued = await json(`/api/v1/missions/${missionId}/run`, {
  method: 'POST',
  headers: { authorization: `Bearer ${runnerToken}` },
});
if (queued.data?.execution !== 'QUEUED') throw new Error('Mission was not durably queued');

const deadline = Date.now() + Number(process.env.RUNNER_LIVE_TIMEOUT_MS ?? 1_000_000);
let mission;
while (Date.now() < deadline) {
  mission = (await json(`/api/v1/missions/${missionId}`, { headers: operatorHeaders })).data;
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (mission?.status !== 'COMPLETED') {
  throw new Error(`Autonomous mission did not complete: ${JSON.stringify(redact(mission))}`);
}

const receipt = (await json(`/api/v1/judge/missions/${missionId}`)).data;
const decision = required('decision', receipt.decision);
const virtualsJob = required('virtuals job', receipt.jobs?.at(-1));
const lifecycle = required('Virtuals lifecycle', virtualsJob.lifecycle);
const verification = required('verification', virtualsJob.verification);
const base = required('Base transaction', receipt.transactions?.at(-1));
const outcome = required('Sibyl outcome', receipt.memory?.trace?.outcome);
if (!verification.passed || virtualsJob.state !== 'COMPLETED')
  throw new Error('Virtuals result was not verified and completed');
if (base.status !== 'CONFIRMED' || !base.explorerUrl)
  throw new Error('Distinct Base action was not confirmed with an explorer URL');
if (base.action !== 'MISSION_SUCCESS_SETTLEMENT')
  throw new Error('Base action is not the distinct mission success settlement');

let gitCommit = process.env.RENDER_GIT_COMMIT ?? process.env.CONTINUITY_GIT_COMMIT;
if (!gitCommit) {
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('A genuine git commit is required for final live evidence');
  }
}

const finalReceipt = {
  missionId,
  timestamp: new Date().toISOString(),
  gitCommit: required('gitCommit', gitCommit),
  sibyl: {
    recalledRecords: receipt.memory.trace.retrieved,
    decisionCitations: decision.memoryReferences,
    outcomeRecord: outcome,
  },
  decision: {
    candidates: decision.candidates,
    selectedAgent: required('selectedAgent', decision.selectedAgentId),
    selectedOffering: required('selectedOffering', virtualsJob.offeringName),
    reason: required('decision reason', decision.reason),
  },
  virtuals: {
    chainId: required('Virtuals chainId', virtualsJob.chainId),
    agentId: required('Virtuals agentId', virtualsJob.agentId),
    providerWallet: required('providerWallet', virtualsJob.providerAddress),
    offering: required('offering', virtualsJob.offeringName),
    jobId: required('external ACP jobId', virtualsJob.externalJobId),
    funding: required('funding', lifecycle.fundingState),
    deliverable: required('deliverable', lifecycle.deliverable ?? virtualsJob.result),
    verification,
    settlement: required('settlement', lifecycle.settlementState),
  },
  base: {
    chainId: required('Base chainId', base.chainId),
    actionId: required('Base actionId', base.actionId),
    transactionHash: required('Base transactionHash', base.transactionHash),
    block: required('Base block', base.blockNumber),
    confirmations: required('Base confirmations', base.confirmations),
    status: base.status,
    explorerUrl: required('Base explorerUrl', base.explorerUrl),
    purpose: required('Base purpose', base.purpose),
    sibylRecordId: required('Base Sibyl record', base.sibylRecordId),
  },
  mission: { finalState: mission.status },
};

process.stdout.write(`${JSON.stringify(redact(finalReceipt), null, 2)}\n`);
