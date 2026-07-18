import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/theme.css';
import { AppShell, FeedPlaceholder } from './components/AppShell.js';
import { RequireAnon, RequireAuth } from './components/guards.js';
import { AuthProvider } from './features/auth/AuthContext.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { OnboardingPage } from './features/auth/OnboardingPage.js';
import { ForgotPasswordPage, ResetPasswordPage } from './features/auth/PasswordPages.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage.js';

// Phaser is heavy; the room sandbox loads on demand so the main bundle stays lean.
const RoomSandboxPage = lazy(() => import('./features/rooms/RoomSandboxPage.js'));

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
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <FeedPlaceholder /> },
      {
        path: 'rooms/sandbox',
        element: (
          <Suspense fallback={null}>
            <RoomSandboxPage />
          </Suspense>
        ),
      },
    ],
  },
]);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
