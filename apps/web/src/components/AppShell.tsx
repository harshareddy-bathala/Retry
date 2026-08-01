import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.js';
import { cn } from '../lib/cn.js';
import { NotificationBell } from './NotificationBell.js';

// Top nav per the Figma feed frames: wordmark, primary nav, user block.
// Sections beyond Feed arrive with their phases — links stay disabled until then.
const NAV_ITEMS = [
  { to: '/', label: 'Feed', enabled: true },
  { to: '/ideas', label: 'Idea Hub', enabled: false },
  { to: '/rooms', label: 'Rooms', enabled: true },
  { to: '/notifications', label: 'Notifications', enabled: false },
];

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-header border-b border-edge bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <span className="font-display text-lg font-bold tracking-tight text-ink">Retry</span>
          <nav className="flex flex-1 items-center gap-1">
            {NAV_ITEMS.map((item) =>
              item.enabled ? (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-card px-3 py-1.5 font-display text-sm',
                      isActive ? 'bg-accent-tint text-accent' : 'text-ink-muted hover:text-ink',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ) : (
                <span
                  key={item.to}
                  title="coming soon"
                  className="cursor-default rounded-card px-3 py-1.5 font-display text-sm text-ink-muted/50"
                >
                  {item.label}
                </span>
              ),
            )}
          </nav>
          {user && (
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="text-right">
                <p className="font-display text-sm text-ink">{user.name}</p>
                <p className="font-mono text-[11px] uppercase text-ink-muted">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-card border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8">
        <p className="font-mono text-[11px] text-ink-muted">
          Retry — where student projects get a second author
        </p>
      </footer>
    </div>
  );
}

// Phase 1 replaces this with the real feed (feed_dark/feed_light frames).
export function FeedPlaceholder() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border border-edge bg-surface px-6 py-16 text-center">
      <h2 className="font-display text-xl font-semibold text-ink">
        Welcome to Retry{user ? `, ${user.name.split(' ')[0]}` : ''}
      </h2>
      <p className="max-w-md text-sm text-ink-muted">
        The project feed lands in Phase 1. Auth, accounts, and the design system are live — this is
        the Phase 0 shell.
      </p>
      <p className="font-mono text-xs text-ink-muted">phase 0 · auth vertical slice</p>
    </div>
  );
}
