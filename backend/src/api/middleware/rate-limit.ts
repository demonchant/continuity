import type { RequestHandler } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export function fixedWindowRateLimit(options: {
  readonly windowMs: number;
  readonly maximum: number;
  readonly now?: () => number;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? Date.now;
  return (request, response, next) => {
    const current = now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    response.setHeader('ratelimit-limit', String(options.maximum));
    response.setHeader('ratelimit-remaining', String(Math.max(0, options.maximum - bucket.count)));
    response.setHeader('ratelimit-reset', String(Math.ceil(bucket.resetAt / 1_000)));
    if (bucket.count > options.maximum) {
      response.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests; retry after the window resets',
        },
      });
      return;
    }
    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= current) buckets.delete(candidate);
      }
    }
    next();
  };
}
