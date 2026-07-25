import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { forgotPasswordSchema, resetPasswordSchema } from '@retry/types';
import type { ForgotPasswordInput } from '@retry/types';
import type { z } from 'zod';
import { AuthLayout, AuthPanel, Button, FormError, TextField } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';

// FR-AUTH-08 — request a reset link
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (input) => {
    await api.post('/auth/forgot-password', input).catch(() => undefined);
    setSent(true); // same UI either way — no account enumeration
  });

  return (
    <AuthLayout>
      <AuthPanel>
        <h2 className="font-display text-[19px] font-semibold text-ink">Reset your password</h2>
        {sent ? (
          <p className="mt-2 text-sm text-ink-muted">
            If that account exists, a reset link is on its way. The link expires in 1 hour.
          </p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
            <TextField
              label="College email"
              type="email"
              autoComplete="email"
              placeholder="you@nttf.co.in"
              error={errors.email?.message}
              {...register('email')}
            />
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-ink-muted">
          <Link to="/login" className="text-accent hover:underline">
            Back to login
          </Link>
        </p>
      </AuthPanel>
    </AuthLayout>
  );
}

// Landing page for the emailed link: /reset-password?token=...
const resetFormSchema = resetPasswordSchema.pick({ password: true });
type ResetFormInput = z.infer<typeof resetFormSchema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormInput>({ resolver: zodResolver(resetFormSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  });

  if (!token) {
    return (
      <AuthLayout>
        <AuthPanel className="text-center">
          <p className="text-sm text-danger">This reset link is malformed.</p>
          <Link to="/forgot-password" className="mt-4 block">
            <Button type="button">Request a new link</Button>
          </Link>
        </AuthPanel>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthPanel>
        <h2 className="font-display text-[19px] font-semibold text-ink">Choose a new password</h2>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="at least 10 characters"
            error={errors.password?.message}
            {...register('password')}
          />
          <FormError message={formError} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </AuthPanel>
    </AuthLayout>
  );
}
