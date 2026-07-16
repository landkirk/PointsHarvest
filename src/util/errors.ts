export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
  }
}

/** Human-readable message from any thrown value. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
