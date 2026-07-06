import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@foundry/types';
import { AuthLayout, AuthPanel, Button, FormError, TextField } from '../../components/ui.js';
import { ApiError } from '../../lib/api.js';
import { useAuth } from './AuthContext.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (input) => {
    setFormError(null);
    try {
      const user = await login(input);
      // FR-AUTH-04: students land on onboarding until the form is done
      navigate(user.role === 'student' && !user.onboardingComplete ? '/onboarding' : '/', {
        replace: true,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  });

  return (
    <AuthLayout>
      <AuthPanel>
        <h2 className="font-display text-[19px] font-semibold text-ink">Welcome back</h2>
        <p className="mt-1 text-sm text-ink-muted">Log in with your college email.</p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
          <TextField
            label="College email"
            type="email"
            autoComplete="email"
            placeholder="you@nttf.co.in"
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <FormError message={formError} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-ink-muted hover:text-ink">
            Forgot password?
          </Link>
          <span className="text-ink-muted">
            New here?{' '}
            <Link to="/register" className="text-accent hover:underline">
              Create account
            </Link>
          </span>
        </div>
      </AuthPanel>
      <p className="font-mono text-xs text-ink-muted">by continuing you agree to the campus terms of use</p>
    </AuthLayout>
  );
}
