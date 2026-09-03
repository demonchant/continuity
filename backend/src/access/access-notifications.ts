import type { Logger } from 'pino';
import type { BetaSignupRecord } from '../beta/beta-signup.js';
import type { AccessInvitationResult } from './access.js';

export type NotificationDelivery = 'SENT' | 'NOT_CONFIGURED' | 'FAILED';

export interface AccessNotificationService {
  notifyNewRequest(request: BetaSignupRecord): Promise<NotificationDelivery>;
  sendInvitation(
    invitation: AccessInvitationResult,
    inviteUrl: string,
  ): Promise<NotificationDelivery>;
}

export class ResendAccessNotificationService implements AccessNotificationService {
  constructor(
    private readonly options: {
      readonly apiKey?: string;
      readonly from?: string;
      readonly adminEmail?: string;
    },
    private readonly logger: Logger,
  ) {}

  notifyNewRequest(request: BetaSignupRecord): Promise<NotificationDelivery> {
    if (!this.options.adminEmail) return Promise.resolve('NOT_CONFIGURED');
    return this.send({
      to: this.options.adminEmail,
      subject: `Continuity beta request: ${request.email}`,
      text: `A new private-beta request was received.\n\nEmail: ${request.email}\nRole: ${request.role}\nWorkflow: ${request.workflow ?? 'Not supplied'}\n\nReview it in the protected Continuity access administration page.`,
    });
  }

  sendInvitation(
    invitation: AccessInvitationResult,
    inviteUrl: string,
  ): Promise<NotificationDelivery> {
    return this.send({
      to: invitation.email,
      subject: 'Your Continuity private-beta invitation',
      text: `You have been invited to ${invitation.organizationName} on Continuity. This single-use link expires ${invitation.expiresAt.toISOString()}:\n\n${inviteUrl}\n\nDo not forward this link.`,
    });
  }

  private async send(input: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }): Promise<NotificationDelivery> {
    if (!this.options.apiKey || !this.options.from) return 'NOT_CONFIGURED';
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [input.to],
          subject: input.subject,
          text: input.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend returned ${response.status}`);
      return 'SENT';
    } catch (error) {
      this.logger.error(
        { err: error, event: 'access.notification.failed' },
        'Access email delivery failed',
      );
      return 'FAILED';
    }
  }
}
