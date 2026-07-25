-- Editing and deleting expenses, with the optimistic concurrency the offline outbox needs.
--
-- Two people can edit the same expense while both are offline. Whoever reconnects first wins
-- normally; the second gets a typed conflict carrying the server's current snapshot, and the
-- client shows a field-by-field diff. There is NO auto-merge on money — silently picking a
-- winner is how someone ends up paying an amount nobody chose.

/*
 * Edit an expense.
 *
 * `expected_revision` is the revision the client was looking at. A mismatch raises P0409 with
 * the current snapshot in the error DETAIL, so the client can render the conflict without a
 * second round trip.
 */
create or replace function app.update_expense(
  p_expense_id         uuid,
  p_payload            jsonb,
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
  v_deleted      timestamptz;
  v_group_id     uuid;
  v_before       jsonb;
  v_after        jsonb;
  v_participants uuid[];
  v_result       jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'update_expense', p_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  select revision, deleted_at, group_id
    into v_current, v_deleted, v_group_id
  from public.expenses where id = p_expense_id
  for update;

  if not found then
    raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
  end if;

  -- A delete beats a concurrent edit. Restoring is an explicit choice, never implicit.
  if v_deleted is not null then
    raise exception 'expense % was deleted', p_expense_id
      using errcode = 'P0409', detail = jsonb_build_object('deleted', true)::text;
  end if;

  if v_current <> p_expected_revision then
    raise exception 'expense % changed while you were away (server revision %, you had %)',
      p_expense_id, v_current, p_expected_revision
      using errcode = 'P0409', detail = app.expense_snapshot(p_expense_id)::text;
  end if;

  v_before := app.expense_snapshot(p_expense_id);

  update public.expenses set
    description  = coalesce(p_payload->>'description', description),
    amount_minor = coalesce((p_payload->>'amount_minor')::bigint, amount_minor),
    split_type   = coalesce((p_payload->>'split_type')::public.split_type, split_type),
    spent_on     = coalesce((p_payload->>'spent_on')::date, spent_on),
    category     = coalesce(p_payload->>'category', category),
    revision     = revision + 1
  where id = p_expense_id;

  -- Payers and splits are replaced wholesale when supplied. Patching them field by field
  -- would let a partial update leave the sum invariant broken between statements.
  if p_payload ? 'payers' then
    delete from public.expense_payers where expense_id = p_expense_id;
    insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
    select p_expense_id, v_group_id, (e->>'profile_id')::uuid, (e->>'paid_amount_minor')::bigint
    from jsonb_array_elements(p_payload->'payers') as e;
  end if;

  if p_payload ? 'splits' then
    delete from public.expense_splits where expense_id = p_expense_id;
    insert into public.expense_splits (expense_id, group_id, profile_id, split_weight, share_amount_minor)
    select p_expense_id, v_group_id, (e->>'profile_id')::uuid,
           nullif(e->>'weight','')::numeric, (e->>'share_amount_minor')::bigint
    from jsonb_array_elements(p_payload->'splits') as e;
  end if;

  if p_payload ? 'payers' or p_payload ? 'splits' then
    delete from public.expense_participants where expense_id = p_expense_id;
    insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower)
    select p_expense_id, v_group_id, p.profile_id, bool_or(p.is_payer), bool_or(p.is_ower)
    from (
      select profile_id, true, false from public.expense_payers where expense_id = p_expense_id
      union all
      select profile_id, false, true from public.expense_splits where expense_id = p_expense_id
    ) p(profile_id, is_payer, is_ower)
    group by p.profile_id;
  end if;

  perform app.rebuild_expense_debts(p_expense_id);

  v_after := app.expense_snapshot(p_expense_id);

  insert into public.expense_revisions
    (expense_id, revision, action, actor_profile_id, snapshot, diff, client_mutation_id)
  values
    (p_expense_id, v_current + 1, 'updated', v_me, v_after,
     app.expense_diff(v_before, v_after), p_client_mutation_id);

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_participants
  from public.expense_participants where expense_id = p_expense_id;

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', p_expense_id, 'update');

  v_result := jsonb_build_object('expense_id', p_expense_id, 'revision', v_current + 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Field-level diff between two snapshots.
 *
 * Precomputed so the history list renders without loading and comparing two full snapshots,
 * and so the push pipeline can tell whether anyone's own share actually moved — a typo fix in
 * the description should notify nobody.
 */
create or replace function app.expense_diff(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'fields', coalesce((
      select jsonb_object_agg(key, jsonb_build_object('from', p_before->'expense'->key, 'to', p_after->'expense'->key))
      from jsonb_object_keys(p_after->'expense') as key
      where key not in ('revision','updated_at')
        and p_before->'expense'->key is distinct from p_after->'expense'->key
    ), '{}'::jsonb),
    -- Anyone whose own share moved. UNION dedupes identical (person, amount) pairs, so a
    -- person appears twice only if their amount actually changed. The GROUP BY has to be
    -- wrapped in its own subquery — aggregating alongside it returns one row per person,
    -- which is not something a scalar subquery can be.
    'shares_changed', coalesce((
      select jsonb_agg(profile_id order by profile_id)
      from (
        select profile_id
        from (
          select s->>'profile_id' as profile_id, s->>'share_amount_minor' as amount
          from jsonb_array_elements(p_before->'splits') s
          union
          select s->>'profile_id', s->>'share_amount_minor'
          from jsonb_array_elements(p_after->'splits') s
        ) t
        group by profile_id
        having count(*) > 1
      ) changed
    ), '[]'::jsonb)
  );
$$;

/*
 * Soft delete. The rows stay so history and the audit trail survive; the balanced-expense
 * trigger stops applying, and the balance views filter deleted expenses out.
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

  insert into public.expense_revisions
    (expense_id, revision, action, actor_profile_id, snapshot, client_mutation_id)
  values
    (p_expense_id, v_current + 1, 'deleted', v_me, app.expense_snapshot(p_expense_id), p_client_mutation_id);

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', p_expense_id, 'delete');

  v_result := jsonb_build_object('expense_id', p_expense_id, 'revision', v_current + 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

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

-- Comments are additive and carry no invariant, so they never conflict.
create or replace function app.add_comment(
  p_expense_id         uuid,
  p_body               text,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth_ext.assert_signed_in();
  v_cached     jsonb;
  v_id         uuid;
  v_group_id   uuid;
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'add_comment',
    jsonb_build_object('expense_id', p_expense_id, 'body', p_body));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_can_edit_expense(p_expense_id);

  select group_id into v_group_id from public.expenses where id = p_expense_id;

  insert into public.expense_comments (expense_id, group_id, author_profile_id, body)
  values (p_expense_id, v_group_id, v_me, p_body)
  returning id into v_id;

  -- Participants plus anyone who has already commented.
  select coalesce(array_agg(distinct profile_id), array[]::uuid[]) into v_recipients
  from (
    select profile_id from public.expense_participants where expense_id = p_expense_id
    union
    select author_profile_id from public.expense_comments where expense_id = p_expense_id and deleted_at is null
  ) t(profile_id);

  perform internal.emit_change(v_recipients, v_me, v_group_id, 'comment', v_id, 'insert',
                               jsonb_build_object('expense_id', p_expense_id));

  v_result := jsonb_build_object('comment_id', v_id);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

revoke all on function
  app.update_expense(uuid, jsonb, integer, uuid),
  app.delete_expense(uuid, integer, uuid),
  app.restore_expense(uuid, uuid),
  app.add_comment(uuid, text, uuid),
  app.expense_diff(jsonb, jsonb)
from public;

grant execute on function
  app.update_expense(uuid, jsonb, integer, uuid),
  app.delete_expense(uuid, integer, uuid),
  app.restore_expense(uuid, uuid),
  app.add_comment(uuid, text, uuid)
to authenticated;
