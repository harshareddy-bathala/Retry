import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/** Mounted once, in main.tsx. Radix requires a provider above every tooltip. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

type TooltipProps = {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
};

/**
 * A visible name for an icon-only control.
 *
 * This is not decoration. Icon-only chrome without an accessible name would be
 * a regression on the text buttons it replaced, so `IconButton` pairs every
 * tooltip with an `aria-label` — the tooltip is for people who can see the
 * icon and still cannot guess it.
 */
export function Tooltip({ label, side = 'top', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-modal max-w-xs rounded-card border border-edge bg-surface px-2 py-1 font-mono text-[11px] text-ink shadow-lg"
        >
          {label}
          <RadixTooltip.Arrow className="fill-[var(--edge)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
