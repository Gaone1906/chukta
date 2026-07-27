-- "Paid in full", per expense.
--
-- Until now a settlement was a bare pairwise amount — "Sushrith paid Pranav ₹5,000" — with
-- nothing recording WHICH expense it cleared. So two people could be square in the ledger while
-- neither could say what had actually been paid off, and a long shared history became
-- impossible to audit. That is the hole this closes.
--
-- ---------------------------------------------------------------- the modelling decision
--
-- Marking an expense paid writes REAL settlements and moves the balance. It is not an
-- annotation. The visual-only version was rejected: two people could then disagree about what
-- had been paid, which is worse than not having the feature at all.
--
-- The link is `settlements.expense_id`, NOT a flag on the expense. A boolean on `expenses` plus
-- settlement rows would be two sources of truth for one fact, and they would drift the first
-- time anything edited an amount. Deriving "paid in full" from the settlements that point at the
-- expense means the stamp and the balance can never disagree — the stamp IS the balance
-- statement, rendered.
--
-- The cost we accept: "paid in full" is computed, not stored, so every read that shows the stamp
-- pays for a coverage check. That is the right trade. A wrong stamp on a money screen is worse
-- than a slower query.
--
-- ---------------------------------------------------------------- who may mark
--
-- The written plan said "the caller must be in `expense_payers`". Implemented one notch
-- stricter, because that rule has a hole on a multi-payer expense: a caller who is a payer AND
-- also owes one of the other payers could clear their own debt with it. The rule enforced here
-- is the one that was actually meant —
--
--   **you may only settle debt edges that point AT you.**
--
-- Money coming back to you is a fact you can attest to; money you owe someone else is theirs to
-- confirm. On the ordinary single-payer expense this is identical to "the payer marks it" and
-- one tap stamps the whole thing. On a multi-payer expense it means each creditor confirms their
-- own portion, and the stamp appears once every edge is covered — which is exactly right, and
-- falls out of the coverage definition without a single extra branch.
--
-- ---------------------------------------------------------------- also in here
--
-- The `0035` regression (a live bug, shipping now): that migration rebuilt `get_group_detail`
-- and renamed the expense payload keys out from under `api.ts`. Fixed below, with a pgTAP
-- assertion that locks all three read RPCs' payload keys so it cannot happen a third time.

-- ---------------------------------------------------------------- schema

alter table public.settlements
  add column if not exists expense_id uuid references public.expenses(id);

comment on column public.settlements.expense_id is
  'Set when this payment cleared one specific expense; NULL for a free-form pairwise settlement, '
  'which is what record_settlement still writes. The column is the whole of "paid in full".';

-- Partial: the overwhelming majority of settlements are free-form and carry NULL here, and the
-- only query that reads this column is the per-expense coverage check.
create index if not exists settlements_expense_idx
  on public.settlements (expense_id, to_profile_id, from_profile_id)
  where expense_id is not null and deleted_at is null;

/*
 * A fourth void reason.
 *
 * `voided_by_merge` (0013) set the precedent: a settlement is never hard-deleted, because the
 * payment really happened and the record is history. Deleting a stamped expense has to void its
 * settlements — otherwise the balance keeps credit for an expense that no longer exists — but it
 * must be distinguishable from a user un-marking, or restoring the expense would resurrect
 * payments the user had deliberately withdrawn.
 */
alter table public.settlements drop constraint if exists settlements_status_check;
alter table public.settlements add constraint settlements_status_check
  check (status in ('recorded','confirmed','disputed','voided','voided_by_merge','voided_by_delete'));

/*
 * `settlement_void` — a sync tick that says nothing out loud.
 *
 * Un-marking has to reach the other person's phone, or their balance stays wrong until they
 * pull to refresh. But it must NOT reuse `settlement`, because 0028 maps that to the
 * "Settled up · <name> recorded a settlement" push regardless of `op` — so withdrawing a
 * payment would notify the debtor that one had been made. A push that says the opposite of what
 * happened is worse than silence.
 *
 * An unrecognised entity type is already a designed-for case: 0028's `else null` makes it
 * "structural — syncs the client, says nothing out loud", which is precisely what a correction
 * by the person who made it should be. The client must learn this type too; that is the one-line
 * `case 'settlement_void'` beside `case 'settlement'` in lib/offline/realtime.ts.
 */
alter table internal.change_events drop constraint if exists change_events_entity_type_check;
alter table internal.change_events add constraint change_events_entity_type_check
  check (entity_type in
    ('expense','settlement','settlement_void','comment','group','member','profile'));

-- ---------------------------------------------------------------- coverage

/*
 * Every debt edge this expense produced, beside how much of it has been settled against THIS
 * expense.
 *
 * One function, because everything below needs the same numbers and computing them twice in two
 * slightly different ways is how a stamp and a balance start disagreeing.
 *
 * `status in ('recorded','confirmed')` is not a choice made here — it is copied from
 * `app.v_pair_ledger`, which is what decides whether a settlement moves a balance. The rule that
 * says a payment counts must be the same rule in both places, or an expense can read as paid
 * while the money is still outstanding.
 */
create or replace function app.expense_debt_coverage(p_expense_id uuid)
returns table (from_profile_id uuid, to_profile_id uuid, amount_minor bigint, settled_minor bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select d.from_profile_id,
         d.to_profile_id,
         d.amount_minor,
         coalesce((
           select sum(s.amount_minor)::bigint
           from public.settlements s
           where s.expense_id = p_expense_id
             and s.from_profile_id = d.from_profile_id
             and s.to_profile_id   = d.to_profile_id
             and s.deleted_at is null
             and s.status in ('recorded','confirmed')
         ), 0::bigint)
  from public.expense_debts d
  where d.expense_id = p_expense_id;
$$;

/*
 * When this expense became paid in full, or NULL if it is not.
 *
 * ⚠️ The definition that matters: **every** debt edge covered, not "a settlement whose amount
 * equals amount_minor". A three-way split where only one person has paid would satisfy the naive
 * version and stamp a half-paid expense.
 *
 * An expense with no debt edges at all — everyone paid exactly their own share — is NOT paid in
 * full. Nothing was ever owed, so there is nothing to have paid, and "for every edge" over an
 * empty set would otherwise be vacuously true and stamp it.
 *
 * The timestamp is the newest linked settlement's `created_at`, which is what the stamp prints.
 * No extra column: the date is already a fact about the payment.
 */
create or replace function app.expense_paid_in_full_at(p_expense_id uuid)
returns timestamptz
language sql
security definer
stable
set search_path = ''
as $$
  -- One pass over the edges, not three. `get_group_detail` calls this for up to 200 expenses in
  -- a single request, so the difference between one scan and three is the whole cost of the
  -- feature on the screen people open most.
  select case
    when count(*) = 0 then null                                             -- nothing was owed
    when count(*) filter (where c.settled_minor < c.amount_minor) > 0 then null
    else (
      select max(s.created_at)
      from public.settlements s
      where s.expense_id = p_expense_id
        and s.deleted_at is null
        and s.status in ('recorded','confirmed')
    )
  end
  from app.expense_debt_coverage(p_expense_id) c;
$$;

-- ---------------------------------------------------------------- mark / unmark

/*
 * Confirm that everything owed TO YOU on this expense has come back.
 *
 * Writes one settlement per outstanding edge pointing at the caller, in one transaction, each
 * carrying `expense_id` so the coverage check above can see it.
 *
 * Two refusals, and they are different things:
 *   - nobody owes you anything here  → 42501. This is the authorisation rule.
 *   - everything is already covered  → no-op returning the current state, not an error. A double
 *     tap, or an outbox row re-keyed after a conflict, should not land in the pending inbox.
 */
create or replace function app.mark_expense_paid(
  p_expense_id         uuid,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_cached   jsonb;
  v_group_id uuid;
  v_edge     record;
  v_short    bigint;
  v_written  integer := 0;
  v_total    bigint  := 0;
  v_id       uuid;
  v_result   jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'mark_expense_paid',
    jsonb_build_object('expense_id', p_expense_id));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  -- `for update` against a concurrent delete_expense, which voids these same rows.
  select group_id into v_group_id
  from public.expenses
  where id = p_expense_id and deleted_at is null
  for update;

  if not found then
    raise exception 'expense % not found or deleted', p_expense_id using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from app.expense_debt_coverage(p_expense_id) c where c.to_profile_id = v_me
  ) then
    raise exception 'only someone who is owed money on this expense can mark it paid in full'
      using errcode = '42501';
  end if;

  for v_edge in
    select c.from_profile_id, c.amount_minor, c.settled_minor
    from app.expense_debt_coverage(p_expense_id) c
    where c.to_profile_id = v_me
    order by c.from_profile_id
  loop
    v_short := v_edge.amount_minor - v_edge.settled_minor;
    continue when v_short <= 0;

    v_id := extensions.gen_random_uuid();

    insert into public.settlements (
      id, group_id, expense_id, from_profile_id, to_profile_id, amount_minor,
      method, settled_on, recorded_by_profile_id
    ) values (
      v_id, v_group_id, p_expense_id,
      v_edge.from_profile_id, v_me, v_short,
      -- 'other', because marking an expense paid says the money arrived, not how. Claiming
      -- 'upi' here would put a payment method in the record that nobody stated.
      'other', current_date, v_me
    );

    -- Per settlement rather than one event for the expense: the entity id then actually names
    -- the row it points at, and each debtor hears once, about their own payment. The payer is
    -- the actor, so 0028 filters them out of their own notification.
    perform internal.emit_change(
      array[v_edge.from_profile_id, v_me], v_me, v_group_id, 'settlement', v_id, 'insert');

    v_written := v_written + 1;
    v_total   := v_total + v_short;
  end loop;

  v_result := jsonb_build_object(
    'expense_id',       p_expense_id,
    'settled_minor',    v_total,
    'settlement_count', v_written,
    'paid_in_full_at',  app.expense_paid_in_full_at(p_expense_id));

  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Take it back.
 *
 * Voids rather than deletes — same reason as everywhere else, the record is history — and only
 * the caller's own edges, which is the mirror of the rule above: you may withdraw a confirmation
 * you made about money owed to you, and nobody else's.
 *
 * Free-form settlements are untouched by construction: the predicate requires `expense_id`.
 */
create or replace function app.unmark_expense_paid(
  p_expense_id         uuid,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_cached   jsonb;
  v_group_id uuid;
  v_row      record;
  v_voided   integer := 0;
  v_total    bigint  := 0;
  v_result   jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'unmark_expense_paid',
    jsonb_build_object('expense_id', p_expense_id));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  select group_id into v_group_id
  from public.expenses where id = p_expense_id
  for update;

  if not found then
    raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
  end if;

  for v_row in
    update public.settlements
       set status = 'voided'
     where expense_id = p_expense_id
       and to_profile_id = v_me
       and deleted_at is null
       and status in ('recorded','confirmed')
    returning id, from_profile_id, amount_minor
  loop
    perform internal.emit_change(
      array[v_row.from_profile_id, v_me], v_me, v_group_id,
      'settlement_void', v_row.id, 'delete');

    v_voided := v_voided + 1;
    v_total  := v_total + v_row.amount_minor;
  end loop;

  v_result := jsonb_build_object(
    'expense_id',       p_expense_id,
    'voided_minor',     v_total,
    'settlement_count', v_voided);

  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

-- ---------------------------------------------------------------- the two hard cases

/*
 * Deleting a stamped expense. **This is the one that silently corrupts a ledger.**
 *
 * A soft delete drops the expense's debts out of `v_pair_ledger` (it joins `expenses` and
 * filters `deleted_at`) — but settlements are NOT joined to anything, so their rows keep
 * reducing the balance for an expense that no longer exists. Delete a stamped ₹50,000 dinner and
 * the payer would go ₹50,000 into the red against people who owe them nothing.
 *
 * So the linked settlements are voided in the same transaction, marked `voided_by_delete` so
 * `restore_expense` can tell them apart from ones a user withdrew on purpose.
 *
 * Everything else in this function is 0012's body verbatim.
 */
create or replace function app.delete_expense(
  p_expense_id         uuid,
  p_expected_revision  integer,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me           uuid := auth_ext.assert_signed_in();
  v_cached       jsonb;
  v_current      integer;
  v_group_id     uuid;
  v_participants uuid[];
  v_result       jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'delete_expense',
    jsonb_build_object('expense_id', p_expense_id, 'expected_revision', p_expected_revision));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  select revision, group_id into v_current, v_group_id
  from public.expenses where id = p_expense_id and deleted_at is null
  for update;

  if not found then
    raise exception 'expense % not found or already deleted', p_expense_id using errcode = 'P0002';
  end if;

  if p_expected_revision is not null and v_current <> p_expected_revision then
    raise exception 'expense % changed while you were away (server revision %, you had %)',
      p_expense_id, v_current, p_expected_revision
      using errcode = 'P0409', detail = app.expense_snapshot(p_expense_id)::text;
  end if;

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_participants
  from public.expense_participants where expense_id = p_expense_id;

  update public.expenses
     set deleted_at = now(), deleted_by_profile_id = v_me, revision = revision + 1
   where id = p_expense_id;

  -- New in 0039. No separate change event: the `expense/delete` emitted below already tells
  -- every participant to refetch, and it is the honest headline for what just happened.
  update public.settlements
     set status = 'voided_by_delete'
   where expense_id = p_expense_id
     and deleted_at is null
     and status in ('recorded','confirmed');

  insert into public.expense_revisions
    (expense_id, revision, action, actor_profile_id, snapshot, client_mutation_id)
  values
    (p_expense_id, v_current + 1, 'deleted', v_me, app.expense_snapshot(p_expense_id), p_client_mutation_id);

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', p_expense_id, 'delete');

  v_result := jsonb_build_object('expense_id', p_expense_id, 'revision', v_current + 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Restoring one. The mirror: the debts come back, so the payments that cleared them come back
 * too — but ONLY the ones the delete itself voided.
 *
 * A settlement a user un-marked before deleting stays voided, which is why the delete needed its
 * own status value rather than reusing 'voided'.
 *
 * Known and accepted: a settlement that was 'confirmed' before the delete returns as 'recorded'.
 * Nothing in the app sets 'confirmed' yet, so this is theoretical; when a confirm flow exists it
 * needs its own restore path rather than this one growing a second status column.
 *
 * Everything else in this function is 0012's body verbatim.
 */
create or replace function app.restore_expense(
  p_expense_id         uuid,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me           uuid := auth_ext.assert_signed_in();
  v_cached       jsonb;
  v_current      integer;
  v_group_id     uuid;
  v_participants uuid[];
  v_result       jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'restore_expense', jsonb_build_object('expense_id', p_expense_id));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  select revision, group_id into v_current, v_group_id
  from public.expenses where id = p_expense_id and deleted_at is not null
  for update;

  if not found then
    raise exception 'expense % is not deleted', p_expense_id using errcode = 'P0002';
  end if;

  update public.expenses
     set deleted_at = null, deleted_by_profile_id = null, revision = revision + 1
   where id = p_expense_id;

  -- New in 0039.
  update public.settlements
     set status = 'recorded'
   where expense_id = p_expense_id
     and status = 'voided_by_delete';

  -- The invariant applies again from here, so re-check it now rather than at some later edit.
  set constraints all immediate;

  insert into public.expense_revisions
    (expense_id, revision, action, actor_profile_id, snapshot, client_mutation_id)
  values
    (p_expense_id, v_current + 1, 'restored', v_me, app.expense_snapshot(p_expense_id), p_client_mutation_id);

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_participants
  from public.expense_participants where expense_id = p_expense_id;

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', p_expense_id, 'update');

  v_result := jsonb_build_object('expense_id', p_expense_id, 'revision', v_current + 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Editing a stamped expense needs NO code at all, and that is worth stating so nobody "fixes"
 * it later.
 *
 * Because the stamp is derived from coverage rather than stored, raising the amount un-stamps
 * the expense automatically and the settlements stay — which is correct, that money really did
 * move; there is simply more owed now. Lowering it below the settled total leaves it
 * over-covered, and over-covered still reads as paid. Both are asserted in pgTAP.
 */

-- ---------------------------------------------------------------- reads

/*
 * Expense detail, gaining the three facts the stamp and its button need.
 *
 * Everything else is 0017's body verbatim.
 *
 *   paid_in_full_at    — when the stamp landed, or null. Drives the stamp and its date.
 *   outstanding_to_me  — who still owes the caller on this expense, and how much. Non-empty is
 *                        exactly the condition `mark_expense_paid` enforces, so the button cannot
 *                        offer an action the server will refuse.
 *   settled_to_me      — what the caller has already confirmed here, per person. Drives "undo".
 *
 * Both are per-person breakdowns rather than the scalars a first draft had, because the offline
 * outbox needs them: a queued write carries its own balance movement, and balances are per-pair.
 * A total cannot be split back into the pairs it came from, so a scalar would have forced the
 * overlay to guess — and a guessed balance is the one thing this app cannot ship.
 */
create or replace function app.get_expense_detail(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me        uuid := auth_ext.assert_signed_in();
  v_expense   public.expenses%rowtype;
  v_payers    jsonb;
  v_splits    jsonb;
  v_items     jsonb;
  v_comments  jsonb;
  v_history   jsonb;
  v_receipts  jsonb;
begin
  select * into v_expense from public.expenses where id = p_expense_id;

  if not found then
    raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.expense_participants ep
    where ep.expense_id = p_expense_id and ep.profile_id = v_me
  ) and not (
    v_expense.group_id is not null and auth_ext.is_group_member(v_expense.group_id)
  ) then
    raise exception 'not your expense' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', p.profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'paid_amount_minor', p.paid_amount_minor
  ) order by p.paid_amount_minor desc), '[]'::jsonb) into v_payers
  from public.expense_payers p
  join public.profiles pr on pr.id = p.profile_id
  where p.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', s.profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'share_amount_minor', s.share_amount_minor,
    'weight', s.split_weight
  ) order by s.share_amount_minor desc), '[]'::jsonb) into v_splits
  from public.expense_splits s
  join public.profiles pr on pr.id = s.profile_id
  where s.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'amount_minor', i.amount_minor,
    'kind', i.kind,
    'participants', coalesce((
      select jsonb_agg(sh.profile_id) from public.expense_item_shares sh where sh.item_id = i.id
    ), '[]'::jsonb)
  ) order by i.position), '[]'::jsonb) into v_items
  from public.expense_items i
  where i.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'author_profile_id', c.author_profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'body', c.body,
    'created_at', c.created_at
  ) order by c.created_at), '[]'::jsonb) into v_comments
  from public.expense_comments c
  join public.profiles pr on pr.id = c.author_profile_id
  where c.expense_id = p_expense_id and c.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision', r.revision,
    'action', r.action,
    'actor_profile_id', r.actor_profile_id,
    'display_name', pr.display_name,
    'created_at', r.created_at,
    'diff', r.diff
  ) order by r.revision desc, r.created_at desc), '[]'::jsonb) into v_history
  from public.expense_revisions r
  left join public.profiles pr on pr.id = r.actor_profile_id
  where r.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'storage_path', a.storage_path, 'mime_type', a.mime_type
  ) order by a.created_at), '[]'::jsonb) into v_receipts
  from public.expense_attachments a
  where a.expense_id = p_expense_id;

  return jsonb_build_object(
    'expense', jsonb_build_object(
      'id', v_expense.id,
      'group_id', v_expense.group_id,
      'group_name', (select g.name from public.groups g where g.id = v_expense.group_id),
      'description', v_expense.description,
      'amount_minor', v_expense.amount_minor,
      'currency', v_expense.currency,
      'split_type', v_expense.split_type,
      'spent_on', v_expense.spent_on,
      'revision', v_expense.revision,
      'deleted_at', v_expense.deleted_at,
      'created_by_profile_id', v_expense.created_by_profile_id,
      'created_at', v_expense.created_at
    ),
    'my_share_minor', coalesce((
      select s.share_amount_minor from public.expense_splits s
      where s.expense_id = p_expense_id and s.profile_id = v_me
    ), 0),
    'my_paid_minor', coalesce((
      select p.paid_amount_minor from public.expense_payers p
      where p.expense_id = p_expense_id and p.profile_id = v_me
    ), 0),
    -- New in 0039.
    'paid_in_full_at', app.expense_paid_in_full_at(p_expense_id),
    'outstanding_to_me', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id',   c.from_profile_id,
               'amount_minor', c.amount_minor - c.settled_minor)
             order by c.from_profile_id)
      from app.expense_debt_coverage(p_expense_id) c
      where c.to_profile_id = v_me and c.amount_minor > c.settled_minor
    ), '[]'::jsonb),
    /*
     * Read off the settlements themselves rather than off the coverage, because these are the
     * rows `unmark_expense_paid` will void — and after an edit that dropped a participant, a
     * settlement can outlive the debt edge it was written against.
     *
     * On a DELETED expense this reports the `voided_by_delete` rows instead, which are the ones
     * `restore_expense` will bring back. The client needs that: its offline balance overlay is
     * computed at enqueue time, so a restore has to know what returns to the ledger alongside the
     * debts, or restoring a stamped expense shows the payer owed money that has already come
     * back to them. Reading "what is in force, or what would be if this were restored" from one
     * field is what keeps delete and restore symmetrical on the client.
     *
     * It cannot be mistaken for a live settlement: `paid_in_full_at` is null for a deleted
     * expense, and the screen gates both the stamp and the undo on that.
     */
    'settled_to_me', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', t.pid, 'amount_minor', t.amt)
                       order by t.pid)
      from (
        select s.from_profile_id as pid, sum(s.amount_minor) as amt
        from public.settlements s
        where s.expense_id = p_expense_id
          and s.to_profile_id = v_me
          and s.deleted_at is null
          and (s.status in ('recorded','confirmed')
               or (v_expense.deleted_at is not null and s.status = 'voided_by_delete'))
        group by s.from_profile_id
      ) t
    ), '[]'::jsonb),
    'payers', v_payers,
    'splits', v_splits,
    'items', v_items,
    'comments', v_comments,
    'history', v_history,
    'receipts', v_receipts
  );
end;
$$;

/*
 * Group detail — and the `0035` regression, fixed.
 *
 * ⚠️ 0035 rebuilt this function to add a member's `role` and, in the rewrite, renamed the
 * expense payload's keys: `payers` → `payer_names`, `split_count` → `participant_count`, and
 * dropped `revision` entirely. `api.ts:toExpenseListItem` still read the originals, and its
 * `?? 0` / `?? []` defaults swallowed every one of them — so the group list rendered
 * "Nobody paid · split 0 ways" against perfectly correct server data.
 *
 * Nothing failed. Not typecheck, not lint, not 206 pgTAP assertions, because the client casts
 * out of `jsonb` and defaults on missing keys. That is the lesson worth keeping: **any migration
 * that rewrites a read RPC must diff its emitted keys against the client's reader** — and the
 * assertion in tests/paid_in_full.test.sql now does exactly that, for all three read RPCs.
 *
 * `payers` carries `profile_id`, not just a name, because `payerLabel` needs it to say "You
 * paid" rather than reading your own name back at you. `payer_names` and `participant_count`
 * are kept alongside: harmless, and removing them would be the same class of mistake in reverse.
 */
create or replace function app.get_group_detail(
  p_group_id uuid,
  p_limit    integer default 50,
  p_before   date default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_group    jsonb;
  v_members  jsonb;
  v_expenses jsonb;
begin
  perform auth_ext.assert_group_member(p_group_id);

  select to_jsonb(g) into v_group from public.groups g where g.id = p_group_id;

  select coalesce(jsonb_agg(m order by m->>'display_name'), '[]'::jsonb) into v_members
  from (
    select jsonb_build_object(
      'profile_id', pr.id,
      'display_name', pr.display_name,
      'avatar_url', pr.avatar_url,
      'is_placeholder', pr.user_id is null,
      'role', gm.role,
      'net_minor', coalesce((select b.net_minor from app.v_group_balances b
                              where b.group_id = p_group_id and b.profile_id = pr.id), 0)
    ) as m
    from public.group_members gm
    join public.profiles pr on pr.id = gm.profile_id
    where gm.group_id = p_group_id and gm.left_at is null
  ) t;

  select coalesce(jsonb_agg(e order by e->>'spent_on' desc), '[]'::jsonb) into v_expenses
  from (
    select jsonb_build_object(
      'id', ex.id,
      'description', ex.description,
      'amount_minor', ex.amount_minor,
      'spent_on', ex.spent_on,
      'split_type', ex.split_type,
      -- Restored in 0039.
      'revision', ex.revision,
      'payers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'profile_id', ep.profile_id,
                 'paid_amount_minor', ep.paid_amount_minor)
               order by ep.paid_amount_minor desc)
        from public.expense_payers ep
        where ep.expense_id = ex.id
      ), '[]'::jsonb),
      'split_count', (
        select count(*) from public.expense_splits es where es.expense_id = ex.id
      ),
      'payer_names', (
        select coalesce(jsonb_agg(p2.display_name order by p2.display_name), '[]'::jsonb)
        from public.expense_payers ep
        join public.profiles p2 on p2.id = ep.profile_id
        where ep.expense_id = ex.id
      ),
      'participant_count', (
        select count(*) from public.expense_participants epa where epa.expense_id = ex.id
      ),
      'my_share_minor', coalesce((
        select es.share_amount_minor from public.expense_splits es
        where es.expense_id = ex.id and es.profile_id = v_me
      ), 0),
      -- New in 0039: the small stamp on a settled row.
      'paid_in_full_at', app.expense_paid_in_full_at(ex.id)
    ) as e
    from public.expenses ex
    where ex.group_id = p_group_id
      and ex.deleted_at is null
      and (p_before is null or ex.created_at < p_before)
    order by ex.spent_on desc, ex.created_at desc
    limit greatest(1, least(p_limit, 200))
  ) t;

  return jsonb_build_object('group', v_group, 'members', v_members, 'expenses', v_expenses);
end;
$$;

/*
 * Person detail, gaining the same stamp field.
 *
 * `ExpenseRow` is shared between Group detail and Person detail, so a stamp that only one of
 * them can supply would make the same expense read as paid on one screen and unpaid on the
 * other. Everything else is 0014's body verbatim.
 */
create or replace function app.get_person_detail(
  p_profile_id uuid,
  p_limit      integer default 50
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_person   jsonb;
  v_net      bigint;
  v_by_group jsonb;
  v_expenses jsonb;
begin
  if not auth_ext.shares_context_with(p_profile_id) then
    raise exception 'no shared context with profile %', p_profile_id using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
    'upi_vpa', pr.upi_vpa, 'is_placeholder', pr.user_id is null
  ) into v_person
  from public.profiles pr where pr.id = p_profile_id;

  select coalesce(case when pb.lo = v_me then -pb.net_minor else pb.net_minor end, 0)
    into v_net
  from app.v_pair_balances pb
  where pb.lo = least(v_me, p_profile_id) and pb.hi = greatest(v_me, p_profile_id);

  select coalesce(jsonb_agg(g), '[]'::jsonb) into v_by_group
  from (
    select jsonb_build_object(
      'group_id', l.group_id,
      'group_name', gr.name,
      'net_minor', sum(case when l.lo = v_me then -l.amt else l.amt end)
    ) as g
    from app.v_pair_ledger l
    left join public.groups gr on gr.id = l.group_id
    where l.lo = least(v_me, p_profile_id) and l.hi = greatest(v_me, p_profile_id)
    group by l.group_id, gr.name
    having sum(l.amt) <> 0
  ) t;

  select coalesce(jsonb_agg(e order by e->>'spent_on' desc), '[]'::jsonb) into v_expenses
  from (
    select jsonb_build_object(
      'id', ex.id,
      'description', ex.description,
      'amount_minor', ex.amount_minor,
      'spent_on', ex.spent_on,
      'group_id', ex.group_id,
      'group_name', gr.name,
      'my_share_minor', coalesce((select s.share_amount_minor from public.expense_splits s
                                   where s.expense_id = ex.id and s.profile_id = v_me), 0),
      'their_share_minor', coalesce((select s.share_amount_minor from public.expense_splits s
                                      where s.expense_id = ex.id and s.profile_id = p_profile_id), 0),
      -- New in 0039.
      'paid_in_full_at', app.expense_paid_in_full_at(ex.id)
    ) as e
    from public.expenses ex
    left join public.groups gr on gr.id = ex.group_id
    where ex.deleted_at is null
      and exists (select 1 from public.expense_participants a
                   where a.expense_id = ex.id and a.profile_id = v_me)
      and exists (select 1 from public.expense_participants b
                   where b.expense_id = ex.id and b.profile_id = p_profile_id)
    order by ex.spent_on desc, ex.id
    limit greatest(1, least(p_limit, 200))
  ) t;

  return jsonb_build_object(
    'person', v_person,
    'net_minor', coalesce(v_net, 0),
    'by_group', v_by_group,
    'expenses', v_expenses
  );
end;
$$;

-- ---------------------------------------------------------------- the callable surface

create or replace function public.mark_expense_paid(
  p_expense_id uuid, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.mark_expense_paid(p_expense_id, p_client_mutation_id);
$$;

create or replace function public.unmark_expense_paid(
  p_expense_id uuid, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.unmark_expense_paid(p_expense_id, p_client_mutation_id);
$$;

-- `revoke from public, anon` — both, or anon keeps the explicit EXECUTE grant Supabase's
-- default privileges hand out and `revoke from public` only removes the PUBLIC one. The
-- guardrail test in tests/guardrails.test.sql asserts on exactly this.
revoke all on function
  app.expense_debt_coverage(uuid),
  app.expense_paid_in_full_at(uuid),
  app.mark_expense_paid(uuid, uuid),
  app.unmark_expense_paid(uuid, uuid)
from public;

revoke all on function
  public.mark_expense_paid(uuid, uuid),
  public.unmark_expense_paid(uuid, uuid)
from public, anon;

grant execute on function
  app.mark_expense_paid(uuid, uuid),
  app.unmark_expense_paid(uuid, uuid)
to authenticated;

grant execute on function
  public.mark_expense_paid(uuid, uuid),
  public.unmark_expense_paid(uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
