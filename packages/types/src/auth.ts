import { z } from 'zod';
import { USER_ROLES } from './roles.js';

// FR-AUTH-01: domain enforced server-side against ALLOWED_EMAIL_DOMAIN — the schema
// only checks shape; the service owns the domain rule so it stays configurable.
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// SECURITY.md §1: min length 10, no composition rules; common-password list checked in service.
export const passwordSchema = z.string().min(10).max(128);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2).max(80),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const verifyEmailSchema = z.object({ token: z.string().min(32).max(128) }).strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(128),
    password: passwordSchema,
  })
  .strict();

// FR-AUTH-04
export const onboardingSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    department: z.string().trim().min(2).max(80),
    batchYear: z
      .string()
      .trim()
      .regex(/^\d{4}[-–]\d{4}$/, 'format: 2023-2026'),
    semester: z.number().int().min(1).max(8),
    bio: z.string().trim().max(280).optional(),
  })
  .strict();

export const roleSchema = z.enum(USER_ROLES);

// Public user shape returned by /auth/me, /auth/login, etc.
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  name: z.string(),
  role: roleSchema,
  department: z.string().nullable(),
  batchYear: z.string().nullable(),
  semester: z.number().int().nullable(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  onboardingComplete: z.boolean(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;

export type LoginResponse = {
  accessToken: string;
  user: AuthUser;
};
