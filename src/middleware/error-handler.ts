import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${request.method} ${request.path}` },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues },
    });
    return;
  }
  const appError = error instanceof AppError ? error : undefined;
  if (!appError)
    logger.error(
      { err: error, method: request.method, path: request.path },
      'Unhandled request error',
    );
  response.status(appError?.statusCode ?? 500).json({
    success: false,
    error: {
      code: appError?.code ?? 'INTERNAL_SERVER_ERROR',
      message: appError?.message ?? 'Internal server error',
    },
  });
};
