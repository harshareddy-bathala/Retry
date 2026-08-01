import { cn } from '../../../lib/cn.js';
import { toastStore, useToasts, type ToastTone } from './toast-store.js';

const TONE: Record<ToastTone, string> = {
  info: 'border-edge',
  warn: 'border-warn/40',
  danger: 'border-danger/40',
};

const DOT: Record<ToastTone, string> = {
  info: 'bg-ink-muted',
  warn: 'animate-pulse bg-warn',
  danger: 'bg-danger',
};

/**
 * The world's one notification region, top-centre of the stage.
 *
 * `aria-live="polite"` on the container rather than on each toast: a blind
 * student was previously never told they had been evicted from a room or that
 * someone was knocking, because those elements were simply inserted into the
 * DOM. `role="status"` implies polite+atomic, and the region persists across
 * toasts so additions are announced.
 *
 * Sits at z-toast, ABOVE the sidebar. That inversion is deliberate: a knock at
 * the door used to render underneath the panel rail.
 */
export function ToastRegion() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-3 z-toast flex flex-col items-center gap-2 px-3"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'pointer-events-auto flex max-w-lg items-center gap-3 rounded-card border bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur',
            TONE[toast.tone],
          )}
        >
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT[toast.tone])} />
          <p className="text-xs text-ink">{toast.body}</p>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.run}
              className="shrink-0 rounded-card border border-edge px-2.5 py-1 text-xs text-ink hover:bg-accent-tint"
            >
              {toast.action.label}
            </button>
          )}
          {toast.dismissible && (
            <button
              type="button"
              onClick={() => toastStore.dismiss(toast.id)}
              className="shrink-0 rounded-card border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
