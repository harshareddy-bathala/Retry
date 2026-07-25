import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, LoginInput } from '@retry/types';
import {
  api,
  setAccessToken,
  setSessionExpiredHandler,
  tryRefresh,
  type SessionResponse,
} from '../../lib/api.js';

// Client auth state only (user + boot status). Server data elsewhere stays in
// TanStack Query; this context exists because the access token is memory-held.
type AuthState = {
  user: AuthUser | null;
  status: 'booting' | 'ready';
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: (user: AuthUser) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<'booting' | 'ready'>('booting');

  // Boot: the refresh cookie is the only durable credential — try to resume.
  useEffect(() => {
    let cancelled = false;
    void tryRefresh().then((session) => {
      if (cancelled) return;
      if (session) setUser(session.user);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const session = await api.post<SessionResponse>('/auth/login', input);
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined); // best-effort server revoke
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback((next: AuthUser) => setUser(next), []);

  const value = useMemo(
    () => ({ user, status, login, logout, refreshUser }),
    [user, status, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
