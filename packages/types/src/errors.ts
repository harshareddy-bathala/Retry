// Every code the API can return inside the error envelope (API.md §1).
// Add codes here as domains land; clients switch on these, never on messages.
export const ERROR_CODES = [
  // Generic
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  // Auth
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'EMAIL_ALREADY_REGISTERED',
  'EMAIL_NOT_VERIFIED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_SUSPENDED',
  'PASSWORD_TOO_WEAK',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'ONBOARDING_ALREADY_COMPLETE',
  // Rooms
  'NOT_ROOM_OWNER',
  'ALREADY_A_MEMBER',
  'INVITE_ALREADY_PENDING',
  'INVITE_NOT_PENDING',
  'SOLE_OWNER',
] as const;

export type AppErrorCode = (typeof ERROR_CODES)[number];

export type ErrorEnvelope = {
  error: {
    code: AppErrorCode;
    message: string;
  };
};
