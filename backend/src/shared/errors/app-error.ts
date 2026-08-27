export interface AppErrorOptions {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}
