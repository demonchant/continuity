import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validateBody<TOutput>(schema: ZodType<TOutput>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      next(result.error);
      return;
    }

    request.body = result.data;
    next();
  };
}

export function validateParams<TOutput extends Record<string, string>>(
  schema: ZodType<TOutput>,
): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.params);

    if (!result.success) {
      next(result.error);
      return;
    }

    request.params = result.data;
    next();
  };
}
