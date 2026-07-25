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

/**
 * We never reached the server.
 *
 * A distinct class rather than a plain Error because the message has to be replaced and the
 * original must not be lost. What the transport actually produces is unfit to show anybody —
 * observed verbatim on a screen during testing:
 *
 *   "Error: fetch failed: UnexpectedException: Could not connect to the server.
 *    (at ExpoModulesCore/Promise.swift:56)"
 *
 * A Swift file and line number in front of somebody trying to split a dinner. The real text is
 * kept on `cause` so a Sentry report still has it.
 *
 * **Deliberately still not a `ServerError`**, so `isServerRefusal` keeps returning false and
 * the outbox keeps treating this as retryable transport rather than a decision. Getting that
 * backwards would strand a queued write permanently on a dropped connection.
 */
export class NetworkError extends Error {
  constructor(cause: string) {
    super("Couldn't reach Hisaab. Check your connection — nothing was lost.");
    this.name = 'NetworkError';
    this.cause = cause;
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
  // No code: the request never arrived, so the message is the transport's, not ours, and is
  // written for a crash log rather than a person. See NetworkError.
  return new NetworkError(error.message || 'no detail');
}

export function isConflict(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}
