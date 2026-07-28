import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from './button.js';

// Loading, empty and failed are three different things and used to be drawn as
// one — or as nothing at all. Across the whole app there was exactly one
// `isError` and zero `isLoading`, so a failed request was indistinguishable
// from an empty result: the rooms list showed "No rooms yet" when the API was
// down, and chat flashed "No messages yet. Say hi!" on every single open.

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-accent',
        className,
      )}
    />
  );
}

/** A grey block standing in for content that is on its way. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-card bg-edge/60', className)} />;
}

/** Rows of skeleton, for a list whose shape is known before its contents are. */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/** A whole route on its way in. Used instead of `Suspense fallback={null}`. */
export function RouteFallback({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-ink-muted"
    >
      <Spinner className="h-6 w-6" />
      <p className="font-mono text-xs">{label}</p>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-edge px-4 py-6 text-center">
      <p className="text-sm text-ink">{title}</p>
      {children && <div className="mt-1 text-xs text-ink-muted">{children}</div>}
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({
  title = 'That didn’t load',
  detail,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-2 rounded-panel border border-danger/40 bg-danger-tint px-4 py-3',
        className,
      )}
    >
      <p className="text-sm text-ink">{title}</p>
      {detail && <p className="font-mono text-[11px] text-ink-muted">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
