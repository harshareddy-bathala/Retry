import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from './components/ui/tooltip.js';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/theme.css';
import { AppShell, FeedPlaceholder } from './components/AppShell.js';
import { ErrorBoundary } from './components/ui/error-boundary.js';
import { RouteFallback } from './components/ui/states.js';
import { RequireAnon, RequireAuth } from './components/guards.js';
import { AuthProvider } from './features/auth/AuthContext.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { OnboardingPage } from './features/auth/OnboardingPage.js';
import { ForgotPasswordPage, ResetPasswordPage } from './features/auth/PasswordPages.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage.js';

// Phaser is heavy; the live space loads on demand so the main bundle stays lean.
const RoomsPage = lazy(() => import('./features/rooms/RoomsPage.js'));
const RoomDetailPage = lazy(() => import('./features/rooms/RoomDetailPage.js'));
const WorldPage = lazy(() => import('./features/rooms/WorldPage.js'));

/**
 * A lazy route, with the two things every one of them was missing.
 *
 * All three room routes shipped `Suspense fallback={null}` — a blank white page
 * while the chunk downloaded, and for /world that chunk is Phaser, the heaviest
 * asset in the app at ~620 kB gzipped. And no boundary anywhere, so a throw
 * inside the chunk blanked the whole application rather than one route.
 */
function LazyRoute({ what, label, children }: { what: string; label: string; children: ReactNode }) {
  return (
    <ErrorBoundary what={what}>
      <Suspense fallback={<RouteFallback label={label} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** Preserves ?map= so a bookmarked room still lands in that room. */
function RedirectToWorld() {
  const { search } = useLocation();
  return <Navigate to={`/world${search}`} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <RequireAnon><LoginPage /></RequireAnon> },
  { path: '/register', element: <RequireAnon><RegisterPage /></RequireAnon> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/forgot-password', element: <RequireAnon><ForgotPasswordPage /></RequireAnon> },
  { path: '/reset-password', element: <RequireAnon><ResetPasswordPage /></RequireAnon> },
  { path: '/onboarding', element: <RequireAuth><OnboardingPage /></RequireAuth> },
  {
    // The world is full bleed, so it is a sibling of AppShell rather than a
    // child of it — AppShell wraps children in a max-w-5xl article column.
    path: '/world',
    element: (
      <RequireAuth>
        <LazyRoute what="The world" label="Loading the world…">
          <WorldPage />
        </LazyRoute>
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <FeedPlaceholder /> },
      {
        path: 'rooms',
        element: (
          <LazyRoute what="Rooms" label="Loading rooms…">
            <RoomsPage />
          </LazyRoute>
        ),
      },
      {
        path: 'rooms/:roomId',
        element: (
          <LazyRoute what="This room" label="Loading the room…">
            <RoomDetailPage />
          </LazyRoute>
        ),
      },
      // Old links keep working; the world itself moved out of the shell.
      { path: 'rooms/live', element: <RedirectToWorld /> },
      { path: 'rooms/sandbox', element: <RedirectToWorld /> },
    ],
  },
]);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
