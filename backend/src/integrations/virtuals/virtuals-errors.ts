export type VirtualsErrorCode =
  | 'VIRTUALS_CONFIGURATION_ERROR'
  | 'VIRTUALS_DISCOVERY_FAILED'
  | 'VIRTUALS_NO_OFFERING'
  | 'VIRTUALS_JOB_CREATION_FAILED'
  | 'VIRTUALS_JOB_NOT_FOUND'
  | 'VIRTUALS_JOB_REJECTED'
  | 'VIRTUALS_JOB_EXPIRED'
  | 'VIRTUALS_JOB_TIMEOUT'
  | 'VIRTUALS_BUDGET_EXCEEDED'
  | 'VIRTUALS_FUNDING_FAILED'
  | 'VIRTUALS_SETTLEMENT_FAILED'
  | 'VIRTUALS_PROVIDER_ERROR';

export class VirtualsProtocolError extends Error {
  constructor(
    readonly code: VirtualsErrorCode,
    message: string,
    readonly retriable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VirtualsProtocolError';
  }
}
