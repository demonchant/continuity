import { describe, expect, it } from 'vitest';
import { AccessService } from '../../src/access/access-service.js';
import type {
  AccessRepository,
  ApproveAccessRequestInput,
} from '../../src/access/access-repository.js';
import type {
  AccessInvitationResult,
  AccessPrincipal,
  BetaAccessRequest,
} from '../../src/access/access.js';
import type { AccessNotificationService } from '../../src/access/access-notifications.js';

const betaRequest: BetaAccessRequest = {
  id: '00000000-0000-4000-8000-000000000101',
  email: 'builder@example.com',
  role: 'AGENT_DEVELOPER',
  status: 'PENDING',
  consentToContact: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

class FakeAccessRepository implements AccessRepository {
  passwordHash = '';
  invitationHash = '';
  approveRequest(input: ApproveAccessRequestInput): Promise<AccessInvitationResult> {
    this.invitationHash = input.tokenHash;
    return Promise.resolve({
      invitationId: 'invite-1',
      token: input.token,
      email: betaRequest.email,
      organizationId: '00000000-0000-4000-8000-000000000102',
      organizationName: input.organizationName,
      role: input.role,
      expiresAt: input.expiresAt,
    });
  }
  reissueInvitation(input: {
    requestId: string;
    token: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessInvitationResult> {
    return this.approveRequest({
      requestId: input.requestId,
      token: input.token,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      organizationName: 'Builder workspace',
      organizationMode: 'CUSTOMER',
      role: 'OWNER',
      spendingEnabled: false,
      maximumMissionBudget: '1',
      maximumAcpJobUsdc: '1',
    });
  }
  listRequests() {
    return Promise.resolve([betaRequest]);
  }
  rejectRequest() {
    return Promise.resolve({ ...betaRequest, status: 'REJECTED' as const });
  }
  listMembers() {
    return Promise.resolve([]);
  }
  createMemberInvitation(input: {
    organizationId: string;
    email: string;
    role: 'OWNER' | 'OPERATOR' | 'FINANCE_APPROVER' | 'VIEWER' | 'JUDGE';
    token: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessInvitationResult> {
    return Promise.resolve({
      invitationId: 'invite-member',
      token: input.token,
      email: input.email,
      organizationId: input.organizationId,
      organizationName: 'Builder workspace',
      role: input.role,
      expiresAt: input.expiresAt,
    });
  }
  acceptInvitation(input: { tokenHash: string; name: string; passwordHash: string }) {
    if (input.tokenHash !== this.invitationHash) return Promise.reject(new Error('invalid'));
    this.passwordHash = input.passwordHash;
    return Promise.resolve({
      userId: '00000000-0000-4000-8000-000000000103',
      organizationId: '00000000-0000-4000-8000-000000000102',
    });
  }
  findLogin(email: string) {
    return Promise.resolve(
      email === betaRequest.email && this.passwordHash
        ? {
            userId: '00000000-0000-4000-8000-000000000103',
            passwordHash: this.passwordHash,
            organizationIds: ['00000000-0000-4000-8000-000000000102'],
          }
        : null,
    );
  }
  createSession(input: {
    userId: string;
    organizationId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AccessPrincipal> {
    return Promise.resolve({
      userId: input.userId,
      email: betaRequest.email,
      name: 'Builder',
      organizationId: input.organizationId,
      organizationName: 'Builder workspace',
      organizationMode: 'CUSTOMER',
      role: 'OWNER',
      spendingEnabled: false,
      maximumMissionBudget: '1',
      maximumAcpJobUsdc: '1',
      sessionId: 'session-1',
    });
  }
  findSession() {
    return Promise.resolve(null);
  }
  revokeSession() {
    return Promise.resolve();
  }
}

class FakeNotifications implements AccessNotificationService {
  invitations: string[] = [];
  notifyNewRequest() {
    return Promise.resolve('SENT' as const);
  }
  sendInvitation(_invitation: AccessInvitationResult, url: string) {
    this.invitations.push(url);
    return Promise.resolve('SENT' as const);
  }
}

describe('AccessService', () => {
  it('issues an expiring single-use invitation and supports account login', async () => {
    const repository = new FakeAccessRepository();
    const notifications = new FakeNotifications();
    const service = new AccessService(repository, notifications, {
      publicUrl: 'https://continuity.example',
      inviteTtlHours: 72,
      sessionTtlHours: 168,
    });
    const approval = await service.approve({
      requestId: betaRequest.id,
      organizationName: 'Builder workspace',
      organizationMode: 'CUSTOMER',
      role: 'OWNER',
      spendingEnabled: false,
      maximumMissionBudget: '1',
      maximumAcpJobUsdc: '1',
    });
    expect(approval).toMatchObject({ delivery: 'SENT' });
    expect(approval.inviteUrl).toMatch(/^https:\/\/continuity\.example\/access\/invite\?token=/);
    const token = new URL(approval.inviteUrl).searchParams.get('token')!;
    await expect(
      service.acceptInvitation({ token, name: 'Builder', password: 'correct horse battery' }),
    ).resolves.toMatchObject({ principal: { role: 'OWNER' } });
    await expect(
      service.login({ email: betaRequest.email, password: 'wrong password' }),
    ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
    await expect(
      service.login({ email: betaRequest.email, password: 'correct horse battery' }),
    ).resolves.toMatchObject({ principal: { organizationName: 'Builder workspace' } });
  });
});
