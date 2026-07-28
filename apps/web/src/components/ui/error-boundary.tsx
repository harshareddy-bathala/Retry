import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './states.js';

type Props = {
  /** What broke, in the user's terms: "the world", "the whiteboard". */
  what: string;
  /** Shown instead of the default message — say what still works. */
  fallback?: (retry: () => void) => ReactNode;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Stops one broken thing from blanking the whole app.
 *
 * There were none. A throw inside Phaser's `create()`, a tldraw crash or a bad
 * texture unmounted the entire React tree and left a white page — which reads
 * as "Retry is down" rather than "the map didn't draw". Boundaries are placed
 * per lazy route and around the canvas specifically, so a world that fails to
 * draw leaves the socket, the panels and the Workspace link intact.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Hard Rule 10: no console.log in production code. Sentry is not wired up
    // in the web app yet, so this is the seam for it rather than a silent drop.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(`[${this.props.what}]`, error, info.componentStack);
    }
  }

  private retry = (): void => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return (
      <ErrorState
        title={`${this.props.what} stopped working.`}
        detail={error.message}
        onRetry={this.retry}
      />
    );
  }
}
