export type BaseErrorCode =
  | 'BASE_CONFIGURATION_ERROR'
  | 'BASE_VALIDATION_ERROR'
  | 'BASE_BUDGET_EXCEEDED'
  | 'BASE_APPROVAL_REQUIRED'
  | 'BASE_TRANSACTION_FAILED'
  | 'BASE_TRANSACTION_REVERTED'
  | 'BASE_CONFIRMATION_FAILED'
  | 'BASE_NETWORK_MISMATCH';

export class BaseIntegrationError extends Error {
  constructor(
    readonly code: BaseErrorCode,
    message: string,
    readonly retriable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BaseIntegrationError';
  }
}
