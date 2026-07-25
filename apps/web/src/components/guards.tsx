import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.js';

function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <p className="font-display text-lg font-bold text-ink-muted">Retry</p>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'booting') return <BootScreen />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // FR-AUTH-04: students can't enter the app until onboarding is done
  if (user.role === 'student' && !user.onboardingComplete && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

// Login/register redirect away when already signed in
export function RequireAnon({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  if (status === 'booting') return <BootScreen />;
  if (user) return <Navigate to="/" replace />;
  return children;
}
