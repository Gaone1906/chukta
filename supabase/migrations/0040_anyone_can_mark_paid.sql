-- Anyone can mark an expense paid in full — and the record says who did.
--
-- ---------------------------------------------------------------- what changes, and the risk
--
-- 0039 let only the person owed the money confirm it came back, and only for their own share.
-- That is the conservative rule and it has a real cost: the one person who most wants an expense
-- closed is usually the one who just paid it back, and they could not say so.
--
-- So the gate opens: **anyone who can see the expense may mark it paid in full**, and doing so
-- settles every outstanding debt on it, not just the marker's own.
--
-- Be clear about what that means, because it is a change in what the ledger can assert. Before
-- this, the app could not record a payment the recipient had not acknowledged. Now it can —
-- somebody who owes you ₹50,000 can mark it settled without you agreeing. Two things make that
-- safe, and **neither is optional**:
--
--   1. `settlements.recorded_by_profile_id` already carries who did it. It stops being an audit
--      column nobody reads and becomes the byline on the expense and on every list row.
--   2. **Anyone can undo.** A name tells you who to blame after your balance is already wrong;
--      the undo is what stops it being wrong. Whoever loses money must never be trapped by
--      somebody else's mark.
--
-- And because undo is now something one person can do to another, it stops being silent: it gets
-- its own notification kind rather than the `settlement_void` sync-only tick 0039 introduced.

-- ---------------------------------------------------------------- who marked it

/*
 * The marker of record, for the byline.
 *
 * The newest linked settlement wins. In practice they all share one `recorded_by` — marking is
 * one call that writes every edge at once — but an expense edited upward and re-marked by
 * somebody else will hold two generations, and the person who closed it *last* is the one whose
 * name belongs on it.
 */
create or replace function app.expense_marked_by(p_expense_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
           'profile_id',   pr.id,
           'display_name', pr.display_name,
           'avatar_url',   pr.avatar_url,
           'at',           s.created_at)
  from public.settlements s
  join public.profiles pr on pr.id = s.recorded_by_profile_id
  where s.expense_id = p_expense_id
    and s.deleted_at is null
    and s.status in ('recorded','confirmed')
  order by s.created_at desc, s.id
  limit 1;
$$;

-- ---------------------------------------------------------------- mark

/*
 * Say that everything owed on this expense has been paid.
 *
 * Authorisation is now just "can you see it" — `assert_can_edit_expense`, which is participation
 * in the expense or membership of its group. The old rule (you must be owed on this edge) is
 * gone, and with it the per-edge scoping: one call settles **every** outstanding debt.
 *
 * Two refusals remain, and they are different things:
 *   - nothing is outstanding at all → P0002. There is nothing to settle; stamping it would be
 *     decoration. This also covers an expense where everyone paid exactly their own share.
 *   - already fully covered → no-op returning the current state, not an error. A double tap, or
 *     an outbox row re-keyed after a conflict, should not land in the pending inbox.
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

  if not exists (select 1 from app.expense_debt_coverage(p_expense_id)) then
    raise exception 'nothing is owed on expense %', p_expense_id using errcode = 'P0002';
  end if;

  for v_edge in
    select c.from_profile_id, c.to_profile_id, c.amount_minor, c.settled_minor
    from app.expense_debt_coverage(p_expense_id) c
    order by c.from_profile_id, c.to_profile_id
  loop
    v_short := v_edge.amount_minor - v_edge.settled_minor;
    continue when v_short <= 0;

    v_id := extensions.gen_random_uuid();

    insert into public.settlements (
      id, group_id, expense_id, from_profile_id, to_profile_id, amount_minor,
      method, settled_on, recorded_by_profile_id
    ) values (
      v_id, v_group_id, p_expense_id,
      v_edge.from_profile_id, v_edge.to_profile_id, v_short,
      -- 'other', because marking an expense paid says the money arrived, not how. Claiming
      -- 'upi' here would put a payment method in the record that nobody stated.
      'other', current_date, v_me
    );

    -- Both parties, plus the marker — who may now be neither of them. `emit_change` de-duplicates
    -- and the notification trigger drops the actor, so the marker gets a sync tick for their own
    -- other devices without being told what they just did.
    perform internal.emit_change(
      array[v_edge.from_profile_id, v_edge.to_profile_id, v_me],
      v_me, v_group_id, 'settlement', v_id, 'insert');

    v_written := v_written + 1;
    v_total   := v_total + v_short;
  end loop;

  v_result := jsonb_build_object(
    'expense_id',       p_expense_id,
    'settled_minor',    v_total,
    'settlement_count', v_written,
    'paid_in_full_at',  app.expense_paid_in_full_at(p_expense_id),
    'marked_by',        app.expense_marked_by(p_expense_id));

  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Take it back — anyone, not just whoever marked it.
 *
 * This is the half that makes the open rule safe, so it is deliberately not scoped to the
 * marker: the person who would lose money to a wrong mark has to be able to reverse it, and they
 * are precisely the person who did not make it.
 *
 * Voids rather than deletes, like every other retraction here — the payment record is history.
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
       and deleted_at is null
       and status in ('recorded','confirmed')
    returning id, from_profile_id, to_profile_id, amount_minor, recorded_by_profile_id
  loop
    -- **The person whose mark this reverses is a recipient.** That is new in 0040 and it is the
    -- reason the event stopped being silent: under 0039 you could only undo your own mark, so
    -- there was nobody to tell. Now there is, and being quietly overruled about money is exactly
    -- the thing somebody needs to hear about.
    perform internal.emit_change(
      array[v_row.from_profile_id, v_row.to_profile_id, v_row.recorded_by_profile_id, v_me],
      v_me, v_group_id, 'settlement_void', v_row.id, 'delete');

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

-- ---------------------------------------------------------------- the undo notification

/*
 * `settlement_undone` — a new kind, and the only reason this migration touches 0028's trigger.
 *
 * 0039 routed un-marking through `settlement_void`, which the `case` below did not recognise, so
 * it fell to `else null` and synced silently. That was right when only the person who made a
 * mark could undo it — telling somebody they had undone their own action is noise. It is wrong
 * now: an undo is one person overruling another about money, and silence there means the first
 * they hear of it is a balance that changed on its own.
 *
 * Everything else in this function is 0033's body verbatim.
 */
create or replace function internal.enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text;
  v_coalesce text;
  v_title    text;
  v_body     text;
  v_actor    text;
  v_changed  jsonb;
  v_action   text;
  v_existing bigint;
  v_recent   int;
  v_hourly   int;
  v_when     timestamptz;
  v_hold     interval := interval '45 seconds';
begin
  if new.actor_profile_id is not null and new.recipient_profile_id = new.actor_profile_id then
    return null;
  end if;

  v_kind := case
    when new.entity_type = 'expense' and new.op = 'insert' then 'expense_added'
    when new.entity_type = 'expense' and new.op = 'update' then 'expense_edited'
    when new.entity_type = 'expense' and new.op = 'delete' then 'expense_deleted'
    when new.entity_type = 'comment' then 'comment'
    when new.entity_type = 'settlement' then 'settlement'
    -- New in 0040.
    when new.entity_type = 'settlement_void' then 'settlement_undone'
    when new.entity_type = 'group' and new.op = 'insert' then 'group_added'
    else null
  end;

  -- Profile merges and anything else structural sync the client but say nothing out loud.
  if v_kind is null then
    return null;
  end if;

  if v_kind = 'expense_edited' then
    select r.diff -> 'shares_changed', r.action into v_changed, v_action
    from public.expense_revisions r
    where r.expense_id = new.entity_id
    order by r.revision desc
    limit 1;

    if v_changed is not null
       and not (v_changed @> to_jsonb(new.recipient_profile_id::text)) then
      return null;
    end if;

    if v_action = 'restored' then
      v_kind := 'expense_restored';
    end if;
  end if;

  if v_kind = 'expense_added' and new.group_id is not null then
    perform 1 from internal.notification_queue q
     where q.recipient_profile_id = new.recipient_profile_id
       and q.kind = 'group_added'
       and q.status = 'pending'
       and q.data ->> 'group_id' = new.group_id::text
       and q.not_before > now();
    if found then
      return null;
    end if;
  end if;

  if not internal.wants_notification(new.recipient_profile_id, v_kind) then
    return null;
  end if;

  select coalesce(p.display_name, 'Someone') into v_actor
  from public.profiles p where p.id = new.actor_profile_id;
  v_actor := coalesce(v_actor, 'Someone');

  v_coalesce := v_kind || ':' || coalesce(new.group_id::text, 'oneoff') || ':'
                || coalesce(new.actor_profile_id::text, 'system');

  v_title := case v_kind
    when 'expense_added'   then 'New expense'
    when 'expense_edited'  then 'Expense updated'
    when 'expense_deleted' then 'Expense removed'
    when 'expense_restored' then 'Expense restored'
    when 'comment'         then 'New comment'
    when 'settlement'      then 'Settled up'
    when 'settlement_undone' then 'Payment undone'
    when 'group_added'     then 'Added to a group'
    else 'Chukta'
  end;

  v_body := case v_kind
    when 'expense_added'   then v_actor || ' added an expense'
    when 'expense_edited'  then v_actor || ' changed your share'
    when 'expense_deleted' then v_actor || ' removed an expense'
    when 'expense_restored' then v_actor || ' restored an expense'
    when 'comment'         then v_actor || ' commented'
    when 'settlement'      then v_actor || ' recorded a settlement'
    -- Names the reversal rather than the balance, because the balance moving is the part the
    -- recipient will notice on their own.
    when 'settlement_undone' then v_actor || ' undid a paid-in-full mark'
    when 'group_added'     then v_actor || ' added you to a group'
    else 'Something changed'
  end;

  if v_kind = 'expense_edited' then
    select q.id into v_existing
    from internal.notification_queue q
    where q.recipient_profile_id = new.recipient_profile_id
      and q.status = 'pending'
      and q.data ->> 'entity_id' = new.entity_id::text
      and q.created_at > now() - interval '5 minutes'
    limit 1;

    if v_existing is not null then
      update internal.notification_queue
         set body = v_body, event_id = new.id
       where id = v_existing and kind = 'expense_edited';

      if found then
        return null;
      end if;
    end if;
  end if;

  select count(*) into v_recent
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.coalesce_key = v_coalesce
    and q.status = 'pending'
    and q.not_before > now();

  if v_recent > 0 then
    update internal.notification_queue
       set event_id = new.id
     where recipient_profile_id = new.recipient_profile_id
       and coalesce_key = v_coalesce
       and status = 'pending'
       and not_before > now();
    return null;
  end if;

  select count(*) into v_hourly
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.created_at > now() - interval '1 hour';

  if v_hourly >= 20 then
    v_hold := interval '1 hour';
  end if;

  v_when := internal.next_sendable_at(new.recipient_profile_id, now() + v_hold);

  insert into internal.notification_queue
    (recipient_profile_id, event_id, kind, coalesce_key, title, body, data, not_before, status)
  values
    (new.recipient_profile_id, new.id, v_kind, v_coalesce, v_title, v_body,
     jsonb_build_object(
       'entity_type', new.entity_type,
       'entity_id', new.entity_id,
       'group_id', new.group_id),
     v_when, 'pending');

  return null;
end;
$$;

/*
 * Undo rides the `settlements` preference.
 *
 * Not its own toggle: it is the same conversation as "somebody recorded a payment", and a
 * settings screen that lists both "Settlements" and "Settlements, undone" is asking the user to
 * hold a distinction the app invented. Someone who muted settlements has muted this.
 *
 * Everything else in this function is 0032's body verbatim.
 */
create or replace function internal.wants_notification(p_profile_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case p_kind
       when 'expense_added'   then p.new_expenses
       when 'expense_edited'  then p.expense_edits
       when 'expense_deleted' then p.new_expenses
       when 'expense_restored' then p.new_expenses
       when 'comment'         then p.comments
       when 'settlement'      then p.settlements
       -- New in 0040.
       when 'settlement_undone' then p.settlements
       when 'group_added'     then p.group_adds
       when 'recurring'       then p.new_expenses
       when 'nudge'           then p.reminders
       else true
     end
     from public.notification_prefs p where p.profile_id = p_profile_id),
    true);
$$;

-- ---------------------------------------------------------------- reads

/*
 * Expense detail, carrying the byline and full edge breakdowns.
 *
 * ⚠️ **Two keys from 0039 are replaced, not added to.** `outstanding_to_me` and `settled_to_me`
 * were scoped to the caller because only the caller's edges could ever move. Marking now settles
 * every edge, including ones between two other people, so the client needs the whole graph to
 * compute its offline balance overlay — and a "to me" name on a field that is no longer about me
 * is exactly the kind of quiet lie that produced the 0035 regression.
 *
 *   marked_by     — {profile_id, display_name, avatar_url, at}, or null. The byline.
 *   outstanding   — every uncovered debt edge as {from, to, amount}. Non-empty is precisely the
 *                   condition `mark_expense_paid` enforces, so the button cannot offer an action
 *                   the server will refuse.
 *   settled       — every linked settlement in force, same shape. Drives undo and its overlay.
 *
 * Everything else is 0039's body verbatim.
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
    'paid_in_full_at', app.expense_paid_in_full_at(p_expense_id),
    -- New in 0040.
    'marked_by', app.expense_marked_by(p_expense_id),
    'outstanding', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_profile_id', c.from_profile_id,
               'to_profile_id',   c.to_profile_id,
               'amount_minor',    c.amount_minor - c.settled_minor)
             order by c.from_profile_id, c.to_profile_id)
      from app.expense_debt_coverage(p_expense_id) c
      where c.amount_minor > c.settled_minor
    ), '[]'::jsonb),
    /*
     * On a DELETED expense this reports the `voided_by_delete` rows instead, which are the ones
     * `restore_expense` will bring back. The client's offline overlay is computed at enqueue
     * time, so a restore has to know what returns to the ledger alongside the debts.
     *
     * It cannot be mistaken for a live settlement: `paid_in_full_at` is null for a deleted
     * expense, and the screen gates both the stamp and the undo on that.
     */
    'settled', coalesce((
      select jsonb_agg(jsonb_build_object(
               'from_profile_id', t.f,
               'to_profile_id',   t.t,
               'amount_minor',    t.amt)
             order by t.f, t.t)
      from (
        select s.from_profile_id as f, s.to_profile_id as t, sum(s.amount_minor) as amt
        from public.settlements s
        where s.expense_id = p_expense_id
          and s.deleted_at is null
          and (s.status in ('recorded','confirmed')
               or (v_expense.deleted_at is not null and s.status = 'voided_by_delete'))
        group by s.from_profile_id, s.to_profile_id
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
 * Group detail — the expense payload gains the byline, so a list row can name who closed it.
 *
 * A name and an id, not the whole `marked_by` object: the row renders "Marked paid by Sushrith"
 * and needs the id only to say "You" instead of reading your own name back at you.
 *
 * Everything else is 0039's body verbatim.
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
      'paid_in_full_at', app.expense_paid_in_full_at(ex.id),
      -- New in 0040.
      'marked_by', app.expense_marked_by(ex.id)
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
 * Person detail, gaining the same byline. `ExpenseRow` is shared between the two screens, so an
 * expense that names its marker on one and not the other would read as a bug.
 *
 * Everything else is 0039's body verbatim.
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
      'paid_in_full_at', app.expense_paid_in_full_at(ex.id),
      -- New in 0040.
      'marked_by', app.expense_marked_by(ex.id)
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

revoke all on function app.expense_marked_by(uuid) from public;

notify pgrst, 'reload schema';
