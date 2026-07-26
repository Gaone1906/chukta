import { getDatabase } from './database';
import type { PendingEffect } from './effects';
import { merge } from './effects';
import { parse, stringify } from './serialize';

/**
 * The write queue.
 *
 * Every mutation the app makes goes in here first and is sent from here, online or not. That
 * is the important part: there is no "online path" and "offline path" to keep in step, because
 * a write with a network is just a write that drains immediately.
 *
 * Strictly FIFO, one at a time. Ordering is not a nicety — "create the group" has to land
 * before "add an expense to that group", and a parallel drain would race them.
 */

/**
 * Which writes are queueable, and — just as important — which are not.
 *
 * Queued: the money writes, plus the two things money writes depend on (a group to belong to,
 * a person to be split with).
 *
 * Deliberately NOT queued, each for its own reason:
 *
 *   - `create_invite_link` — the token *is* the result, and the call ends in a share sheet.
 *     There is nothing to replay later; you cannot re-open somebody's WhatsApp next Tuesday.
 *   - `claim_placeholder` — runs once, at first sign-in, before there is a local database
 *     belonging to anyone.
 *   - `delete_account` — signs you out on success. Queuing it would leave a mutation with no
 *     session to drain it, in a database that sign-out wipes.
 *   - the avatar upload — a binary to Storage, not an RPC.
 *   - settings toggles and feedback — already optimistic locally, and low enough stakes that
 *     failing honestly beats a queue.
 *
 * `api.ts` claims to be "the only place the app talks to the database". That was already not
 * quite true (the onboarding profile write, the Apple display-name backfill and two Storage
 * uploads go direct), and it is worth naming rather than letting the outbox rest on an
 * invariant that does not hold.
 */
export type OutboxOp =
  | 'create_expense'
  | 'update_expense'
  | 'delete_expense'
  | 'restore_expense'
  | 'add_comment'
  | 'record_settlement'
  | 'create_group'
  | 'upsert_contact_profile';

export type OutboxStatus = 'pending' | 'sending' | 'conflict' | 'failed';

export interface OutboxRow {
  id: number;
  clientMutationId: string;
  op: OutboxOp;
  payload: unknown;
  effects: PendingEffect[];
  entityId: string | null;
  groupId: string | null;
  baseRevision: number | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  serverSnapshot: unknown;
  createdAt: string;
}

interface RawRow {
  id: number;
  client_mutation_id: string;
  op: string;
  payload: string;
  effects: string;
  entity_id: string | null;
  group_id: string | null;
  base_revision: number | null;
  status: string;
  attempts: number;
  last_error: string | null;
  server_snapshot: string | null;
  created_at: string;
}

function hydrate(row: RawRow): OutboxRow {
  return {
    id: row.id,
    clientMutationId: row.client_mutation_id,
    op: row.op as OutboxOp,
    payload: parse(row.payload),
    effects: parse<PendingEffect[]>(row.effects),
    entityId: row.entity_id,
    groupId: row.group_id,
    baseRevision: row.base_revision,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    lastError: row.last_error,
    serverSnapshot: row.server_snapshot ? parse(row.server_snapshot) : null,
    createdAt: row.created_at,
  };
}

export interface EnqueueInput {
  clientMutationId: string;
  op: OutboxOp;
  payload: unknown;
  effects?: PendingEffect[];
  entityId?: string | null;
  groupId?: string | null;
  baseRevision?: number | null;
}

export function enqueue(input: EnqueueInput): OutboxRow {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.runSync(
    `insert into outbox
       (client_mutation_id, op, payload, effects, entity_id, group_id, base_revision,
        status, attempts, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      input.clientMutationId,
      input.op,
      stringify(input.payload),
      stringify(input.effects ?? []),
      input.entityId ?? null,
      input.groupId ?? null,
      input.baseRevision ?? null,
      now,
      now,
    ],
  );

  const row = db.getFirstSync<RawRow>(
    'select * from outbox where client_mutation_id = ?',
    [input.clientMutationId],
  );
  if (!row) throw new Error('outbox insert did not land');
  return hydrate(row);
}

/**
 * The next row to send.
 *
 * `status in ('pending','sending')` is deliberate. A row left as `sending` is one the app died
 * in the middle of — the request may or may not have reached the server, and there is no way
 * to know from here. Retrying is the right move precisely because it is safe to: the server
 * dedupes on `client_mutation_id` and returns the original result, so a write that did land
 * comes back as a no-op rather than a duplicate. This is the force-quit-mid-flush case, and
 * the reason the idempotency key exists at all.
 *
 * `conflict` and `failed` rows are skipped and stay put: both need a person, not a retry.
 * A conflict blocks the queue behind it, which is intentional — the writes after it may well
 * depend on it, and draining past a conflict would apply them out of order.
 */
export function nextPending(): OutboxRow | null {
  const row = getDatabase().getFirstSync<RawRow>(
    `select * from outbox where status in ('pending','sending') order by id limit 1`,
  );
  return row ? hydrate(row) : null;
}

export function markSending(id: number): void {
  getDatabase().runSync(
    `update outbox set status = 'sending', attempts = attempts + 1, updated_at = ?
     where id = ?`,
    [new Date().toISOString(), id],
  );
}

/** Sent and acknowledged. The row goes; its effect stops being applied on the next render. */
export function complete(id: number): void {
  getDatabase().runSync('delete from outbox where id = ?', [id]);
}

export function markFailed(id: number, error: string): void {
  getDatabase().runSync(
    `update outbox set status = 'failed', last_error = ?, updated_at = ? where id = ?`,
    [error, new Date().toISOString(), id],
  );
}

/** Retryable failure: back to pending so the next drain picks it up in the same position. */
export function markRetryable(id: number, error: string): void {
  getDatabase().runSync(
    `update outbox set status = 'pending', last_error = ?, updated_at = ? where id = ?`,
    [error, new Date().toISOString(), id],
  );
}

export function markConflict(id: number, error: string, serverSnapshot: unknown): void {
  getDatabase().runSync(
    `update outbox set status = 'conflict', last_error = ?, server_snapshot = ?, updated_at = ?
     where id = ?`,
    [error, stringify(serverSnapshot ?? null), new Date().toISOString(), id],
  );
}

/** Give up on a row — the user chose the server's version, or abandoned a failed write. */
export function discard(id: number): void {
  getDatabase().runSync('delete from outbox where id = ?', [id]);
}

export function listAll(): OutboxRow[] {
  return getDatabase()
    .getAllSync<RawRow>('select * from outbox order by id')
    .map(hydrate);
}

export function listUnresolved(): OutboxRow[] {
  return getDatabase()
    .getAllSync<RawRow>(`select * from outbox where status in ('conflict','failed') order by id`)
    .map(hydrate);
}

/** How many writes are still in flight, for the pending badge. Conflicts are counted apart. */
export function counts(): { pending: number; conflict: number; failed: number } {
  const rows = getDatabase().getAllSync<{ status: string; n: number }>(
    'select status, count(*) as n from outbox group by status',
  );
  const of = (...names: string[]) =>
    rows.filter((r) => names.includes(r.status)).reduce((sum, r) => sum + r.n, 0);
  return {
    pending: of('pending', 'sending'),
    conflict: of('conflict'),
    failed: of('failed'),
  };
}

/**
 * Every queued write's effect on the balances, summed.
 *
 * Conflicted and failed rows are included on purpose. Their money has not reached the server,
 * but the user did enter it and it is still sitting in the app waiting on them — dropping it
 * from the display would make the expense appear to un-happen while the row is still there to
 * be resolved.
 */
export function pendingEffects(): PendingEffect[] {
  const rows = getDatabase().getAllSync<{ effects: string }>('select effects from outbox');
  return merge(rows.flatMap((r) => parse<PendingEffect[]>(r.effects)));
}

/** Rows that created something, so a screen can render the not-yet-sent alongside the real. */
export function pendingByOp(op: OutboxOp): OutboxRow[] {
  return getDatabase()
    .getAllSync<RawRow>('select * from outbox where op = ? order by id', [op])
    .map(hydrate);
}
