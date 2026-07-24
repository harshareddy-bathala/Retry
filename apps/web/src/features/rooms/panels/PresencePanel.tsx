import { useQuery } from '@tanstack/react-query';
import type { RoomMembersResponse } from '@foundry/types';
import { api, ApiError } from '../../../lib/api.js';
import { useRoomActors } from '../useRoomActors.js';

type PresencePanelProps = { roomId: string };

// Live presence (FR-ROOM-07/08, replacing the plan's session-log panel — the
// SRS forbids attendance history; the only real-time data is who is present
// RIGHT NOW). Roster from the API, live status from the world socket.
export function PresencePanel({ roomId }: PresencePanelProps) {
  const actors = useRoomActors();
  const members = useQuery({
    queryKey: ['room-members', roomId],
    queryFn: () => api.get<RoomMembersResponse>(`/rooms/${roomId}/members`),
    retry: false,
  });
  const memberBlocked = members.error instanceof ApiError && members.error.status === 403;

  const roster = members.data?.members ?? [];
  const rosterIds = new Set(roster.map((m) => m.userId));
  // People currently here who aren't members (open-room visitors, guests).
  const visitors = [...actors.values()].filter((a) => !rosterIds.has(a.userId));

  return (
    <div className="flex h-full flex-col">
      <p className="border-b border-edge px-3 py-2 font-mono text-[11px] uppercase text-ink-muted">
        Members
      </p>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {memberBlocked && (
          <p className="mb-2 rounded-card bg-page px-2 py-1.5 text-xs text-ink-muted">
            You&apos;re visiting — showing who is here right now.
          </p>
        )}
        {roster.map((m) => {
          const active = actors.has(m.userId);
          return (
            <div key={m.userId} className="mb-2 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-edge'}`}
              />
              <div>
                <p className="text-sm text-ink">{m.name}</p>
                <p className="font-mono text-[10px] text-ink-muted">
                  {m.role}
                  {active ? ' · Active now' : ''}
                </p>
              </div>
            </div>
          );
        })}
        {visitors.length > 0 && (
          <>
            <p className="mb-1 mt-3 font-mono text-[10px] uppercase text-ink-muted">Visiting</p>
            {visitors.map((a) => (
              <div key={a.userId} className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <p className="text-sm text-ink">{a.displayName}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
