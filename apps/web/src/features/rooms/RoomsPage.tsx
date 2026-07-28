import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROOM_MAP_TEMPLATES, ROOM_MAP_TEMPLATE_LABELS } from '@retry/types';
import type {
  CreateRoomInput,
  ListRoomsResponse,
  RoomAccessPolicy,
  RoomMapTemplate,
  RoomSummary,
  RoomVisibility,
} from '@retry/types';
import { EmptyState, ErrorState, SkeletonList } from '../../components/ui/states.js';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../auth/AuthContext.js';
import { cn } from '../../lib/cn.js';
import { formatWhen } from '../../lib/when.js';

// Rooms tab (rooms build plan Phase 4): my rooms + discoverable public rooms +
// creation. Private rooms are reachable ONLY from here — they have no door in
// the Commons (privacy by absence).

const POLICY_LABEL: Record<RoomAccessPolicy, string> = {
  open: 'open',
  knock: 'knock to enter',
  invite_only: 'invite only',
};

export default function RoomsPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  const rooms = useQuery({
    queryKey: ['rooms'],
    queryFn: () => api.get<ListRoomsResponse>('/rooms'),
    enabled: isStudent,
  });

  if (!user) return null;
  if (!isStudent) {
    return (
      <div className="rounded-panel border border-edge bg-surface px-6 py-12 text-center">
        <p className="text-sm text-ink-muted">
          Collaboration Rooms are a student space — faculty and alumni don&apos;t have access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ink">Rooms</h2>
        <Link
          to="/world"
          className="rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Enter the world
        </Link>
      </div>

      <CreateRoomForm />

      {/* Loading and failed both used to render as EMPTY: the two headings
          appeared with nothing under either, so a room list that could not be
          fetched was indistinguishable from having no rooms. `rooms.isError`
          was never read at all. */}
      {rooms.isError ? (
        <ErrorState
          title="Couldn't load your rooms."
          detail={
            rooms.error instanceof ApiError ? rooms.error.message : 'The server did not answer.'
          }
          onRetry={() => void rooms.refetch()}
        />
      ) : rooms.isPending ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-[11px] uppercase text-ink-muted">My rooms</h3>
            {rooms.data.mine.length === 0 && (
              <EmptyState title="No rooms yet — create one above." />
            )}
            {rooms.data.mine.map((room) => <RoomCard key={room.id} room={room} mine />)}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-[11px] uppercase text-ink-muted">
              Discover public rooms
            </h3>
            {rooms.data.discover.length === 0 && (
              <EmptyState title="Nothing public yet.">
                Public rooms get a door in the Commons that anyone can walk through.
              </EmptyState>
            )}
            {rooms.data.discover.map((room) => (
              <RoomCard key={room.id} room={room} mine={false} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * What pressing the button will actually do. Labelling an invite-only room
 * "Enter" was a small lie that ended in a denial toast: a visitor to such a
 * room is refused, and the honest label says so before the click.
 */
function entryLabel(room: RoomSummary, mine: boolean): { label: string; disabled: boolean } {
  if (mine) return { label: 'Enter', disabled: false };
  if (room.accessPolicy === 'knock') return { label: 'Knock', disabled: false };
  if (room.accessPolicy === 'invite_only') return { label: 'Invite only', disabled: true };
  return { label: 'Enter', disabled: false };
}

function RoomCard({ room, mine }: { room: RoomSummary; mine: boolean }) {
  const here = room.presentMembers;
  const entry = entryLabel(room, mine);
  return (
    <div className="flex items-center justify-between gap-3 rounded-panel border border-edge bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="font-display text-sm font-semibold text-ink">
          {room.name}
          {room.visibility === 'private' && (
            <span className="ml-2 font-mono text-[10px] uppercase text-ink-muted">private</span>
          )}
        </p>
        <p className="font-mono text-[11px] text-ink-muted">
          {POLICY_LABEL[room.accessPolicy]}
          {mine && room.memberRole ? ` · ${room.memberRole}` : ''} · {room.memberCount}{' '}
          {room.memberCount === 1 ? 'member' : 'members'} · active {formatWhen(room.lastActivityAt)}
        </p>
        {room.visibility === 'public' && !room.hasDoor && (
          // Doorless is a normal state, not a failure — say so plainly, or the
          // owner goes looking for a door on the Commons wall that isn't there.
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            No door in the Commons yet — enter from here. It gets one when a door frees up.
          </p>
        )}
        {here.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-accent">
            {/* FR-ROOM-08: who is in there right now, by name — this is a
                20-person room, not a stadium. */}
            {here.map((m) => m.name.split(' ')[0]).join(', ')}{' '}
            {here.length === 1 ? 'is' : 'are'} in the live space
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {mine && (
          <Link
            to={`/rooms/${room.id}`}
            className="rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Open
          </Link>
        )}
        {entry.disabled ? (
          <span
            title="Ask a member for an invite — it will show up in your notifications."
            className="cursor-not-allowed rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted opacity-60"
          >
            {entry.label}
          </span>
        ) : (
          <Link
            to={`/world?map=${room.id}`}
            className="rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            {entry.label}
          </Link>
        )}
      </div>
    </div>
  );
}

function CreateRoomForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<RoomVisibility>('private');
  const [accessPolicy, setAccessPolicy] = useState<RoomAccessPolicy>('open');
  const [mapTemplate, setMapTemplate] = useState<RoomMapTemplate>('studio_a');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: CreateRoomInput) => api.post<{ room: RoomSummary }>('/rooms', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setOpen(false);
      setName('');
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not create the room.');
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-card border border-edge px-4 py-2 text-sm text-ink-muted hover:text-ink"
      >
        + New room
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-panel border border-edge bg-surface px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          name,
          visibility,
          accessPolicy: visibility === 'private' ? 'invite_only' : accessPolicy,
          mapTemplate,
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        {/* A placeholder is not a label: it disappears the moment you type,
            and a screen reader announcing "edit text, blank" for the only
            required field on the form is not a form anyone can fill in. */}
        <span className="font-display text-[13px] font-medium text-ink">Room name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Second-year capstone"
          minLength={2}
          maxLength={80}
          required
          className="rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </label>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <span className="font-mono text-[11px] uppercase text-ink-muted">Visibility</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as RoomVisibility)}
            className="rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink"
          >
            <option value="private">Private (unlisted, no door)</option>
            <option value="public">Public (door in the Commons)</option>
          </select>
        </label>
        {visibility === 'public' && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <span className="font-mono text-[11px] uppercase text-ink-muted">Door policy</span>
            <select
              value={accessPolicy}
              onChange={(e) => setAccessPolicy(e.target.value as RoomAccessPolicy)}
              className="rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink"
            >
              <option value="open">Open — anyone may enter</option>
              <option value="knock">Knock — members admit visitors</option>
              <option value="invite_only">Invite only — members only</option>
            </select>
          </label>
        )}
      </div>
      {/* The room itself. Permanent — the geometry is the template's, so this is
          not something to flip later on a room people already work in. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="font-mono text-[11px] uppercase text-ink-muted">Room</legend>
        <div className="flex flex-wrap gap-1.5">
          {ROOM_MAP_TEMPLATES.map((key) => (
            <button
              key={key}
              type="button"
              title={ROOM_MAP_TEMPLATE_LABELS[key].blurb}
              onClick={() => setMapTemplate(key)}
              className={cn(
                'rounded-card border px-3 py-1.5 text-sm transition-colors',
                key === mapTemplate
                  ? 'border-accent bg-accent-tint text-ink'
                  : 'border-edge text-ink-muted hover:border-accent/60 hover:text-ink',
              )}
            >
              {ROOM_MAP_TEMPLATE_LABELS[key].name}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">{ROOM_MAP_TEMPLATE_LABELS[mapTemplate].blurb}</p>
      </fieldset>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className={cn(
            'rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink',
            create.isPending ? 'opacity-60' : 'hover:opacity-90',
          )}
        >
          Create room
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-card border border-edge px-4 py-2 text-sm text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
