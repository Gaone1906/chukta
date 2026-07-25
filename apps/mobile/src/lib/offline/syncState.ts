import { getDatabase } from './database';

/**
 * The little that has to be remembered between launches, beyond the queue itself.
 *
 * `cursor` is the id of the last `internal.change_events` row this device has seen. Everything
 * about catching up hangs off it: `sync_pull(cursor)` returns what happened while the app was
 * closed, and the server answers `full_resync` instead when the cursor has fallen outside the
 * retention window — a phone that has been in a drawer for a month rehydrates from scratch
 * rather than silently missing a month of expenses.
 *
 * `owner` is the profile the local database belongs to. Checked on every launch, because a
 * queue is personal: it holds one account's idempotency keys, one account's balance overlays,
 * and one account's cursor into a per-recipient event stream. Finding a different owner means
 * wiping, not merging.
 */

const CURSOR = 'cursor';
const OWNER = 'owner_profile_id';

function read(key: string): string | null {
  const row = getDatabase().getFirstSync<{ value: string }>(
    'select value from sync_state where key = ?',
    [key],
  );
  return row?.value ?? null;
}

function write(key: string, value: string): void {
  getDatabase().runSync(
    `insert into sync_state (key, value) values (?, ?)
     on conflict (key) do update set value = excluded.value`,
    [key, value],
  );
}

export function getCursor(): number {
  const raw = read(CURSOR);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Never moves backwards.
 *
 * A broadcast and a `sync_pull` can land in either order, and applying an older cursor after a
 * newer one would ask the server to replay events already handled — harmless in itself, but it
 * would also let a stale value undo a `full_resync` that had just completed.
 */
export function advanceCursor(to: number): void {
  if (!Number.isFinite(to) || to <= getCursor()) return;
  write(CURSOR, String(to));
}

export function resetCursor(): void {
  write(CURSOR, '0');
}

export function getOwner(): string | null {
  return read(OWNER);
}

export function setOwner(profileId: string): void {
  write(OWNER, profileId);
}
