import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * `text-accent-ink`, never `text-white`.
 *
 * White on the copper accent (#e2935e) is about 1.9:1 — a WCAG failure at any
 * size — and it was written that way at six call sites while the correct token
 * was used at others, so the same button existed in two incompatible versions.
 * `--accent-ink` (#1a1208) is about 9.4:1 on the same background.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-edge text-ink hover:bg-accent-tint',
  ghost: 'text-ink-muted hover:text-ink hover:bg-accent-tint',
  danger: 'bg-danger text-danger-ink hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-card font-display font-medium transition-opacity',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    />
  );
}

/** Style-only, for the places that must be an anchor or a router `<Link>`. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-card font-display font-medium transition-opacity',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
