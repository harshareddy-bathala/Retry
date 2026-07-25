import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// Primitives matching the Figma auth frames: 18px panel radius, 12px controls,
// copper primary button, Space Grotesk labels, mono helper text.

export function AuthPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full max-w-[400px] rounded-panel border border-edge bg-surface p-7',
        className,
      )}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'w-full rounded-card px-4 py-2.5 font-display text-sm font-medium transition-opacity',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-accent text-accent-ink hover:opacity-90',
        variant === 'ghost' && 'text-ink hover:bg-accent-tint',
        className,
      )}
    />
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={inputId} className="font-display text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        {...props}
        className={cn(
          'w-full rounded-card border border-edge bg-surface px-3.5 py-2.5 text-sm text-ink',
          'placeholder:text-ink-muted/70 focus:border-accent focus:outline-none',
          error && 'border-danger',
          className,
        )}
      />
      {error ? (
        <p className="font-mono text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="font-mono text-[11px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="w-full rounded-card bg-danger-tint px-3.5 py-2.5 text-sm text-danger">{message}</p>
  );
}

// Centered single-panel layout with the Retry wordmark, per login/signup/onboarding frames
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-7 bg-page px-4 py-9">
      <h1 className="font-display text-[22px] font-bold tracking-tight text-ink">Retry</h1>
      {children}
    </main>
  );
}
