import {
  addComment,
  createExpense,
  createGroup,
  deleteExpense,
  recordSettlement,
  restoreExpense,
  updateExpense,
  upsertContactProfile,
  type ExpenseDraft,
} from '@/lib/api';
import { isConflict, isServerRefusal } from '@/lib/errors';

import { getDatabase } from './database';
import { stringify } from './serialize';
import {
  complete,
  markConflict,
  markFailed,
  markRetryable,
  markSending,
  nextPending,
  type OutboxRow,
} from './outbox';

/**
 * The drainer: one queue, one at a time, in order.
 *
 * ---------------------------------------------------------------- why serial
 *
 * Sending in parallel would be faster and wrong. "Create the group" must land before "add an
 * expense to that group", and "add this person" before "split with them" — the queue is a
 * causal chain, not a bag. So: strictly `order by id`, one request in flight, and **a head
 * that cannot be sent blocks everything behind it**.
 *
 * That blocking is a feature. If a create fails permanently, every write that referenced what
 * it would have created is going to fail too, and failing them one by one turns one problem
 * the user can understand into five they cannot.
 *
 * ---------------------------------------------------------------- three outcomes
 *
 * **Sent.** The row is deleted and its balance overlay disappears with it; the refetch that
 * follows brings the server's own figure, which is the one that should have been there all
 * along.
 *
 * **The server refused.** A response carrying a SQLSTATE is a decision, and it will be the same
 * decision on the tenth attempt, so the row is marked `failed` (or `conflict`, which is its own
 * thing) and waits for a person. See `ServerError` in lib/errors.ts.
 *
 * **We never reached the server.** No code, so it was the transport: a dropped connection, a
 * timeout, a hotel wifi that swallowed the request. Back to `pending`, same position, try again
 * when there is signal.
 *
 * ---------------------------------------------------------------- the force-quit case
 *
 * A row marked `sending` when the process died is picked up and sent again, deliberately. We
 * cannot know whether the request arrived, and it does not matter: every RPC opens with a
 * check against `internal.mutation_log` keyed on `client_mutation_id`, which is frozen in the
 * row and never regenerated. A write that did land returns its original result; a write that
 * did not is applied once. This is the whole reason the idempotency key exists — the case that
 * *will* happen on mobile is the server committing and the response being lost.
 */

export interface DrainOutcome {
  sent: number;
  /**
   * Which ops actually landed this run.
   *
   * The caller needs this because **not every RPC emits a change event**, and the ones that do
   * not are invisible to `sync_pull` — so nothing would ever tell the cache to refetch.
   * `upsert_contact_profile` is the case that bit: naming somebody enqueued a write, the screen
   * invalidated the roster immediately, the refetch came back BEFORE the drain had told the
   * server the person existed, and that answer was cached as fresh for a minute. The moment the
   * outbox row was deleted the person was in neither the roster nor the queue, and the expense
   * form fell through to "Someone".
   */
  sentOps: string[];
  /** Set when the drain stopped early. The queue is ordered, so the rest did not run. */
  blockedBy: 'conflict' | 'failed' | 'offline' | null;
}

let inFlight: Promise<DrainOutcome> | null = null;

/**
 * Drain until the queue is empty or something blocks it.
 *
 * Re-entrant calls join the run already in progress rather than starting a second one — two
 * drainers would defeat the ordering guarantee immediately, and the triggers are numerous
 * (reconnect, app foreground, a new write, a retry timer) so overlap is the normal case, not
 * the exception.
 */
export function drainOutbox(onChange?: () => void): Promise<DrainOutcome> {
  if (inFlight) return inFlight;
  inFlight = run(onChange).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(onChange?: () => void): Promise<DrainOutcome> {
  let sent = 0;
  const sentOps: string[] = [];

  for (;;) {
    const row = nextPending();
    if (!row) return { sent, sentOps, blockedBy: null };

    // No progress report here. It only moves `attempts`, which nothing displays, and each
    // report costs a full re-render of every screen holding `useOffline()`.
    markSending(row.id);

    try {
      await send(row);
      complete(row.id);
      sent += 1;
      sentOps.push(row.op);
      onChange?.();
    } catch (error) {
      if (isConflict(error)) {
        markConflict(row.id, error.message, error.serverSnapshot);
        onChange?.();
        return { sent, sentOps, blockedBy: 'conflict' };
      }

      const message = (error as Error).message ?? 'Something went wrong';

      if (isServerRefusal(error)) {
        markFailed(row.id, message);
        onChange?.();
        return { sent, sentOps, blockedBy: 'failed' };
      }

      // Transport. Leave it exactly where it is and come back to it.
      markRetryable(row.id, message);
      onChange?.();
      return { sent, sentOps, blockedBy: 'offline' };
    }
  }
}

/** Dispatch one row. The payload is the argument list its api.ts wrapper expects. */
async function send(row: OutboxRow): Promise<void> {
  switch (row.op) {
    case 'create_expense': {
      const draft = row.payload as ExpenseDraft;
      await createExpense(draft, row.clientMutationId);
      return;
    }

    case 'update_expense': {
      const draft = row.payload as ExpenseDraft;
      await updateExpense(row.entityId!, draft, row.baseRevision ?? 1, row.clientMutationId);
      return;
    }

    case 'delete_expense': {
      await deleteExpense(row.entityId!, row.baseRevision ?? 1, row.clientMutationId);
      return;
    }

    case 'restore_expense': {
      await restoreExpense(row.entityId!, row.clientMutationId);
      return;
    }

    case 'add_comment': {
      const { body } = row.payload as { body: string };
      await addComment(row.entityId!, body, row.clientMutationId);
      return;
    }

    case 'record_settlement': {
      const input = row.payload as Parameters<typeof recordSettlement>[0];
      await recordSettlement(input, row.clientMutationId);
      return;
    }

    case 'create_group': {
      const input = row.payload as Parameters<typeof createGroup>[0];
      await createGroup(input, row.clientMutationId);
      return;
    }

    case 'upsert_contact_profile': {
      const input = row.payload as {
        displayName: string;
        contact?: { kind: 'phone' | 'email'; value: string };
        profileId: string;
      };
      const resolved = await upsertContactProfile(
        input.displayName,
        input.contact,
        input.profileId,
        row.clientMutationId,
      );

      // The dedupe fired: this person already existed under a different id. Everything queued
      // behind this row is still referring to the id we invented, which was never created.
      if (resolved !== input.profileId) {
        remapProfileId(row.id, input.profileId, resolved);
      }
      return;
    }
  }
}

/**
 * Point everything still queued at the id the server actually used.
 *
 * This is the `id_remap` the phase plan describes, and it happens exactly once: when a
 * client-invented placeholder turns out to match somebody who already exists, because the
 * email you typed is already on their profile. The expense sitting behind this row in the
 * queue names the invented id in its payers, its splits and its balance overlay; sending it
 * unchanged would fail on a foreign key against a profile that was never created.
 *
 * A textual replace across the stored JSON rather than a structural walk. The values are uuids
 * — 36 characters of hex and hyphens, in a document whose other strings are names, amounts and
 * ISO dates — so there is nothing else for the pattern to hit, and it covers payload and
 * effects and any nesting depth without the traversal needing to know each payload's shape.
 *
 * Only rows *after* this one are touched. Anything before it has already been sent.
 */
function remapProfileId(afterRowId: number, from: string, to: string): void {
  const db = getDatabase();
  db.withTransactionSync(() => {
    db.runSync(
      `update outbox
          set payload = replace(payload, ?, ?),
              effects = replace(effects, ?, ?),
              entity_id = case when entity_id = ? then ? else entity_id end,
              updated_at = ?
        where id > ?`,
      [from, to, from, to, from, to, new Date().toISOString(), afterRowId],
    );
  });
}

/**
 * How long to wait before trying a stalled queue again.
 *
 * Only used when the head is blocked on transport. Capped at a minute: past that it stops
 * being a retry strategy and becomes a battery drain, and a reconnect or a foreground will
 * trigger a drain anyway.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Re-arm a conflicted or failed row after the user has decided what to do with it.
 *
 * **The mutation key is replaced, not reused.** That is the whole subtlety of retrying after a
 * conflict: the old key is already recorded in `internal.mutation_log`, so sending it again
 * would be treated as a replay and hand back the stored result — the original refusal — rather
 * than attempting the write. A resolved conflict is a new intent and needs a new key. The edit
 * screen already rotated its key on conflict-reload for exactly this reason; this is the same
 * rule, applied where the queue can outlive the screen.
 *
 * `baseRevision` comes from the server snapshot that arrived with the P0409, so the retry is
 * built against what is actually there now instead of what was there when the user started.
 */
export function requeue(
  id: number,
  clientMutationId: string,
  payload: unknown,
  baseRevision?: number | null,
): void {
  const db = getDatabase();
  db.runSync(
    `update outbox
        set status = 'pending', attempts = 0, last_error = null, server_snapshot = null,
            client_mutation_id = ?, payload = ?,
            base_revision = coalesce(?, base_revision), updated_at = ?
      where id = ?`,
    [clientMutationId, stringify(payload), baseRevision ?? null, new Date().toISOString(), id],
  );
}
