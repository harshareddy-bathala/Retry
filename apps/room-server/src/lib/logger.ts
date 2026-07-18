import type { FastifyServerOptions } from 'fastify';

// Same shape as apps/api: Fastify owns the pino instance; everything logs
// through app.log / req.log (Hard Rule 10 — no console).
export function buildLoggerOptions(options: {
  level?: string;
  pretty?: boolean;
}): FastifyServerOptions['logger'] {
  return {
    level: options.level ?? 'info',
    transport: options.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  };
}
