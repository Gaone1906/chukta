# Phase 3 — Supabase backend

**Status:** ✅ done (2026-07-25) · 15 migrations, 68 pgTAP tests · **Depends on:** Phase 0
**Can run in parallel with Phases 1 and 2.**

## Goal

Schema, integrity constraints, write RPCs, and RLS — everything the app talks to. Two things
here are effectively irreversible once there's production data (the identity model and the
money representation), so they get decided correctly now rather than iterated on.

## Migration order

```
supabase/migrations/
  0001_extensions_and_schemas.sql   pgcrypto, pg_trgm, pg_cron, pg_net; schemas app/auth_ext/internal
  0002_currencies_seed.sql
  0003_profiles_identity.sql        profiles, contact points, claims, merges
  0004_groups.sql
  0005_expenses_core.sql            expenses, payers, splits, items, participants, debts
  0006_money_functions.sql          allocate_minor, convert_to_base, balanced trigger
  0007_derived_and_audit.sql        comments, attachments, revisions
  0008_settlements_recurring.sql
  0009_sync_and_notifications.sql   change_events, mutation_log, queues, device tokens
  0010_fx.sql
  0011_auth_ext_helpers.sql         SECURITY DEFINER helpers — MUST precede policies
  0012_rls_policies.sql
  0013_app_rpcs_read.sql
  0014_app_rpcs_write.sql
  0015_merge_and_claim.sql
  0016_cron_jobs.sql
  0017_storage_policies.sql
```

Schemas: `public` (client-visible, RLS on), `app` (RPCs and views), `auth_ext`
(SECURITY DEFINER helpers), `internal` (queues and logs, no client grants).

## 1. Identity — the decision that can't be retrofitted

**`profiles.id` is the universal participant identity. Nothing outside `profiles` ever
references `auth.users`.**

A person you added to an expense who hasn't signed up is simply a profile with
`user_id IS NULL`. When they sign up, an `AFTER INSERT ON auth.users` trigger matches their
*verified* phone/email against `profile_contact_points` and **claims the row in place** — one
`UPDATE profiles SET user_id = …`. Their entire history is already correct because every
expense, split and debt row points at `profile_id`. Nothing migrates.

The common alternative (`expense_splits.user_id → auth.users` plus a "shadow user" concept)
forces a multi-table data migration on every signup, and it is miserable to retrofit.

```sql
profiles(id, user_id → auth.users NULL UNIQUE, display_name, avatar_url, upi_vpa,
         venmo_handle, paypal_link, default_currency, timezone, primary_auth_provider,
         created_by_profile_id, claimed_at, merged_into_profile_id, merged_at, deleted_at)

profile_contact_points(id, profile_id, kind('phone'|'email'), value_norm, value_sha256,
                       verified_at, source, retired_at)
  UNIQUE (kind, value_norm) WHERE retired_at IS NULL   -- one live contact = one identity

profile_claims(id, placeholder_profile_id, token_sha256, created_by_profile_id,
               expires_at, claimed_by_user_id, claimed_at)
```

Store `token_sha256`, never the raw invite token. `value_sha256` lets contact matching happen
without shipping the address book — though with the share-sheet invite decision we may not
need contact matching at all in v1.

**`app.merge_profiles(source, target)`** handles the cases claim-in-place can't: two friends
invite the same person separately, or someone signs in with Apple and later with Google.
Lock both rows ordered by id (deadlock avoidance), then repoint table by table with collision
handling — `group_members` collisions delete the duplicate and keep the earliest `joined_at`;
`expense_splits`/`expense_payers` collisions **sum** into the surviving row and write an
`expense_revisions` entry; `expense_debts` collapses self-edges; settlements that become
self-to-self become `status='voided_by_merge'` rather than being deleted. Leave the source row
as a tombstone pointing at the target so stale offline clients can still resolve old ids.
Emit **one** `change_events` row per affected recipient — never one per repointed row, which
would be the single most likely notification storm in the schema.

## 2. Money

`bigint` minor units + `char(3)` currency + a snapshotted `smallint` exponent on every row.
`numeric` only for FX rates (`numeric(20,10)`) and split weights (`numeric(18,6)`).

`app.allocate_minor(total, weights[], keys[])` is the plpgsql twin of
`packages/core/src/split.ts` — same largest-remainder algorithm, same tiebreak order. They
must agree exactly; that cross-check is a pgTAP test.

**`trg_expense_balanced`** — `AFTER INSERT OR UPDATE ON expenses DEFERRABLE INITIALLY
DEFERRED` — asserts `Σ payers = amount_minor`, `Σ splits = amount_minor`, the same two in base
minor, ≥1 payer, ≥1 split, and that `expense_debts` reconciles per person. Deferred so an RPC
can write parent-then-children in one transaction. This trigger is what makes every downstream
balance trustworthy.

## 3. Expenses

`expenses.group_id` is **nullable** — a one-off expense between people, exactly as the design
doc describes (naming the group field promotes it; leaving it blank doesn't). Not a hidden
"ad-hoc group" row: that would need filtering out of the Groups tab and would leave orphans
behind abandoned drafts.

Every child table carries a **denormalized `group_id`** with a composite FK to
`expenses(id, group_id)`. This makes RLS policies on children flat and self-contained instead
of requiring a join back to `expenses`, and the FK makes drift structurally impossible.

Derived tables written **inside the same transaction** as the expense:
- `expense_debts` — pairwise resolved debts (net each person to a residual, then allocate each
  debtor's residual across creditors pro-rata; netting first means a payer who also owes never
  produces a self-edge)
- `expense_participants` — the RLS accelerator and what makes Person detail fast

`expense_revisions` stores **full snapshots**, not diffs. An expense doc is <4KB; snapshots
make "restore this version" and the offline conflict diff trivial. The `diff` column is
precomputed only so the history list renders without loading two snapshots.

## 4. Balances — derived, not stored

Balances are a plain aggregate over `expense_debts` + `settlements` via
`app.v_pair_ledger` → `app.v_pair_balances` → `app.v_group_balances`, orientation-normalized
so `lo`/`hi` are the lower/higher profile id and the sign carries direction.

At 1k–10k users this is two index-only scans, single-digit milliseconds. A trigger-maintained
balance table would be faster, but every edit, soft delete, restore, settlement void and
profile merge would have to maintain it correctly — and a bug there corrupts money silently
and permanently. Aggregates are self-healing. Revisit only if profiling says so; the escape
hatch is a materialized `profile_balance_cache`.

**Multi-currency: never sum across currencies.** Balances are always per
`(counterparty, currency)`. The UI rolls up to the viewer's default currency at today's rate
for *display only*, prefixed `≈`. This kills a whole family of "my balance changed and nobody
added an expense" bugs.

> ⚠️ **Open question #2**: the Help FAQ says one currency per group; the feature spec says
> per-expense override with a group default. This schema implements the latter. Resolve before
> writing 0005.

## 5. Write path

**All money mutations go through `SECURITY DEFINER` plpgsql RPCs in `app`. Direct
INSERT/UPDATE/DELETE is revoked from `authenticated` on every money table.** An expense write
touches six tables and must preserve a sum invariant; from the client that would be eight
round trips with no transaction and a torn write on every dropped connection.

Because the tables grant no write policies, these functions must bypass RLS — so **every one
opens with an authorization assert and declares `SET search_path = ''`**. Enforce that with a
test that greps every `app.*` write function for a leading `perform auth_ext.assert_*`.

Key RPCs: `create_expense`, `update_expense`, `delete_expense`/`restore_expense`,
`create_group`, `add_group_members`/`remove_group_member` (blocked on non-zero balance),
`upsert_contact_profile`, `record_settlement`/`void_settlement`, `claim_placeholder`,
`get_home_summary`, `get_group_detail`, `get_person_detail`, `simplify_group_debts`,
`sync_pull`, `register_device_token`.

`create_expense` accepts `new_group: {name, currency, member_profile_ids}` so group creation
and the first expense are one atomic call — matching the design's "no separate Create group
screen" decision. It also accepts `new_contact` inside a split so an offline client can invent
a placeholder id; if the server dedupes it, the response carries an **`id_remap`** which the
outbox drainer applies to local rows *and* to still-queued payloads.

Every write RPC opens with an idempotency check against `internal.mutation_log` keyed by
`client_mutation_id`, returning the stored result on replay. Same key + different request hash
→ raise; that's a client bug, not something to paper over.

## 6. RLS

The trap: a policy on `group_members` that reads `group_members` raises
`infinite recursion detected in policy`. It **will** happen on the first policy written.

Break it with `SECURITY DEFINER STABLE` helpers in `auth_ext`, each `SET search_path = ''`,
`REVOKE EXECUTE FROM public`, `GRANT EXECUTE TO authenticated`:

```
auth_ext.current_profile_id()          auth_ext.my_group_ids()        ← the recursion breaker
auth_ext.is_group_member(uuid)         auth_ext.can_read_expense(uuid)
auth_ext.shares_context_with(uuid)     auth_ext.resolve_profile_id(uuid)
auth_ext.assert_can_edit_expense(uuid) auth_ext.assert_group_member(uuid)
```

**Wrap every helper call in `(select …)`** inside policies — that makes the planner treat it
as an InitPlan evaluated once per statement instead of once per row. It is the single biggest
RLS performance lever in Postgres.

Self-scoped tables (`notification_prefs`, `device_tokens`, `feedback`) get plain
`profile_id = current_profile_id()` write policies and skip the RPC layer.

Storage: private `receipts` bucket at `receipts/{expense_id}/{uuid}.jpg` with a policy of
`auth_ext.can_read_expense(...)`; public-read `avatars` at `avatars/{profile_id}`.

## 7. `internal.change_events` — one table, three jobs

Realtime fan-out, offline delta-sync cursor, and push-notification source. Every write RPC
appends one row **per recipient** in the same transaction, so all three are consistent with
the data by construction.

Clients open exactly **one** subscription — `change_events` filtered
`recipient_profile_id=eq.<me>` — instead of subscribing to five money tables and paying a
per-row RLS check on each. Write amplification (a 6-person expense writes 6 rows) is the
price; a `pg_cron` job prunes rows older than 30 days, and clients that fall outside the
window do a full resync.

## Acceptance criteria

- `supabase db reset` applies all migrations cleanly from scratch
- pgTAP: `allocate_minor` matches `@chukta/core` on shared fixtures
- pgTAP: the balanced trigger rejects `Σ splits ≠ total`
- pgTAP: replaying a `client_mutation_id` doesn't duplicate
- pgTAP: `merge_profiles` preserves every net balance
- pgTAP: **a member of group A selecting group B's expenses gets zero rows** — RLS is verified
  by trying to read what you shouldn't, not by reading what you should
- No `app.*` write function without a leading authorization assert

## Verification

```bash
npm run db:reset
supabase test db
npm run db:types    # regenerates packages/core/src/db-types.ts
```
