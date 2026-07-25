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
 * An error the *server* produced, carrying its SQLSTATE.
 *
 * The distinction that matters to the outbox drainer is not which error it is but whether
 * retrying could ever help. A response with a Postgres error code is a decision — the amount
 * was not positive, the splits did not sum, you are not a member of that group — and it will
 * be the same decision on the tenth attempt. A failure with no code never reached Postgres at
 * all: a dropped connection, a timeout, a captive portal. Those are exactly the ones worth
 * retrying, and they are the common case on a phone.
 *
 * Without this the drainer would have to guess from error text, and would either give up on
 * writes that a moment's signal would have flushed, or hammer the server forever with a write
 * it has already refused.
 */
export class ServerError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ServerError';
    this.code = code;
  }
}

/** True when the server decided; false when we never got an answer. */
export function isServerRefusal(error: unknown): boolean {
  return error instanceof ServerError || error instanceof AuthzError || isConflict(error);
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
  // A code means Postgres answered. No code means we never reached it — supabase-js reports a
  // dropped request with an empty code, which is precisely the retryable case.
  if (error.code) {
    return new ServerError(error.message || 'Something went wrong', error.code);
  }
  return new Error(error.message || 'Something went wrong');
}

export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}
