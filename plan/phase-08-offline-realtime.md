# Phase 8 — Offline & realtime

**Status:** ⬜ not started · **Estimate:** 1.5 weeks · **Depends on:** Phases 3, 5

## Goal

The app opens and reads with no network, writes queue and flush on reconnect, and changes made
by other people appear live. **Cached reads + write outbox** — not a full bidirectional sync
engine. That was a deliberate scope decision: it covers ~90% of what people mean by "works
offline" for a fraction of the cost, and a shared-expense app gets used in restaurants and on
trips where signal is bad.

## Realtime

The client opens **exactly one** subscription: `internal.change_events` filtered
`recipient_profile_id=eq.<me>`.

Not five subscriptions on the money tables. Supabase Postgres Changes evaluates RLS per
subscriber per row; subscribing to `expenses`, `expense_splits`, `settlements`,
`expense_comments` and `group_members` across N groups is expensive and forces the client to
reconstruct semantics from row deltas. One event table, written transactionally with the data,
avoids both problems.

On an event, either apply the payload directly or mark the entity dirty and batch a
`sync_pull`. Rule of thumb: comments and settlements carry full payloads; expenses carry `{}`
and trigger a refetch, because an expense edit touches five tables.

Prefer **invalidating TanStack Query keys** over hand-patching cache entries — far fewer ways
to end up displaying a wrong balance.

## Local database

`expo-sqlite` + Drizzle, mirroring `profiles`, `groups`, `group_members`, `expenses`,
`expense_payers`, `expense_splits`, `expense_debts`, `expense_participants`, `settlements`,
`expense_comments`, plus a `sync_state(last_event_id, last_full_sync_at)` row.

Balances are recomputed **locally** from the same `expense_debts` shape using `@hisaab/core` —
the same allocator and the same simplification the server runs. An offline balance must never
disagree with an online one.

## Outbox

```sql
outbox(id INTEGER PK AUTOINCREMENT, client_mutation_id TEXT UNIQUE, op TEXT,
       payload TEXT, base_revision INTEGER, entity_id TEXT,
       status TEXT, attempts INTEGER, last_error TEXT, created_at TEXT)
```

Every mutation writes optimistically to the local tables **and** appends an outbox row. A
single serial drainer sends them **strictly FIFO, one at a time** — ordering is not optional,
because "create group" must land before "add expense to that group".

Entity ids are client-generated UUIDs, so creates are self-referential offline. When the server
dedupes a client-invented placeholder profile, the response carries an **`id_remap`** which the
drainer applies to local rows *and* to still-queued outbox payloads before sending the next
mutation.

Idempotency is server-side, keyed on `client_mutation_id` in `internal.mutation_log` — it
covers the case that *will* happen on mobile: server committed, response lost, client retries.

## Conflicts

Optimistic concurrency on `expenses.revision`. `update_expense(…, expected_revision)` raises
`P0409` with the current server snapshot attached on mismatch.

**Two people edit the same expense offline**, both holding revision 7:

1. First to reconnect commits → revision 8, revision row written, event fanned out.
2. Second sends `base_revision=7`, gets `P0409` plus the revision-8 snapshot.
3. Outbox row → `status='conflict'`. **No auto-merge on money.** Show a resolution sheet
   diffing field by field: *"Priya changed this expense while you were offline — amount
   ₹4,320 → ₹4,500, split unchanged."* User picks theirs, the server's, or per-field; the
   resolution resubmits as a fresh mutation with `base_revision=8`.
4. Low-stakes divergences (description-only, category-only) auto-resolve last-writer-wins
   rather than nagging.
5. **Deletes beat edits.** Server row soft-deleted while you edited offline → *"This expense
   was deleted by Arjun — restore it with your changes?"*
6. Additive operations never conflict: comments, settlements and new expenses are inserts with
   client-generated ids, so they always land.

## Reconnect order — fixed, not incidental

**Drain outbox → `sync_pull(last_event_id)` → resubscribe to Realtime.**

Pulling first would clobber local optimistic state with stale server rows. Subscribing first
would race the drain. Clients whose `last_event_id` has fallen outside the 30-day retention
window do a full resync.

## Connectivity UI

A quiet offline indicator and a pending-writes count. Never block the UI on connectivity —
adding an expense at a restaurant table with no signal is the core use case, not an edge case.

## Acceptance criteria

- Airplane mode: app opens, all groups/people/balances readable
- Airplane mode: add two expenses and edit one → reconnect → all three land **exactly once**
- Force-quit mid-flush → relaunch → no duplicates, no lost writes
- Two devices on one account: an expense added on A appears on B within a couple of seconds
- Offline balance matches server balance exactly after sync
- Conflicting offline edits surface the resolution sheet rather than silently overwriting

## Verification

Manual airplane-mode matrix on a physical device — the emulator's network toggle doesn't
reproduce real reconnect behaviour. Then a two-device realtime test.
