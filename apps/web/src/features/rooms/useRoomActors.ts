import { useEffect, useState } from 'react';
import type { Actor } from '@retry/protocol';
import { roomEvents } from './event-bus.js';

// Live actor roster for the current map, maintained from server messages.
// Shared by the presence strip and the bubble overlay.
export function useRoomActors(): Map<string, Actor> {
  const [actors, setActors] = useState<Map<string, Actor>>(new Map());

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        setActors((prev) => {
          switch (msg.t) {
            case 'snapshot':
              return new Map(msg.actors.map((a) => [a.userId, a]));
            case 'actorJoin': {
              const next = new Map(prev);
              next.set(msg.actor.userId, msg.actor);
              return next;
            }
            case 'actorLeave': {
              const next = new Map(prev);
              next.delete(msg.userId);
              return next;
            }
            case 'mediaState': {
              const existing = prev.get(msg.userId);
              if (!existing) return prev;
              const next = new Map(prev);
              next.set(msg.userId, { ...existing, audio: msg.audio, video: msg.video });
              return next;
            }
            default:
              return prev;
          }
        });
      }),
    [],
  );

  return actors;
}
