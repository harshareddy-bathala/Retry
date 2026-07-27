import type { AppErrorCode, AuthUser, ErrorEnvelope } from '@retry/types';

// Single API client (CONVENTIONS.md §4): auth header, one refresh-retry on 401,
// error-envelope unwrap. Components never call fetch directly.

export class ApiError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Access token lives in memory only — never localStorage (SECURITY.md §1).
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (import.meta.env.DEV) {
    // Dev-only handle for the headless drives, which need to call the API as
    // the logged-in user. Never in a production bundle: an in-memory token is
    // the whole point (SECURITY.md §1) and a window global is not in memory
    // in any meaningful sense.
    (window as unknown as { __accessToken?: string | null }).__accessToken = token;
  }
}

// Room server WebSocket auth (rooms Phase 2) authenticates with the same token.
export function getAccessToken(): string | null {
  return accessToken;
}

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

type SessionResponse = { accessToken: string; user: AuthUser };

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ErrorEnvelope;
    return new ApiError(body.error.code, res.status, body.error.message);
  } catch {
    return new ApiError('INTERNAL_ERROR', res.status, 'Something went wrong.');
  }
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    credentials: 'include', // refresh cookie rides along on /api/auth
    headers: {
      // Only when there IS a body: Fastify rejects an empty body sent with a
      // JSON content-type, which would 400 every bodyless POST (accept an
      // invite, mark notifications read).
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

// One retry: if the access token expired, rotate via the refresh cookie and replay.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init);

  if (res.status === 401 && accessToken && !path.startsWith('/auth/refresh')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawRequest(path, init);
    } else {
      onSessionExpired?.();
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function tryRefresh(): Promise<SessionResponse | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const session = (await res.json()) as SessionResponse;
  setAccessToken(session.accessToken);
  return session;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export type { SessionResponse };
