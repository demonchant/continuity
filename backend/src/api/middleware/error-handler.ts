import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';

interface ErrorPayload {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly requestId?: string;
  };
}

function isMalformedJsonError(error: unknown): error is SyntaxError & { status: number } {
  return error instanceof SyntaxError && 'status' in error && error.status === 400;
}

function isPayloadTooLargeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 413;
}

function requestIdDetails(requestId: unknown): { requestId?: string } {
  return typeof requestId === 'string' || typeof requestId === 'number'
    ? { requestId: String(requestId) }
    : {};
}

export function createNotFoundHandler(): RequestHandler {
  return (request, response) => {
    const payload: ErrorPayload = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${request.method} ${request.path}`,
        ...requestIdDetails(request.id),
      },
    };
    response.status(404).json(payload);
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    if (error instanceof ZodError) {
      const payload: ErrorPayload = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          ...requestIdDetails(request.id),
        },
      };
      response.status(400).json(payload);
      return;
    }

    if (isMalformedJsonError(error)) {
      response.status(400).json({
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: 'Request body contains invalid JSON',
          ...requestIdDetails(request.id),
        },
      } satisfies ErrorPayload);
      return;
    }

    if (isPayloadTooLargeError(error)) {
      response.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the allowed size',
          ...requestIdDetails(request.id),
        },
      } satisfies ErrorPayload);
      return;
    }

    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          ...requestIdDetails(request.id),
        },
      } satisfies ErrorPayload);
      return;
    }

    logger.error(
      { err: error, method: request.method, path: request.path, requestId: request.id },
      'Unhandled request error',
    );
    response.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        ...requestIdDetails(request.id),
      },
    } satisfies ErrorPayload);
  };
}
