import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Tooltip } from './tooltip.js';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /**
   * REQUIRED. Becomes both the accessible name and the tooltip. An icon-only
   * control with only a `title` has no reliable name in a screen reader and
   * none at all on touch — which is what the room rail used to ship.
   */
  label: string;
  icon: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  active?: boolean;
  /** Rendered over the icon's top-right. Not announced — put it in `label`. */
  badge?: ReactNode;
};

export function IconButton({
  label,
  icon,
  side = 'left',
  active = false,
  badge,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={label} side={side}>
      <button
        {...props}
        type={type}
        aria-label={label}
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-card transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          active ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:bg-page hover:text-ink',
          className,
        )}
      >
        {icon}
        {badge}
      </button>
    </Tooltip>
  );
}
