import { describe, expect, it } from 'vitest';
import { OperatorApprovalService } from '../../src/approvals/operator-approval-service.js';
import { InMemoryOperatorApprovalRepository } from '../support/in-memory-operator-approval-repository.js';

const intent = {
  missionId: '00000000-0000-4000-8000-000000000088',
  kind: 'ACP_FUNDING' as const,
  actionId: 'mission:88:agent-attempt:1:fund',
  referenceId: 'real-acp-job-88',
  amount: '0.25',
  currency: 'USDC',
};

describe('OperatorApprovalService', () => {
  it('authorizes only the exact durable financial intent and consumes idempotently', async () => {
    const service = new OperatorApprovalService(new InMemoryOperatorApprovalRepository());
    const approval = await service.approve(intent);
    await expect(service.authorized({ ...intent, amount: '0.2500' })).resolves.toMatchObject({
      id: approval.id,
      status: 'APPROVED',
    });
    await expect(service.consume(approval.id)).resolves.toMatchObject({ status: 'CONSUMED' });
    await expect(service.consume(approval.id)).resolves.toMatchObject({ status: 'CONSUMED' });
  });

  it('rejects changed amount, currency, or provider reference', async () => {
    const service = new OperatorApprovalService(new InMemoryOperatorApprovalRepository());
    await service.approve(intent);
    await expect(service.authorized({ ...intent, amount: '0.26' })).rejects.toMatchObject({
      code: 'APPROVAL_MISMATCH',
    });
    await expect(
      service.authorized({ ...intent, referenceId: 'different-job' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH' });
  });
});
