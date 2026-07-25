-- The write surface.
--
-- Every one of these is SECURITY DEFINER (the tables grant clients no write privileges at all)
-- and therefore MUST open with an authorisation assert and set search_path = ''. That
-- discipline is the price of the design; supabase/tests/rls.test.sql enforces it by inspecting
-- every function body.

-- Shared idempotency gate. Returns the stored result when this mutation has already been
-- applied, so an outbox retry after a lost response is a no-op rather than a duplicate.
create or replace function internal.claim_mutation(
  p_client_mutation_id uuid,
  p_profile_id         uuid,
  p_op                 text,
  p_request            jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_hash     bytea := extensions.digest(p_request::text, 'sha256');
  v_existing internal.mutation_log%rowtype;
begin
  insert into internal.mutation_log (client_mutation_id, profile_id, op, request_sha256, result)
  values (p_client_mutation_id, p_profile_id, p_op, v_hash, '{}'::jsonb)
  on conflict (client_mutation_id) do nothing;

  if found then
    return null;  -- fresh; the caller should do the work
  end if;

  select * into v_existing from internal.mutation_log where client_mutation_id = p_client_mutation_id;

  -- Same key, different payload means a client bug or a forged retry — never something to
  -- silently accept.
  if v_existing.request_sha256 <> v_hash then
    raise exception 'mutation % replayed with a different payload', p_client_mutation_id
      using errcode = '22023';
  end if;

  return v_existing.result;
end;
$$;

create or replace function internal.finish_mutation(p_client_mutation_id uuid, p_result jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  update internal.mutation_log set result = p_result where client_mutation_id = p_client_mutation_id
  returning result;
$$;

-- Fan out one change to everyone who should see it, inside the same transaction as the data.
create or replace function internal.emit_change(
  p_recipients  uuid[],
  p_actor       uuid,
  p_group_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_op          text,
  p_payload     jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into internal.change_events
    (recipient_profile_id, actor_profile_id, group_id, entity_type, entity_id, op, payload)
  select r, p_actor, p_group_id, p_entity_type, p_entity_id, p_op, p_payload
  from unnest(p_recipients) as r
  -- Never notify the actor about their own action.
  where r is distinct from p_actor;
$$;

/*
 * Create an expense.
 *
 * Six tables, one transaction, one idempotency key. From the client this would be eight round
 * trips with no transaction and a torn write on every dropped connection — which is the whole
 * reason the write path is RPCs rather than PostgREST CRUD.
 *
 * `new_group` folds group creation into the same call, matching the design: naming the group
 * field promotes the participant set into a group, leaving it blank keeps the expense a
 * one-off. There is deliberately no separate "create group" step on that path.
 */
create or replace function app.create_expense(
  p_payload            jsonb,
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
  v_expense_id uuid := coalesce((p_payload->>'id')::uuid, extensions.gen_random_uuid());
  v_group_id   uuid := nullif(p_payload->>'group_id','')::uuid;
  v_amount     bigint := (p_payload->>'amount_minor')::bigint;
  v_split_type public.split_type := (p_payload->>'split_type')::public.split_type;
  v_new_group  jsonb := p_payload->'new_group';
  v_members    uuid[];
  v_payers     jsonb := coalesce(p_payload->'payers', '[]'::jsonb);
  v_splits     jsonb := coalesce(p_payload->'splits', '[]'::jsonb);
  v_participants uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'create_expense', p_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'amount_minor must be positive' using errcode = '22023';
  end if;

  -- Create the group inline when the user named one.
  if v_new_group is not null and v_new_group <> 'null'::jsonb then
    insert into public.groups (name, created_by_profile_id)
    values (v_new_group->>'name', v_me)
    returning id into v_group_id;

    select coalesce(array_agg(distinct value::uuid), array[]::uuid[]) into v_members
    from jsonb_array_elements_text(coalesce(v_new_group->'member_profile_ids','[]'::jsonb));

    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select v_group_id, m, case when m = v_me then 'owner' else 'member' end, v_me
    from unnest(array_append(v_members, v_me)) as m
    on conflict (group_id, profile_id) do nothing;
  elsif v_group_id is not null then
    perform auth_ext.assert_group_member(v_group_id);
  end if;

  insert into public.expenses (
    id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id
  )
  values (
    v_expense_id,
    v_group_id,
    p_payload->>'description',
    v_amount,
    v_split_type,
    coalesce((p_payload->>'spent_on')::date, current_date)
  , v_me);

  insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
  select v_expense_id, v_group_id, (e->>'profile_id')::uuid, (e->>'paid_amount_minor')::bigint
  from jsonb_array_elements(v_payers) as e;

  insert into public.expense_splits (expense_id, group_id, profile_id, split_weight, share_amount_minor)
  select v_expense_id, v_group_id, (e->>'profile_id')::uuid,
         nullif(e->>'weight','')::numeric, (e->>'share_amount_minor')::bigint
  from jsonb_array_elements(v_splits) as e;

  -- Derived tables, written here rather than by a trigger so everything lands in one
  -- transaction the balanced-expense constraint can check at commit.
  insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower)
  select v_expense_id, v_group_id, p.profile_id,
         bool_or(p.is_payer), bool_or(p.is_ower)
  from (
    select (e->>'profile_id')::uuid as profile_id, true as is_payer, false as is_ower
    from jsonb_array_elements(v_payers) as e
    union all
    select (e->>'profile_id')::uuid, false, true
    from jsonb_array_elements(v_splits) as e
  ) p
  group by p.profile_id;

  perform app.rebuild_expense_debts(v_expense_id);

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_participants
  from public.expense_participants where expense_id = v_expense_id;

  insert into public.expense_revisions (expense_id, revision, action, actor_profile_id, snapshot, client_mutation_id)
  values (v_expense_id, 1, 'created', v_me, app.expense_snapshot(v_expense_id), p_client_mutation_id);

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', v_expense_id, 'insert');

  v_result := jsonb_build_object('expense_id', v_expense_id, 'group_id', v_group_id, 'revision', 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Recompute the pairwise debts for one expense.
 *
 * Nets each person first (paid − owed), so a payer who also owes never produces a self-edge,
 * then spreads each debtor's residual across the creditors in proportion to theirs — through
 * the same allocator, so the edges sum exactly to the netted total.
 */
create or replace function app.rebuild_expense_debts(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id   uuid;
  v_creditors  uuid[];
  v_weights    numeric[];
  v_keys       text[];
  v_debtor     record;
  v_portions   bigint[];
  i            integer;
begin
  select group_id into v_group_id from public.expenses where id = p_expense_id;

  delete from public.expense_debts where expense_id = p_expense_id;

  -- Creditor ids, their weights and their allocator keys come out of ONE aggregate with one
  -- ORDER BY, so the three arrays are guaranteed to line up positionally. Building the keys
  -- separately would risk uuid ordering and text ordering disagreeing.
  select coalesce(array_agg(profile_id order by profile_id), array[]::uuid[]),
         coalesce(array_agg(net order by profile_id), array[]::numeric[]),
         coalesce(array_agg(profile_id::text order by profile_id), array[]::text[])
    into v_creditors, v_weights, v_keys
  from (
    select profile_id, sum(net) as net
    from (
      select profile_id, paid_amount_minor as net
      from public.expense_payers where expense_id = p_expense_id
      union all
      select profile_id, -share_amount_minor
      from public.expense_splits where expense_id = p_expense_id
    ) t
    group by profile_id
    having sum(net) > 0
  ) creditors;

  if array_length(v_creditors, 1) is null then
    return;   -- everyone paid exactly their share
  end if;

  for v_debtor in
    select profile_id, -sum(net) as owed
    from (
      select profile_id, paid_amount_minor as net
      from public.expense_payers where expense_id = p_expense_id
      union all
      select profile_id, -share_amount_minor
      from public.expense_splits where expense_id = p_expense_id
    ) t
    group by profile_id
    having sum(net) < 0
    order by profile_id
  loop
    -- sum() over bigint returns numeric, so the cast is required to match the signature.
    v_portions := app.allocate_minor(v_debtor.owed::bigint, v_weights, v_keys);

    for i in 1 .. array_length(v_creditors, 1) loop
      if v_portions[i] > 0 then
        insert into public.expense_debts (expense_id, group_id, from_profile_id, to_profile_id, amount_minor)
        values (p_expense_id, v_group_id, v_debtor.profile_id, v_creditors[i], v_portions[i]);
      end if;
    end loop;
  end loop;
end;
$$;

-- The full expense document, used for revision snapshots and the offline conflict diff.
create or replace function app.expense_snapshot(p_expense_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'expense', to_jsonb(e),
    'payers', coalesce((select jsonb_agg(to_jsonb(p)) from public.expense_payers p where p.expense_id = e.id), '[]'::jsonb),
    'splits', coalesce((select jsonb_agg(to_jsonb(s)) from public.expense_splits s where s.expense_id = e.id), '[]'::jsonb),
    'items',  coalesce((select jsonb_agg(to_jsonb(i)) from public.expense_items i where i.expense_id = e.id), '[]'::jsonb)
  )
  from public.expenses e where e.id = p_expense_id;
$$;

/*
 * Record a settlement. Self-reported: nothing here is verified against a bank.
 */
create or replace function app.record_settlement(
  p_payload            jsonb,
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
  v_id       uuid := coalesce((p_payload->>'id')::uuid, extensions.gen_random_uuid());
  v_group_id uuid := nullif(p_payload->>'group_id','')::uuid;
  v_from     uuid := (p_payload->>'from_profile_id')::uuid;
  v_to       uuid := (p_payload->>'to_profile_id')::uuid;
  v_result   jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'record_settlement', p_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  if v_me not in (v_from, v_to) then
    raise exception 'can only record a settlement you are part of' using errcode = '42501';
  end if;

  perform auth_ext.assert_group_member(v_group_id);

  insert into public.settlements (
    id, group_id, from_profile_id, to_profile_id, amount_minor, method, note, settled_on,
    recorded_by_profile_id
  )
  values (
    v_id, v_group_id, v_from, v_to,
    (p_payload->>'amount_minor')::bigint,
    coalesce((p_payload->>'method')::public.settlement_method, 'upi'),
    p_payload->>'note',
    coalesce((p_payload->>'settled_on')::date, current_date),
    v_me
  );

  perform internal.emit_change(array[v_from, v_to], v_me, v_group_id, 'settlement', v_id, 'insert');

  v_result := jsonb_build_object('settlement_id', v_id);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Create a placeholder profile for someone who has not signed up.
 *
 * Deduplicates on the live contact point, so two friends inviting the same person converge on
 * one identity instead of creating a merge problem for later.
 */
create or replace function app.upsert_contact_profile(
  p_display_name text,
  p_kind         public.contact_kind default null,
  p_value_norm   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth_ext.assert_signed_in();
  v_profile uuid;
begin
  if p_value_norm is not null and p_kind is not null then
    select profile_id into v_profile
    from public.profile_contact_points
    where kind = p_kind and value_norm = p_value_norm and retired_at is null
    limit 1;

    if v_profile is not null then
      return auth_ext.resolve_profile_id(v_profile);
    end if;
  end if;

  insert into public.profiles (display_name, created_by_profile_id)
  values (p_display_name, v_me)
  returning id into v_profile;

  if p_value_norm is not null and p_kind is not null then
    insert into public.profile_contact_points (profile_id, kind, value_norm, source)
    values (v_profile, p_kind, p_value_norm, 'invite');
  end if;

  return v_profile;
end;
$$;

revoke all on function
  app.create_expense(jsonb, uuid),
  app.record_settlement(jsonb, uuid),
  app.upsert_contact_profile(text, public.contact_kind, text),
  app.rebuild_expense_debts(uuid),
  app.expense_snapshot(uuid)
from public;

grant execute on function
  app.create_expense(jsonb, uuid),
  app.record_settlement(jsonb, uuid),
  app.upsert_contact_profile(text, public.contact_kind, text)
to authenticated;
