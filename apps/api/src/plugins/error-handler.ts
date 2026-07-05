import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ErrorEnvelope } from '@foundry/types';
import { AppError } from '../lib/errors.js';

// Hard Rule 5: raw DB/stack errors never reach the client.
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const envelope: ErrorEnvelope = { error: { code: error.code, message: error.message } };
      return reply.status(error.statusCode).send(envelope);
    }

    if (error instanceof ZodError) {
      const message = error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      const envelope: ErrorEnvelope = { error: { code: 'VALIDATION_ERROR', message } };
      return reply.status(400).send(envelope);
    }

    // Fastify's own 4xx (bad JSON, rate limit plugin, etc.)
    if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      const code = error.statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR';
      const envelope: ErrorEnvelope = { error: { code, message: error.message } };
      return reply.status(error.statusCode).send(envelope);
    }

    request.log.error({ err: error }, 'unhandled error');
    // TODO(harsha): wire Sentry capture here when SENTRY_DSN_API is configured (Phase 7)
    const envelope: ErrorEnvelope = {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    };
    return reply.status(500).send(envelope);
  });

  app.setNotFoundHandler((_request, reply) => {
    const envelope: ErrorEnvelope = { error: { code: 'NOT_FOUND', message: 'Route not found.' } };
    return reply.status(404).send(envelope);
  });
}
