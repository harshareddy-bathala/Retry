import { useEffect, useState } from 'react';
import type {
  Blueprint,
  BlueprintFieldKey,
  DomainTag,
  JourneyEntry,
  ProjectStage,
} from '@retry/protocol';
import { roomEvents } from '../event-bus.js';

// Workspace state (R4). Everything here arrives over the same world socket the
// Live Space uses — `workspaceState` once on watch, then incremental events —
// so a Workspace and a Live Space looking at the same room stay in step
// without a second read path.

export type WorkspaceState = {
  roomId: string;
  name: string;
  stage: ProjectStage;
  domainTag: DomainTag | null;
  blueprint: Blueprint;
  journey: JourneyEntry[];
  /** Members standing in the room's live map right now. */
  present: Array<{ userId: string; displayName: string }>;
  /** Who last edited each field, for the "edited by" line under it. */
  lastEdit: Partial<Record<BlueprintFieldKey, { by: string; at: string }>>;
};

export type WorkspaceStatus = 'loading' | 'ready' | 'forbidden' | 'gone';

export function useWorkspace(roomId: string): {
  state: WorkspaceState | null;
  status: WorkspaceStatus;
} {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus>('loading');

  // A different room is a different workspace — never show the old one.
  useEffect(() => {
    setState(null);
    setStatus('loading');
  }, [roomId]);

  useEffect(
    () =>
      roomEvents.on('net:server-message', (msg) => {
        switch (msg.t) {
          case 'workspaceState': {
            if (msg.roomId !== roomId) return;
            setState({
              roomId: msg.roomId,
              name: msg.name,
              stage: msg.stage,
              domainTag: msg.domainTag,
              blueprint: msg.blueprint,
              journey: msg.journey,
              present: msg.present,
              lastEdit: {},
            });
            setStatus('ready');
            break;
          }
          case 'contextState':
            setState((prev) =>
              prev && msg.roomId === prev.roomId
                ? { ...prev, stage: msg.stage, domainTag: msg.domainTag }
                : prev,
            );
            break;
          case 'blueprintField':
            setState((prev) =>
              prev
                ? {
                    ...prev,
                    blueprint: { ...prev.blueprint, [msg.field]: msg.value },
                    lastEdit: {
                      ...prev.lastEdit,
                      [msg.field]: { by: msg.editedByName, at: msg.at },
                    },
                  }
                : prev,
            );
            break;
          case 'journeyEntry':
            setState((prev) =>
              prev && !prev.journey.some((e) => e.id === msg.entry.id)
                ? { ...prev, journey: [...prev.journey, msg.entry] }
                : prev,
            );
            break;
          case 'actorJoin':
            setState((prev) =>
              prev && !prev.present.some((p) => p.userId === msg.actor.userId)
                ? {
                    ...prev,
                    present: [
                      ...prev.present,
                      { userId: msg.actor.userId, displayName: msg.actor.displayName },
                    ],
                  }
                : prev,
            );
            break;
          case 'actorLeave':
            setState((prev) =>
              prev
                ? { ...prev, present: prev.present.filter((p) => p.userId !== msg.userId) }
                : prev,
            );
            break;
          case 'evicted':
            // Removed from the room while reading it: the page has to go.
            if (msg.roomId === roomId) setStatus('gone');
            break;
          case 'error':
            if (msg.code === 'FORBIDDEN') setStatus((prev) => (prev === 'ready' ? prev : 'forbidden'));
            break;
          default:
            break;
        }
      }),
    [roomId],
  );

  return { state, status };
}
