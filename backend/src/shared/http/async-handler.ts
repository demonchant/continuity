import type { RequestHandler } from 'express';

export function asyncHandler<Params, ResponseBody, RequestBody, RequestQuery>(
  handler: RequestHandler<Params, ResponseBody, RequestBody, RequestQuery>,
): RequestHandler<Params, ResponseBody, RequestBody, RequestQuery> {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
