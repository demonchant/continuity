const baseUrl = process.env.CONTINUITY_URL ?? 'http://127.0.0.1:3000';
const token = process.env.VIRTUALS_OPERATOR_TOKEN;
const operatorToken = process.env.CONTINUITY_OPERATOR_TOKEN;
if (!token) throw new Error('VIRTUALS_OPERATOR_TOKEN is required');
if (!operatorToken) throw new Error('CONTINUITY_OPERATOR_TOKEN is required');

function redacted(value) {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /(token|secret|private.?key|authorization|credential)/i.test(key)
        ? '[REDACTED]'
        : redacted(item),
    ]),
  );
}

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(redacted(body))}`);
  }
  return body;
}

function required(label, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Live Virtuals evidence is missing required field: ${label}`);
  }
  return value;
}

const objective =
  process.env.VIRTUALS_LIVE_MISSION ??
  'Research and verify the current purpose of the Virtuals Protocol ACP SDK';
const actionId = `virtuals-live-${crypto.randomUUID()}`;
const missionResponse = await json('/api/v1/missions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${operatorToken}`,
  },
  body: JSON.stringify({
    objective,
    budget: process.env.VIRTUALS_LIVE_BUDGET ?? '1.00',
    constraints: {
      output: { format: 'object', requiredFields: ['summary', 'sources'] },
      requiredSources: 1,
      requireEvidence: true,
    },
  }),
});
const missionId = required('missionId', missionResponse.data?.id);
const execution = await json('/api/v1/virtuals/execute', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    missionId,
    actionId,
    capabilities: ['research', 'fact-verification'],
    requirements: {
      objective,
      output: 'Return JSON with summary, sources, and evidence.',
    },
    candidateLimit: 5,
  }),
});

const data = execution.data;
if (!data?.verification?.passed || !['COMPLETED', 'REJECTED'].includes(data?.job?.state)) {
  throw new Error(
    `Live ACP lifecycle was not settled by Continuity verification: ${JSON.stringify(redacted(data))}`,
  );
}
const offering = data.decision?.selectedAgent?.metadata?.offering;
const receipt = {
  evidenceType: 'LIVE_VIRTUALS_ACP',
  timestamp: new Date().toISOString(),
  missionId,
  actionId,
  selectedAgentId: required('selectedAgentId', data.decision?.selectedAgent?.id),
  providerWallet: required('providerWallet', data.job?.providerAddress),
  offeringName: required('offeringName', data.job?.offeringName),
  offeringMetadata: required('offeringMetadata', offering),
  compatibility: required(
    'compatibility',
    data.decision?.selectedAgent?.metadata?.compatibilityReasons,
  ),
  acpChainId: required('acpChainId', data.job?.chainId),
  externalAcpJobId: required('externalAcpJobId', data.job?.externalJobId),
  initialJobState: required('initialJobState', data.lifecycle?.initialState),
  observedStates: required('observedStates', data.lifecycle?.observedStates),
  proposedUsdcAmount: required('proposedUsdcAmount', data.lifecycle?.proposedBudget?.amount),
  fundingState: required('fundingState', data.lifecycle?.fundingState),
  deliverable: required('deliverable', data.lifecycle?.deliverable),
  verificationId: required('verificationId', data.verification?.id),
  verificationResult: data.verification.passed ? 'PASS' : 'FAIL',
  completionOrRejectionState: required('settlementState', data.lifecycle?.settlementState),
  continuityJobId: required('continuityJobId', data.job?.id),
  memoryRecordId: required('memoryRecordId', data.verification?.memoryRecordId),
  sibylRecordId: required('sibylRecordId', data.verification?.sibylRecordId),
  sibylEventId: required('sibylEventId', data.verification?.sibylEventId),
  decisionCitations: data.decision?.memoryReferences ?? [],
};
if (!Array.isArray(receipt.observedStates) || receipt.observedStates.length < 2) {
  throw new Error('Live Virtuals evidence did not include an observable ACP state progression');
}
process.stdout.write(`${JSON.stringify(redacted(receipt), null, 2)}\n`);
