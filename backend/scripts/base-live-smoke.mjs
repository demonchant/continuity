const baseUrl = process.env.CONTINUITY_URL ?? 'http://127.0.0.1:3000';
const baseToken = process.env.BASE_OPERATOR_TOKEN;
const runnerToken = process.env.VIRTUALS_OPERATOR_TOKEN;
const operatorToken = process.env.CONTINUITY_OPERATOR_TOKEN;
if (!baseToken) throw new Error('BASE_OPERATOR_TOKEN is required');
if (!runnerToken)
  throw new Error('VIRTUALS_OPERATOR_TOKEN is required for verified mission execution');
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
  if (!response.ok)
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(redacted(body))}`);
  return body;
}

function required(label, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Live Base evidence is missing required field: ${label}`);
  }
  return value;
}

const amount = process.env.BASE_LIVE_AMOUNT ?? '0.000001';
const objective =
  process.env.BASE_LIVE_MISSION ??
  'Research and verify the current purpose of the Virtuals Protocol ACP SDK';
const missionResponse = await json('/api/v1/missions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${operatorToken}`,
  },
  body: JSON.stringify({
    objective,
    budget: process.env.BASE_LIVE_MISSION_BUDGET ?? '1.00',
    constraints: {
      capabilities: ['research', 'fact-verification'],
      budgetCurrency: 'USDC',
      output: { format: 'object', requiredFields: ['summary', 'sources'] },
      requiredSources: 1,
      requireEvidence: true,
      baseAction: {
        required: true,
        purpose: 'MISSION_SUCCESS_SETTLEMENT',
        amount,
        asset: process.env.BASE_LIVE_ASSET ?? 'ETH',
      },
    },
  }),
});
const missionId = required('missionId', missionResponse.data?.id);
const queued = await json(`/api/v1/missions/${missionId}/run`, {
  method: 'POST',
  headers: { authorization: `Bearer ${runnerToken}` },
});
if (queued.data?.execution !== 'QUEUED') throw new Error('Mission was not durably queued');
const deadline = Date.now() + Number(process.env.BASE_LIVE_TIMEOUT_MS ?? 1_000_000);
let mission;
while (Date.now() < deadline) {
  mission = (
    await json(`/api/v1/missions/${missionId}`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    })
  ).data;
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(mission.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (mission?.status !== 'COMPLETED')
  throw new Error(`Verified mission did not complete: ${JSON.stringify(redacted(mission))}`);
const publicReceipt = (await json(`/api/v1/judge/missions/${missionId}`)).data;
const transaction = required('baseTransaction', publicReceipt.transactions?.at(-1));
if (transaction.status !== 'CONFIRMED') throw new Error('Base transaction did not confirm');
if (transaction.action !== 'MISSION_SUCCESS_SETTLEMENT') {
  throw new Error('Base action is not the distinct mission success settlement');
}
const replayPayload = {
  missionId,
  actionId: transaction.actionId,
  paymentId: transaction.paymentId,
  agentId: transaction.agentId,
  amount: transaction.amount,
  verificationId: transaction.verificationId,
};
const replay = await json('/api/v1/base/payments', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${baseToken}` },
  body: JSON.stringify(replayPayload),
});
if (
  replay.data?.id !== transaction.id ||
  replay.data?.transactionHash !== transaction.transactionHash ||
  replay.data?.paymentId !== transaction.paymentId
) {
  throw new Error('Idempotent replay did not return the exact original transaction receipt');
}

const receipt = {
  evidenceType: 'LIVE_BASE_MISSION_SUCCESS_SETTLEMENT',
  timestamp: new Date().toISOString(),
  missionId,
  verificationId: required('verificationId', transaction.verificationId),
  actionId: required('actionId', transaction.actionId),
  actionPurpose: transaction.action,
  purposeExplanation:
    'Virtuals ACP funding pays the provider for execution. This Base transfer is a separate mission-level success settlement triggered only after deterministic verification.',
  chainId: required('chainId', transaction.chainId),
  transactionHash: required('transactionHash', transaction.transactionHash),
  block: required('blockNumber', transaction.blockNumber),
  confirmations: required('confirmations', transaction.confirmations),
  status: transaction.status,
  recipient: required('recipient', transaction.recipient),
  amount: required('amount', transaction.amount),
  asset: required('asset', transaction.asset),
  explorerUrl: required('explorerUrl', transaction.explorerUrl),
  postgresqlTransactionId: required('postgresqlTransactionId', transaction.id),
  memoryRecordId: required('memoryRecordId', transaction.memoryRecordId),
  sibylRecordId: required('sibylRecordId', transaction.sibylRecordId),
  sibylEventId: required('sibylEventId', transaction.sibylEventId),
  idempotentReplay: {
    repeatedPaymentId: transaction.paymentId,
    returnedSamePostgresqlId: true,
    returnedSameTransactionHash: true,
  },
};
process.stdout.write(`${JSON.stringify(redacted(receipt), null, 2)}\n`);
