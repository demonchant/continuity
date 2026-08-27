/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
const baseUrl = process.env.CONTINUITY_URL ?? 'http://127.0.0.1:3000';
const token = process.env.VIRTUALS_OPERATOR_TOKEN;
if (!token) throw new Error('VIRTUALS_OPERATOR_TOKEN is required');

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

const missionResponse = await json('/api/v1/missions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    objective:
      process.env.ECONOMIC_LIVE_MISSION ??
      'Research and verify current information about the Base ecosystem',
    budget: process.env.ECONOMIC_LIVE_BUDGET_USDC ?? '1.00',
    constraints: { requiredSources: 2, requireEvidence: true },
  }),
});
const missionId = missionResponse.data.id;
const execution = await json('/api/v1/economic-decisions/execute', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    missionId,
    capabilities: ['research', 'fact-verification'],
    budgetCurrency: 'USDC',
    candidateLimit: 5,
    executeBase: true,
    actionId: `economic-live-${missionId}`,
    paymentId: `economic-live-payment-${missionId}`,
  }),
});
const result = execution.data;
if (result.decision.memoryReferences.length === 0) {
  throw new Error('No Sibyl historical evidence influenced the live economic decision');
}
if (result.baseAction.status !== 'CONFIRMED' || !result.baseAction.transaction.transactionHash) {
  throw new Error(`Memory-driven Base action did not confirm: ${JSON.stringify(result)}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      missionId,
      selectedAgent: result.decision.selectedAgent.id,
      expectedOutcome: result.decision.expectedOutcome,
      estimatedCost: result.decision.estimatedCost,
      memoryReferences: result.decision.memoryReferences,
      transactionHash: result.baseAction.transaction.transactionHash,
      explorerUrl: result.baseAction.transaction.explorerUrl,
    },
    null,
    2,
  )}\n`,
);
