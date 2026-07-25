import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateRoomInput,
  ListRoomsResponse,
  RoomAccessPolicy,
  RoomSummary,
  RoomVisibility,
} from '@retry/types';
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
          to="/rooms/live"
          className="rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-white hover:opacity-90"
        >
          Enter the world
        </Link>
      </div>

      <CreateRoomForm />

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[11px] uppercase text-ink-muted">My rooms</h3>
        {rooms.data?.mine.length === 0 && (
          <p className="text-sm text-ink-muted">No rooms yet — create one above.</p>
        )}
        {rooms.data?.mine.map((room) => <RoomCard key={room.id} room={room} mine />)}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[11px] uppercase text-ink-muted">Discover public rooms</h3>
        {rooms.data?.discover.length === 0 && (
          <p className="text-sm text-ink-muted">Nothing public yet.</p>
        )}
        {rooms.data?.discover.map((room) => <RoomCard key={room.id} room={room} mine={false} />)}
      </section>
    </div>
  );
}

function RoomCard({ room, mine }: { room: RoomSummary; mine: boolean }) {
  const here = room.presentMembers;
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
        <Link
          to={`/rooms/live?map=${room.id}`}
          className="rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
        >
          {!mine && room.accessPolicy === 'knock' ? 'Knock' : 'Enter'}
        </Link>
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
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Room name"
        minLength={2}
        maxLength={80}
        required
        className="rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
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
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className={cn(
            'rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-white',
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
