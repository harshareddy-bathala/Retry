import type { AppErrorCode } from '@foundry/types';

// Services throw AppError; the global error handler maps it to the envelope
// (CONVENTIONS.md §3). Anything else becomes INTERNAL_ERROR + Sentry.
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
