import type { FastifyServerOptions } from 'fastify';

// Redact paths per SECURITY.md §4 — tokens/passwords never reach logs.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
];

// Fastify owns the pino instance (keeps FastifyInstance's logger generic at its
// default); services receive app.log.
export function buildLoggerOptions(options: {
  level?: string;
  pretty?: boolean;
}): FastifyServerOptions['logger'] {
  return {
    level: options.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    transport: options.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  };
}
