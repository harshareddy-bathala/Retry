import { useEffect, useState } from 'react';
import { AVATARS } from '@retry/maps';
import makerUrl from '@retry/maps/avatars/maker.png';
import plannerUrl from '@retry/maps/avatars/planner.png';
import nightowlUrl from '@retry/maps/avatars/nightowl.png';
import explorerUrl from '@retry/maps/avatars/explorer.png';
import tinkererUrl from '@retry/maps/avatars/tinkerer.png';
import connectorUrl from '@retry/maps/avatars/connector.png';
import { cn } from '../../lib/cn.js';
import { roomEvents } from './event-bus.js';
import { roomSocket } from './net/room-socket.js';

// The sprite picker (FR-ROOM-24). Shown once, the first time a student enters
// a room's live space, and never again — the server answers "have you chosen
// here before?", because a student may have chosen months ago on a laptop they
// are not sitting at now.
//
// They pick by PERSONALITY, not by appearance: the blurb is the actual choice,
// and the character is what that choice looks like from above.

const SHEETS: Record<string, string> = {
  maker: makerUrl,
  planner: plannerUrl,
  nightowl: nightowlUrl,
  explorer: explorerUrl,
  tinkerer: tinkererUrl,
  connector: connectorUrl,
};

const SHEET_COLUMNS = 4;
const SHEET_ROWS = 4;
const SCALE = 3;
const FRAME = 32;

export function AvatarPicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        if (msg.t !== 'avatarState') return;
        setCurrent(msg.sprite);
        // Only ever opened by the server saying "never chosen here".
        if (!msg.chosen) setOpen(true);
      }),
    [],
  );

  if (!open) return null;

  const choose = (key: string): void => {
    roomSocket.send({ t: 'avatar', sprite: key });
    setCurrent(key);
    setOpen(false);
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-panel border border-edge bg-surface p-5">
        <h2 className="font-display text-lg font-semibold text-ink">Who are you in here?</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Pick the one that sounds most like you. You can be someone else in a different room.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {AVATARS.map((spec) => (
            <button
              key={spec.key}
              type="button"
              onClick={() => choose(spec.key)}
              className={cn(
                'flex items-center gap-3 rounded-card border px-3 py-3 text-left transition-colors',
                spec.key === current
                  ? 'border-accent bg-accent-tint'
                  : 'border-edge hover:border-accent/60 hover:bg-page',
              )}
            >
              <span
                aria-hidden
                className="shrink-0 rounded-card"
                style={{
                  width: FRAME * SCALE,
                  height: FRAME * SCALE,
                  backgroundImage: `url(${SHEETS[spec.key]})`,
                  // Frame 0 of row 0 — the idle, facing-you pose.
                  backgroundSize: `${FRAME * SHEET_COLUMNS * SCALE}px ${FRAME * SHEET_ROWS * SCALE}px`,
                  backgroundPosition: '0 0',
                  // Never let the browser smooth pixel art.
                  imageRendering: 'pixelated',
                  backgroundColor: 'rgba(0,0,0,0.18)',
                }}
              />
              <span className="min-w-0">
                <span className="block font-display text-sm font-semibold text-ink">
                  {spec.name}
                </span>
                <span className="block text-sm text-ink-muted">{spec.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
