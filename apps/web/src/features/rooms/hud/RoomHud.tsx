import type { ReactNode } from 'react';

type RoomHudProps = {
  /** Room identity, connection, leave. Spans the full width. */
  top: ReactNode;
  /** The world: the Phaser canvas, plus anything glued to it. */
  stage: ReactNode;
  /** Mic, camera, say, react, look. Centred under the stage. */
  dock: ReactNode;
  /** The always-visible icon column. Never covered by the sidebar. */
  rail: ReactNode;
  /** The open panel. A grid column, so it PUSHES rather than overlaps. */
  sidebar: ReactNode;
  sidebarOpen: boolean;
  /** Full-viewport overlays: the creator, the whiteboard, confirms. */
  modal?: ReactNode;
};

/**
 * The Live Space frame.
 *
 * Every child sits in a named grid area (see `.room-hud` in styles/theme.css),
 * which is the whole point: the previous HUD was eight independently
 * absolutely-positioned floats with hand-picked insets, and at the 1024px
 * minimum three of them physically overlapped.
 *
 * Two rules hold this together:
 *
 *   1. The sidebar is a COLUMN, not an overlay. Opening it narrows the stage,
 *      so the canvas, the minimap and the toasts all move out of its way and
 *      no z-index has to arbitrate anything.
 *   2. Nothing in here positions itself. Slots are content; the frame decides
 *      where content goes. A new control gets a slot, not an inset.
 */
export function RoomHud({
  top,
  stage,
  dock,
  rail,
  sidebar,
  sidebarOpen,
  modal,
}: RoomHudProps) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-page">
      <div className="room-hud" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
        <div data-hud="top" className="z-hud">
          {top}
        </div>

        {/* The world. `position: relative` comes from the stylesheet, so
            anything glued to the canvas anchors to the stage rather than to
            the viewport — which is what makes it move when the sidebar opens. */}
        <div data-hud="stage">{stage}</div>

        <div data-hud="dock" className="z-hud">
          {dock}
        </div>

        <div data-hud="sidebar" className="z-sidebar">
          {sidebar}
        </div>

        <div data-hud="rail" className="z-hud">
          {rail}
        </div>
      </div>

      {modal}
    </div>
  );
}
