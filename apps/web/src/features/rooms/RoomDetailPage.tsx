import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  RoomAccessPolicy,
  RoomMemberDto,
  RoomMembersResponse,
  RoomSummary,
  RoomVisibility,
} from '@retry/types';
import { api, ApiError, getAccessToken } from '../../lib/api.js';
import { cn } from '../../lib/cn.js';
import { formatWhen } from '../../lib/when.js';
import { useAuth } from '../auth/AuthContext.js';
import { DEFAULT_AVATAR } from '@retry/maps';
import { roomSocket } from './net/room-socket.js';
import { ContextHeader } from './workspace/ContextHeader.js';
import { BlueprintPanel } from './workspace/BlueprintPanel.js';
import { JourneyTimeline } from './workspace/JourneyTimeline.js';
import { WorkspacePanels } from './workspace/WorkspacePanels.js';
import { useWorkspace } from './workspace/use-workspace.js';

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';

// The Workspace (R4) — the half of a room that works when nobody else is
// online, and the view a member lands on (FR-ROOM-09). Project context,
// Blueprint, Build Journey, chat, board and whiteboard, all without entering
// the 2D world. It subscribes to the room over the SAME socket the Live Space
// uses, in `watch` mode: live updates, no avatar.

const POLICY_LABEL: Record<RoomAccessPolicy, string> = {
  open: 'anyone may walk in',
  knock: 'visitors knock to enter',
  invite_only: 'members only',
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function RoomDetailPage() {
  const { roomId = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { state: workspace, status: workspaceStatus } = useWorkspace(roomId);

  // One socket per page, in watch mode. Opening a room's Workspace must never
  // put your avatar in its live map — reading the board is not presence.
  useEffect(() => {
    const token = getAccessToken();
    if (!user || !token || !roomId) return;
    roomSocket.connect({
      url: ROOM_WS_URL,
      token,
      mode: 'watch',
      roomId,
      displayName: user.name,
      sprite: DEFAULT_AVATAR,
    });
    return () => roomSocket.disconnect();
  }, [user, roomId]);

  // Removed from the room while looking at it.
  useEffect(() => {
    if (workspaceStatus === 'gone') navigate('/rooms');
  }, [workspaceStatus, navigate]);

  const room = useQuery({
    queryKey: ['room', roomId],
    queryFn: () => api.get<{ room: RoomSummary }>(`/rooms/${roomId}`),
    enabled: roomId.length > 0,
    // Member count and last-activity move while you are looking at the page —
    // someone accepting an invite should not leave the header saying "1 member".
    refetchInterval: 15_000,
    staleTime: 0,
  });
  const roster = useQuery({
    queryKey: ['room', roomId, 'members'],
    queryFn: () => api.get<RoomMembersResponse>(`/rooms/${roomId}/members`),
    enabled: roomId.length > 0,
    // Presence is the point of this list, so it refetches on its own clock and
    // ignores the global staleTime — a stale "who's here" is just wrong.
    refetchInterval: 15_000,
    staleTime: 0,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['room', roomId] });
    void queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  if (room.isError) {
    return (
      <div className="rounded-panel border border-edge bg-surface px-6 py-12 text-center">
        <p className="text-sm text-ink-muted">
          {errorText(room.error, 'That room is not available.')}
        </p>
        <Link to="/rooms" className="mt-3 inline-block text-sm text-accent hover:underline">
          ← back to rooms
        </Link>
      </div>
    );
  }
  if (!room.data || !user) return null;

  const detail = room.data.room;
  const isOwner = detail.ownerId === user.id;
  const isMember = detail.memberRole !== null;
  const members = roster.data?.members ?? [];
  const presentIds = new Set(workspace?.present.map((p) => p.userId) ?? []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/rooms" className="text-sm text-accent hover:underline">
            ← my rooms
          </Link>
          <h2 className="mt-1 font-display text-xl font-semibold text-ink">{detail.name}</h2>
          <p className="font-mono text-[11px] uppercase text-ink-muted">
            {detail.visibility} · {POLICY_LABEL[detail.accessPolicy]} · {detail.memberCount}{' '}
            {detail.memberCount === 1 ? 'member' : 'members'}
          </p>
          {detail.description && <p className="mt-2 max-w-xl text-sm text-ink">{detail.description}</p>}
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            Last active {formatWhen(detail.lastActivityAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link
            to={`/world?map=${detail.id}`}
            className="rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Enter live space
          </Link>
          {workspace && workspace.present.length > 0 && (
            <p className="font-mono text-[11px] text-accent">
              {workspace.present.map((p) => p.displayName.split(' ')[0]).join(', ')}{' '}
              {workspace.present.length === 1 ? 'is' : 'are'} in there now
            </p>
          )}
        </div>
      </div>

      {isMember && (
        <ContextHeader
          stage={workspace?.stage ?? 'ideation'}
          domainTag={workspace?.domainTag ?? null}
          disabled={workspaceStatus !== 'ready'}
        />
      )}

      {isMember ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <WorkspacePanels roomId={roomId} selfUserId={user.id} />
            <JourneyTimeline entries={workspace?.journey ?? []} />
          </div>
          <div className="flex flex-col gap-6">
            <BlueprintPanel
              blueprint={
                workspace?.blueprint ?? { problem: null, audience: null, existing: null }
              }
              lastEdit={workspace?.lastEdit ?? {}}
            />
            <MemberList
              members={members}
              presentIds={presentIds}
              selfId={user.id}
              isOwner={isOwner}
              roomId={roomId}
              onChanged={refresh}
            />
            {isOwner && <InviteForm roomId={roomId} onInvited={refresh} />}
          </div>
        </div>
      ) : (
        <p className="rounded-panel border border-edge bg-surface px-4 py-6 text-sm text-ink-muted">
          You are not a member of this room. Public rooms can be visited from the Commons, but the
          workspace — chat, board, blueprint — is for members.
        </p>
      )}

      {isOwner && <OwnerSettings room={detail} onChanged={refresh} />}
    </div>
  );
}

function MemberList({
  members,
  presentIds,
  selfId,
  isOwner,
  roomId,
  onChanged,
}: {
  members: RoomMemberDto[];
  /** Live from the socket; the REST flag is only a fallback between polls. */
  presentIds: Set<string>;
  selfId: string;
  isOwner: boolean;
  roomId: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/rooms/${roomId}/members/${userId}`),
    onSuccess: (_data, userId) => {
      setError(null);
      // Leaving means this page is no longer yours to look at.
      if (userId === selfId) navigate('/rooms');
      else onChanged();
    },
    onError: (err: unknown) => setError(errorText(err, 'Could not update the members.')),
  });

  const transfer = useMutation({
    mutationFn: (userId: string) => api.post(`/rooms/${roomId}/transfer`, { userId }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: unknown) => setError(errorText(err, 'Could not transfer the room.')),
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] uppercase text-ink-muted">Members</h3>
      <ul className="divide-y divide-edge rounded-panel border border-edge bg-surface">
        {members.map((member) => {
          const present = presentIds.has(member.userId) || member.present;
          return (
          <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                title={present ? 'in the live space now' : 'not online'}
                className={cn('h-2 w-2 rounded-full', present ? 'bg-accent' : 'bg-edge')}
              />
              <div>
                <p className="font-display text-sm text-ink">
                  {member.name}
                  {member.userId === selfId && (
                    <span className="ml-2 font-mono text-[10px] uppercase text-ink-muted">you</span>
                  )}
                </p>
                <p className="font-mono text-[11px] text-ink-muted">
                  {member.role} · joined {formatWhen(member.joinedAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && member.userId !== selfId && (
                <>
                  <button
                    type="button"
                    onClick={() => transfer.mutate(member.userId)}
                    className="rounded-card border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                  >
                    Make owner
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(member.userId)}
                    className="rounded-card border border-edge px-2.5 py-1 text-xs text-danger hover:bg-danger-tint"
                  >
                    Remove
                  </button>
                </>
              )}
              {member.userId === selfId && (
                <button
                  type="button"
                  onClick={() => remove.mutate(member.userId)}
                  className="rounded-card border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                >
                  Leave room
                </button>
              )}
            </div>
          </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}

function InviteForm({ roomId, onInvited }: { roomId: string; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (value: string) => api.post(`/rooms/${roomId}/invites`, { email: value }),
    onSuccess: () => {
      setSentTo(email);
      setEmail('');
      setError(null);
      onInvited();
    },
    onError: (err: unknown) => {
      setSentTo(null);
      setError(errorText(err, 'Could not send that invite.'));
    },
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] uppercase text-ink-muted">Invite someone</h3>
      <form
        className="flex flex-wrap items-center gap-2 rounded-panel border border-edge bg-surface px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate(email.trim());
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their college email"
          className="min-w-[16rem] flex-1 rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={send.isPending}
          className="rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          Send invite
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {sentTo && (
        <p className="text-sm text-ink-muted">
          Invite sent to {sentTo}. They join once they accept it.
        </p>
      )}
    </section>
  );
}

function OwnerSettings({ room, onChanged }: { room: RoomSummary; onChanged: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? '');
  const [visibility, setVisibility] = useState<RoomVisibility>(room.visibility);
  const [accessPolicy, setAccessPolicy] = useState<RoomAccessPolicy>(room.accessPolicy);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/rooms/${room.id}`, {
        name: name.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        visibility,
        accessPolicy,
      }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: unknown) => setError(errorText(err, 'Could not save those changes.')),
  });

  const destroy = useMutation({
    mutationFn: () => api.del(`/rooms/${room.id}`),
    onSuccess: () => navigate('/rooms'),
    onError: (err: unknown) => setError(errorText(err, 'Could not delete the room.')),
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[11px] uppercase text-ink-muted">Room settings</h3>
      <form
        className="flex flex-col gap-3 rounded-panel border border-edge bg-surface px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
          className="rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="What is this room for? (optional)"
          className="rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-4">
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
        <button
          type="submit"
          disabled={save.isPending}
          className="self-start rounded-card bg-accent px-4 py-2 font-display text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          Save changes
        </button>
      </form>

      <div className="flex flex-col gap-2 rounded-panel border border-danger/40 bg-surface px-4 py-4">
        <p className="font-display text-sm font-semibold text-ink">Delete this room</p>
        <p className="text-sm text-ink-muted">
          The chat, the board and the whiteboard go with it. This cannot be undone.
        </p>
        {deleting ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`Type "${room.name}" to confirm`}
              className="min-w-[16rem] flex-1 rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-danger"
            />
            <button
              type="button"
              disabled={confirmName !== room.name || destroy.isPending}
              onClick={() => destroy.mutate()}
              className="rounded-card bg-danger px-4 py-2 font-display text-sm font-medium text-white disabled:opacity-50"
            >
              Delete for everyone
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleting(false);
                setConfirmName('');
              }}
              className="rounded-card border border-edge px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="self-start rounded-card border border-danger/50 px-4 py-2 text-sm text-danger hover:bg-danger-tint"
          >
            Delete room
          </button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
