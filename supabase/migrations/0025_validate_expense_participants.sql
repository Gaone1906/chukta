-- Close a placeholder-takeover hole in the expense write path.
--
-- ---------------------------------------------------------------- the hole
--
-- `create_expense` (and `update_expense`) inserted whatever profile ids the payload named into
-- expense_payers / expense_splits / expense_participants with NO check that those ids belong to
-- anyone the caller knows. A one-off expense (no group_id) had no auth gate on its participants
-- at all — `assert_group_member` only runs when a group is supplied.
--
-- That is enough on its own to fabricate debts against a stranger. Worse, it is the first link
-- in a full account-takeover chain, reproduced end to end in supabase/tests/expenses.test.sql:
--
--   1. `upsert_contact_profile('x','email', <a known email>)` returns the *existing* profile id
--      for that email — an unthrottled email -> UUID oracle.
--   2. Name that id as a participant in a one-off expense. It inserts, unchecked.
--   3. That write creates a shared `expense_participants` row, so `shares_context_with(victim)`
--      is now TRUE — the attacker has manufactured "shared context" out of nothing.
--   4. `create_invite_link` gates on exactly that, so it now mints a token; `claim_placeholder`
--      redeems it; `merge_profiles` folds the victim's placeholder — and every debt recorded
--      against them — into the attacker's account. There is no un-merge anywhere in the schema.
--
-- `create_group` has validated its member list against `shares_context_with` since 0016. Its
-- sibling expense writes were missed. This migration applies the same rule to both, via one
-- shared assertion so the two paths cannot drift again.
--
-- No data change; only the two functions and one new helper are replaced.

-- ---------------------------------------------------------------- the shared gate

create or replace function auth_ext.assert_known_profiles(p_actor uuid, p_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- ------------------------------------------------------------ what is gated, and what is not
  --
  -- **Placeholders are gated; claimed accounts are not.** That asymmetry is the whole point, and
  -- it is not a compromise — it is where the takeover risk actually lives.
  --
  -- A placeholder can be absorbed: `merge_profiles` folds it, and every debt recorded against
  -- it, into whoever redeems a claim token. So naming a placeholder you neither created nor
  -- share any context with is the first move of an account takeover, and is refused here.
  --
  -- A claimed account cannot be absorbed at all — `merge_profiles` refuses any source with a
  -- `user_id` (0013:207), and `create_invite_link` refuses to mint a token for one (0020:46).
  -- There is no takeover to reach. And naming one is the *documented* product flow: you add a
  -- friend by email, `upsert_contact_profile` finds they are already on Hisaab and hands back
  -- THEIR real id, and you split with them straight away (AddPersonSheet.tsx:68-71). Gating that
  -- would break adding anyone who already has an account — the common case, not the edge.
  --
  -- The residual this deliberately leaves: someone who knows your email can still put you on a
  -- one-off expense you did not agree to. That is spam-shaped, not takeover-shaped — it is
  -- visible to you, and you can edit or delete it, because participants can edit. Closing it
  -- means an accept-before-you-are-added step, which is a product decision, not a patch.
  --
  -- The caller is excluded explicitly: `shares_context_with(self)` is false for a brand-new user
  -- writing their very first expense, and that write is legitimate.
  --
  -- An id naming no profile at all falls into the same refusal rather than its own error, so
  -- this cannot be used to probe which profile ids exist.
  perform 1
  from unnest(p_ids) as pid
  left join public.profiles pr on pr.id = pid
  where pid is not null
    and pid <> p_actor
    and (pr.id is null or (pr.user_id is null and not auth_ext.shares_context_with(pid)));

  if found then
    raise exception 'cannot include a profile you have no shared context with'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function auth_ext.assert_known_profiles(uuid, uuid[]) from public, anon;

-- ---------------------------------------------------------------- create_expense (from 0023, + the gate)

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
  v_made_group boolean := false;
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

  -- Validate everyone named in the payload BEFORE creating the group or inserting any row. If
  -- this ran after the group insert, the group_members rows we are about to write would
  -- themselves satisfy shares_context_with and the check would rubber-stamp its own inserts.
  perform auth_ext.assert_known_profiles(v_me, (
    select coalesce(array_agg(distinct pid), array[]::uuid[])
    from (
      select (e->>'profile_id')::uuid as pid from jsonb_array_elements(v_payers) as e
      union
      select (e->>'profile_id')::uuid      from jsonb_array_elements(v_splits) as e
      union
      select value::uuid                   from jsonb_array_elements_text(
        coalesce(v_new_group->'member_profile_ids','[]'::jsonb))
    ) ids
  ));

  -- Create the group inline when the user named one.
  if v_new_group is not null and v_new_group <> 'null'::jsonb then
    -- The group id comes from the client when it offered one. An expense written offline has
    -- to be able to name the group it belongs to before the server has ever seen either, and
    -- `create_group` has accepted a client id since 0016 — this is the same contract on the
    -- path people actually use.
    insert into public.groups (id, name, created_by_profile_id)
    values (
      coalesce(nullif(v_new_group->>'id','')::uuid, extensions.gen_random_uuid()),
      v_new_group->>'name',
      v_me
    )
    returning id into v_group_id;

    v_made_group := true;

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

  -- The group first: a member who is not on the expense gets no expense event, so this is the
  -- only thing that tells them the group exists.
  if v_made_group then
    perform internal.emit_change(
      array_append(v_members, v_me), v_me, v_group_id, 'group', v_group_id, 'insert'
    );
  end if;

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', v_expense_id, 'insert');

  v_result := jsonb_build_object('expense_id', v_expense_id, 'group_id', v_group_id, 'revision', 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

-- ---------------------------------------------------------------- update_expense (from 0012, + the gate)

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

  -- Same gate as create_expense: an edit that replaces the split set must not be able to smuggle
  -- in a profile the caller has no business naming. Existing participants re-supplied unchanged
  -- pass for free (they already share this very expense); only genuinely new ids are checked.
  perform auth_ext.assert_known_profiles(v_me, (
    select coalesce(array_agg(distinct pid), array[]::uuid[])
    from (
      select (e->>'profile_id')::uuid as pid
      from jsonb_array_elements(coalesce(p_payload->'payers','[]'::jsonb)) as e
      union
      select (e->>'profile_id')::uuid
      from jsonb_array_elements(coalesce(p_payload->'splits','[]'::jsonb)) as e
    ) ids
  ));

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

notify pgrst, 'reload schema';
