import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { useInputLayer } from '../../features/rooms/input/useInputLayer.js';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Hide the title visually but keep it for assistive tech. */
  hideTitle?: boolean;
  /** False for a dialog that must be answered — the character creator's first run. */
  dismissible?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * The app's only modal.
 *
 * Three overlays previously behaved as modals — the character creator, the
 * whiteboard, and the delete confirmation — and none of them had
 * `role="dialog"`, `aria-modal`, a focus trap, initial focus, or focus return.
 * Tab from behind the character creator walked straight through to the Leave
 * link underneath it. Radix does that part correctly, which is precisely the
 * part that is subtle to hand-roll.
 *
 * Escape is routed through the input-layer stack rather than Radix's own
 * handler (`onEscapeKeyDown` is prevented) so that the world has ONE Escape
 * rule: peel exactly one layer, and reach "leave the world" only when nothing
 * is stacked. A dialog that closed itself on Escape would jump the queue.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  dismissible = true,
  className,
  children,
}: DialogProps) {
  useInputLayer(open, {
    kind: 'modal',
    name: `dialog:${title}`,
    capturesKeys: true,
    onEscape: () => {
      if (!dismissible) return false;
      onOpenChange(false);
      return true;
    },
  });

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-modal bg-black/60 backdrop-blur-[1px]" />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-modal max-h-[90vh] w-[min(40rem,calc(100vw-2rem))]',
            '-translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'rounded-panel border border-edge bg-surface p-6 shadow-xl',
            'focus:outline-none',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className={cn(hideTitle && 'sr-only')}>
              <RadixDialog.Title className="font-display text-lg text-ink">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-ink-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {dismissible && (
              <RadixDialog.Close
                aria-label={`Close ${title}`}
                className="shrink-0 rounded-card p-1 text-ink-muted transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={16} aria-hidden />
              </RadixDialog.Close>
            )}
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
