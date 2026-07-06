import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout, AuthPanel, Button } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';

// Landing page for the FR-AUTH-02 email link: /verify-email?token=...
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<{ status: 'verifying' | 'done' | 'failed'; message: string }>({
    status: 'verifying',
    message: 'Verifying your email…',
  });

  useEffect(() => {
    if (!token) {
      setState({ status: 'failed', message: 'This verification link is malformed.' });
      return;
    }
    let cancelled = false;
    api
      .get<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => !cancelled && setState({ status: 'done', message: res.message }))
      .catch((err: unknown) =>
        !cancelled &&
        setState({
          status: 'failed',
          message: err instanceof ApiError ? err.message : 'Verification failed. Try again.',
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthLayout>
      <AuthPanel className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-display text-[19px] font-semibold text-ink">
          {state.status === 'done' ? 'Email verified' : 'Email verification'}
        </h2>
        <p className={`text-sm ${state.status === 'failed' ? 'text-danger' : 'text-ink-muted'}`}>
          {state.message}
        </p>
        {state.status !== 'verifying' && (
          <Link to={state.status === 'done' ? '/login' : '/register'} className="w-full">
            <Button type="button">{state.status === 'done' ? 'Log in' : 'Back to signup'}</Button>
          </Link>
        )}
      </AuthPanel>
    </AuthLayout>
  );
}
