import * as SQLite from 'expo-sqlite';

/**
 * The local database. Two tables, and deliberately only two.
 *
 * The phase plan called for `expo-sqlite` + Drizzle mirroring ten server tables — profiles,
 * groups, group_members, expenses, expense_payers, expense_splits, expense_debts,
 * expense_participants, settlements, expense_comments — and recomputing balances locally with
 * `@hisaab/core`. That is not what this is, and the difference is worth stating plainly
 * because it is the single largest deviation in Phase 8.
 *
 * **Reads are cached, not mirrored.** Every screen in this app is fed by one RPC that returns
 * the whole screen — `get_home_summary`, `get_group_detail`, `get_person_detail`,
 * `get_expense_detail` — with the balances already computed by the server's own views. Those
 * responses are persisted verbatim (see `persister.ts`) and replayed on a cold start with no
 * network.
 *
 * Mirroring the tables instead would mean reimplementing `v_pair_ledger`, `v_group_balances`
 * and the soft-delete and settlement-voiding rules in TypeScript, and keeping that
 * reimplementation in step with the SQL forever. The plan's own requirement is that "an offline
 * balance must never disagree with an online one" — and the surest way to satisfy that is not
 * to compute it twice. A cached balance is the server's answer; a recomputed one is a second
 * implementation waiting to disagree.
 *
 * What the local database is for is the half that genuinely cannot be a cache: **the writes
 * that have not happened yet.** Those need ordering, durability across a force-quit, and a
 * transaction — which is what SQLite is for and what a key-value store is not.
 *
 * Drizzle is dropped with it. It is an ORM for a schema; two tables that are read by four
 * hand-written queries do not need one, and drizzle-kit would add a codegen step and a
 * migration directory to CI for no gain.
 */

const DB_NAME = 'hisaab-offline.db';

/**
 * Schema version, bumped by hand. `user_version` is a single integer SQLite keeps in the file
 * header, which is the smallest possible migration runner and exactly enough for this.
 */
const SCHEMA_VERSION = 1;

let database: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (database) return database;

  const db = SQLite.openDatabaseSync(DB_NAME);

  // WAL, so a read (the pending-writes badge, on every render) never blocks the drainer's
  // write. `synchronous = NORMAL` is the standard WAL pairing: a durable commit on process
  // death, which is the case that matters here, without an fsync per statement.
  db.execSync('pragma journal_mode = WAL');
  db.execSync('pragma synchronous = NORMAL');
  db.execSync('pragma foreign_keys = ON');

  migrate(db);
  database = db;
  return db;
}

function migrate(db: SQLite.SQLiteDatabase): void {
  const row = db.getFirstSync<{ user_version: number }>('pragma user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  db.withTransactionSync(() => {
    if (current < 1) {
      /*
       * The write outbox.
       *
       * `id integer primary key autoincrement` is load-bearing, not decorative. AUTOINCREMENT
       * guarantees a monotonically increasing id that is never reused even after a delete, and
       * the drainer sends in `id` order — because ordering is not optional. "Create the group"
       * must land before "add an expense to that group", and a rowid that could be recycled
       * after a delete would eventually put a new write behind an old one.
       *
       * `client_mutation_id` is UNIQUE and frozen at enqueue time. It is the key
       * `internal.mutation_log` dedupes on, so it is what makes the case that WILL happen on
       * mobile safe: the server committed, the response was lost, the client retries. It must
       * never be regenerated for a retry of the same intent — and equally, it must be rotated
       * when the user resolves a conflict, because that is a different intent and replaying
       * the old key would just return the original stored result.
       *
       * `payload` and `effects` are TEXT holding bigint-tagged JSON — see serialize.ts.
       *
       * `effects` is the precomputed balance movement, and it is why an expense added with no
       * signal makes the numbers on Home move immediately. Computing it at enqueue time rather
       * than at read time means it is done once, by the code that already has the payers and
       * splits in hand, using the same `resolvePairwise` the server uses.
       */
      db.execSync(`
        create table if not exists outbox (
          id                 integer primary key autoincrement,
          client_mutation_id text    not null unique,
          op                 text    not null,
          payload            text    not null,
          effects            text    not null default '[]',
          entity_id          text,
          group_id           text,
          base_revision      integer,
          status             text    not null default 'pending',
          attempts           integer not null default 0,
          last_error         text,
          server_snapshot    text,
          created_at         text    not null,
          updated_at         text    not null
        );

        create index if not exists outbox_drain_order on outbox (status, id);
      `);

      // Everything else the offline layer needs to remember. One row per key rather than a
      // table per fact: the only entries are the delta cursor and the profile it belongs to.
      db.execSync(`
        create table if not exists sync_state (
          key   text primary key,
          value text not null
        );
      `);
    }

    db.execSync(`pragma user_version = ${SCHEMA_VERSION}`);
  });
}

/**
 * Wipe everything local. Called on sign-out, and on a profile change.
 *
 * The outbox is keyed to a person: their mutations, their idempotency keys, their delta
 * cursor. Carrying any of it across a sign-out would flush one account's queued writes under
 * another's session — which the server would mostly refuse, but "mostly" is not a security
 * property.
 */
export function clearLocalDatabase(): void {
  const db = getDatabase();
  db.withTransactionSync(() => {
    db.execSync('delete from outbox');
    db.execSync('delete from sync_state');
  });
}
