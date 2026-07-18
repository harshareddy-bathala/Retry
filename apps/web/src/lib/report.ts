// Frontend problem sink. Sentry wiring lands in Phase 7 (roadmap); until then
// warnings surface on the dev console only and are silent in production.
export function reportWarning(message: string, detail?: unknown): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- dev-only sink until Sentry (Hard Rule 10)
    console.warn(message, detail);
  }
}
