import pino, { type Logger } from 'pino';
import type { ApplicationConfig } from '../../config/index.js';

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.api_key',
  '*.privateKey',
  '*.private_key',
  '*.secret',
  '*.token',
];

export function createLogger(config: ApplicationConfig): Logger {
  return pino({
    level: config.runtime.logLevel,
    base: {
      service: config.service.name,
      version: config.service.version,
      environment: config.runtime.environment,
    },
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
  });
}
