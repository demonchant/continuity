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

type VirtualsDiscoveryFailureClass =
  | 'AUTHENTICATION_OR_AUTHORIZATION'
  | 'INVALID_SIGNER_OR_WALLET_CONFIGURATION'
  | 'PROVIDER_UNAVAILABLE_OR_NETWORK_ERROR'
  | 'UNKNOWN_PROVIDER_ERROR';

type VirtualsDiscoveryFailureStage = 'ACP_AUTHENTICATION' | 'ACP_AGENT_SEARCH' | 'UNKNOWN';

interface VirtualsDiscoveryDiagnostic {
  readonly failureClass: VirtualsDiscoveryFailureClass;
  readonly failureStage: VirtualsDiscoveryFailureStage;
  readonly rootErrorName: string;
  readonly rootErrorCode?: string;
  readonly upstreamStatus?: number;
}

function objectProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function safeErrorName(value: unknown): string {
  const name = objectProperty(value, 'name');
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
    ? name
    : 'UnknownError';
}

function safeErrorCode(value: unknown): string | undefined {
  const code = objectProperty(value, 'code');
  return typeof code === 'string' && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(code) ? code : undefined;
}

function safeStatus(value: unknown): number | undefined {
  for (const candidate of [
    objectProperty(value, 'status'),
    objectProperty(value, 'statusCode'),
    objectProperty(objectProperty(value, 'response'), 'status'),
  ]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599)
      return candidate;
  }
  // ACP SDK v0.1.12 throws a plain Error in the form
  // "browseAgents failed: <status> <statusText>". Retain only the status;
  // provider text must never enter the diagnostic.
  const message = objectProperty(value, 'message');
  const match =
    typeof message === 'string'
      ? /^(?:browseAgents|Agent auth) failed:\s+([1-5]\d\d)\b/.exec(message)
      : null;
  if (match?.[1]) return Number(match[1]);
  return undefined;
}

/**
 * Produces a bounded diagnostic category only. Raw provider error text is
 * intentionally never returned to the caller or written to logs.
 */
function classifyVirtualsDiscoveryFailure(error: unknown): VirtualsDiscoveryFailureClass {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(current.message.toLowerCase());
    current = current.cause;
  }
  const combined = messages.join(' ');
  if (/signer|pkcs.?8|private key|wallet.?id|wallet address/.test(combined)) {
    return 'INVALID_SIGNER_OR_WALLET_CONFIGURATION';
  }
  if (/unauthori[sz]ed|forbidden|authentication|credential|\b401\b|\b403\b/.test(combined)) {
    return 'AUTHENTICATION_OR_AUTHORIZATION';
  }
  if (/timeout|timed out|econn|enotfound|network|socket|unavailable|\b5\d\d\b/.test(combined)) {
    return 'PROVIDER_UNAVAILABLE_OR_NETWORK_ERROR';
  }
  return 'UNKNOWN_PROVIDER_ERROR';
}

function classifyVirtualsDiscoveryFailureStage(error: unknown): VirtualsDiscoveryFailureStage {
  const message = objectProperty(error, 'message');
  if (typeof message !== 'string') return 'UNKNOWN';
  if (/^Agent auth failed:\s+[1-5]\d\d\b/.test(message)) return 'ACP_AUTHENTICATION';
  if (/^browseAgents failed:\s+[1-5]\d\d\b/.test(message)) return 'ACP_AGENT_SEARCH';
  return 'UNKNOWN';
}

function virtualsDiscoveryDiagnostic(error: unknown): VirtualsDiscoveryDiagnostic {
  let root = error;
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    root = current;
    current = current.cause;
  }
  const rootErrorCode = safeErrorCode(root);
  const upstreamStatus = safeStatus(root);
  return {
    failureClass: classifyVirtualsDiscoveryFailure(error),
    failureStage: classifyVirtualsDiscoveryFailureStage(root),
    rootErrorName: safeErrorName(root),
    ...(rootErrorCode ? { rootErrorCode } : {}),
    ...(upstreamStatus ? { upstreamStatus } : {}),
  };
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
      if (error.code === 'VIRTUALS_DISCOVERY_FAILED') {
        logger.warn(
          {
            event: 'virtuals.discovery.failed',
            requestId: requestIdDetails(request.id).requestId,
            ...virtualsDiscoveryDiagnostic(error),
          },
          'Virtuals discovery failed',
        );
      }
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
