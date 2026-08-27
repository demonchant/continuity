import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export function bearerAuthenticated(
  expected: string,
  code = 'OPERATOR_UNAUTHORIZED',
): RequestHandler {
  return (request, _response, next) => {
    const authorization = request.header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      next(
        new AppError({
          statusCode: 401,
          code,
          message: 'A valid operator bearer token is required',
        }),
      );
      return;
    }
    next();
  };
}
