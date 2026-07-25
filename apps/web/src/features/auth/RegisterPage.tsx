import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { registerSchema, type RegisterInput } from '@retry/types';
import { AuthLayout, AuthPanel, Button, FormError, TextField } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';

// FR-AUTH-01/02: college-email signup → "check your email" state (signup_verify frame)
export function RegisterPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (input) => {
    setFormError(null);
    try {
      await api.post('/auth/register', input);
      setSentTo(input.email);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  });

  if (sentTo) {
    return (
      <AuthLayout>
        <AuthPanel className="flex flex-col items-center gap-2 text-center">
          <h2 className="font-display text-[19px] font-semibold text-ink">Check your college email</h2>
          <p className="text-sm text-ink-muted">We sent a verification link to</p>
          <p className="font-mono text-sm text-ink">{sentTo}</p>
          <p className="mt-2 text-sm text-ink-muted">
            The link expires in 1 hour. You can close this tab and open it from your inbox.
          </p>
          <Link to="/login" className="mt-4 w-full">
            <Button type="button">I&rsquo;ve verified — log in</Button>
          </Link>
        </AuthPanel>
        <button
          type="button"
          onClick={() => setSentTo(null)}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← use a different email
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthPanel>
        <h2 className="font-display text-[19px] font-semibold text-ink">Create your account</h2>
        <p className="mt-1 text-sm text-ink-muted">Sign up with your college email to get started.</p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
          <TextField
            label="Full name"
            autoComplete="name"
            error={errors.name?.message}
            {...register('name')}
          />
          <TextField
            label="College email"
            type="email"
            autoComplete="email"
            placeholder="you@nttf.co.in"
            hint="must be your @nttf.co.in college address"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="at least 10 characters"
            error={errors.password?.message}
            {...register('password')}
          />
          <FormError message={formError} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Continue'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Log in
          </Link>
        </p>
      </AuthPanel>
      <p className="font-mono text-xs text-ink-muted">
        by continuing you agree to the campus terms of use
      </p>
    </AuthLayout>
  );
}
