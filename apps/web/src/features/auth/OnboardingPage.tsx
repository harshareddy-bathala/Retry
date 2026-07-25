import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { onboardingSchema, type AuthUser, type OnboardingInput } from '@retry/types';
import { AuthLayout, AuthPanel, Button, FormError, TextField } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from './AuthContext.js';
import { cn } from '../../lib/cn.js';

const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'ME', 'TDM', 'MC'];
const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

// FR-AUTH-04: first-login profile form (onboarding frame — name/department/batch/semester/bio)
export function OnboardingPage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { name: user?.name ?? '', semester: undefined },
  });

  const onSubmit = handleSubmit(async (input) => {
    setFormError(null);
    try {
      const { user: updated } = await api.post<{ user: AuthUser }>('/auth/onboarding', input);
      refreshUser(updated);
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  });

  const selectClass = cn(
    'w-full rounded-card border border-edge bg-surface px-3.5 py-2.5 text-sm text-ink',
    'focus:border-accent focus:outline-none',
  );

  return (
    <AuthLayout>
      <AuthPanel className="max-w-[420px]">
        <h2 className="font-display text-[19px] font-semibold text-ink">Set up your profile</h2>
        <p className="mt-1 text-sm text-ink-muted">
          This is what other students and faculty will see on your posts.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 flex flex-col gap-4" noValidate>
          <TextField label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="department" className="font-display text-[13px] font-medium text-ink">
                Department
              </label>
              <select id="department" className={selectClass} defaultValue="" {...register('department')}>
                <option value="" disabled>
                  Select…
                </option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {errors.department && (
                <p className="font-mono text-[11px] text-danger">{errors.department.message}</p>
              )}
            </div>
            <TextField
              label="Batch year"
              placeholder="2023-2026"
              error={errors.batchYear?.message}
              {...register('batchYear')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="semester" className="font-display text-[13px] font-medium text-ink">
              Current semester
            </label>
            <select
              id="semester"
              className={selectClass}
              defaultValue=""
              {...register('semester', { valueAsNumber: true })}
            >
              <option value="" disabled>
                Select…
              </option>
              {SEMESTERS.map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
            {errors.semester && (
              <p className="font-mono text-[11px] text-danger">{errors.semester.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="bio" className="font-display text-[13px] font-medium text-ink">
                Short bio
              </label>
              <span className="font-mono text-[11px] text-ink-muted">optional</span>
            </div>
            <textarea
              id="bio"
              rows={3}
              placeholder="building small tools for lab work · interested in embedded + ML"
              className={cn(selectClass, 'resize-none placeholder:text-ink-muted/70')}
              {...register('bio')}
            />
            <p className="font-mono text-[11px] text-ink-muted">
              one line — what you build or what you&rsquo;re into
            </p>
          </div>
          <FormError message={formError} />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Finish setup'}
          </Button>
        </form>
      </AuthPanel>
    </AuthLayout>
  );
}
