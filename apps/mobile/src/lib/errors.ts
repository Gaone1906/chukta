import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Error shapes the UI has to tell apart.
 *
 * The important one is the conflict. `update_expense` raises `P0409` with the server's
 * current snapshot in DETAIL when the caller's `expected_revision` is stale — that has to be
 * distinguishable from a generic failure, because it gets a diff sheet rather than a "try
 * again" toast. Phase 8's outbox depends on the same distinction.
 */

/** Raised by update_expense / delete_expense when the expense moved under you. */
export const CONFLICT_CODE = 'P0409';

export class ConflictError extends Error {
  /** The server's current expense snapshot, parsed out of the error DETAIL. */
  readonly serverSnapshot: unknown;
  /** True when the expense was deleted rather than edited — delete beats edit. */
  readonly wasDeleted: boolean;

  constructor(message: string, detail: string | undefined) {
    super(message);
    this.name = 'ConflictError';

    let parsed: unknown = null;
    try {
      parsed = detail ? JSON.parse(detail) : null;
    } catch {
      // A conflict we cannot parse is still a conflict; the UI falls back to "reload".
      parsed = null;
    }
    this.serverSnapshot = parsed;
    this.wasDeleted =
      typeof parsed === 'object' && parsed !== null && (parsed as { deleted?: boolean }).deleted === true;
  }
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthzError';
  }
}

/**
 * Turn a PostgREST error into something the UI can branch on.
 *
 * Everything else becomes a plain Error carrying the server's message. Those messages are
 * written to be shown — the RPCs raise things like "splits sum to 4500 but the total is 5000".
 */
export function translateError(error: PostgrestError): Error {
  if (error.code === CONFLICT_CODE) {
    return new ConflictError(error.message, error.details ?? undefined);
  }
  if (error.code === '42501') {
    return new AuthzError(error.message);
  }
  return new Error(error.message || 'Something went wrong');
}

export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}
