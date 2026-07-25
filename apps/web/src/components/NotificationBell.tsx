import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvitesResponse, NotificationDto, NotificationsResponse } from '@retry/types';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { formatWhen } from '../lib/when.js';

// Notification bell (FR-ROOM-04). Two lists in one panel: invites you can act
// on, and things that have already happened. Polling at a minute is plenty —
// an invite is not a real-time event, and 4000 students on a WebSocket for
// this would be an absurd trade.
const POLL_MS = 60_000;

const NOTIFICATION_TEXT: Record<NotificationDto['kind'], (n: NotificationDto) => string> = {
  room_invite: (n) => `${n.payload.actorName ?? 'Someone'} invited you to ${n.payload.roomName ?? 'a room'}`,
  room_invite_accepted: (n) =>
    `${n.payload.actorName ?? 'Someone'} joined ${n.payload.roomName ?? 'your room'}`,
  room_member_removed: (n) => `You were removed from ${n.payload.roomName ?? 'a room'}`,
  room_deleted: (n) => `${n.payload.roomName ?? 'A room'} was deleted`,
  room_ownership_transferred: (n) => `You now own ${n.payload.roomName ?? 'a room'}`,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.get<InvitesResponse>('/invites'),
    refetchInterval: POLL_MS,
  });
  const feed = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    refetchInterval: POLL_MS,
  });

  // Click-away close: a dropdown that traps you is worse than no dropdown.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['invites'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' }) =>
      api.post<{ roomId?: string }>(`/invites/${id}/${action}`),
    onSuccess: (data, variables) => {
      refresh();
      // Accepting should land you in the room you just joined.
      if (variables.action === 'accept' && data?.roomId) {
        setOpen(false);
        navigate(`/rooms/${data.roomId}`);
      }
    },
  });

  const markRead = useMutation({
    mutationFn: () => api.post('/notifications/read'),
    onSuccess: refresh,
  });

  const pending = invites.data?.invites ?? [];
  const notifications = feed.data?.notifications ?? [];
  // Invites are the actionable half, so they always count as wanting attention.
  const badge = pending.length + (feed.data?.unreadCount ?? 0);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={badge > 0 ? `Notifications (${badge} new)` : 'Notifications'}
        className="relative rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
      >
        Alerts
        {badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-accent px-1 font-mono text-[10px] leading-5 text-accent-ink">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[22rem] rounded-panel border border-edge bg-surface shadow-lg">
          {pending.length > 0 && (
            <div className="border-b border-edge">
              {pending.map((invite) => (
                <div key={invite.id} className="flex flex-col gap-2 px-4 py-3">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{invite.inviterName}</span> invited you to{' '}
                    <span className="font-medium">{invite.roomName}</span>
                  </p>
                  <p className="font-mono text-[11px] text-ink-muted">
                    {formatWhen(invite.createdAt)}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: invite.id, action: 'accept' })}
                      className="rounded-card bg-accent px-3 py-1 font-display text-xs font-medium text-accent-ink disabled:opacity-60"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: invite.id, action: 'decline' })}
                      className="rounded-card border border-edge px-3 py-1 text-xs text-ink-muted hover:text-ink"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notifications.length === 0 && pending.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Nothing new.</p>
          )}

          {notifications.map((item) => (
            <div
              key={item.id}
              className={cn(
                'border-b border-edge px-4 py-2.5 last:border-b-0',
                item.readAt === null && 'bg-accent-tint/40',
              )}
            >
              <p className="text-sm text-ink">{NOTIFICATION_TEXT[item.kind](item)}</p>
              <p className="font-mono text-[11px] text-ink-muted">{formatWhen(item.createdAt)}</p>
            </div>
          ))}

          {(feed.data?.unreadCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => markRead.mutate()}
              className="w-full border-t border-edge px-4 py-2 text-center font-mono text-[11px] uppercase text-ink-muted hover:text-ink"
            >
              Mark all read
            </button>
          )}
        </div>
      )}
    </div>
  );
}
