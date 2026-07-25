-- Group mutations.
--
-- Until now a group could only come into existence as a side effect of `create_expense`'s
-- `new_group` — which covers the main path in the design (naming the group field promotes a
-- participant set into a group) but not the "+ New group" escape hatch in the picker, where
-- the user makes the group first and adds expenses later.
--
-- Same discipline as every other write RPC: SECURITY DEFINER, pinned search_path, an
-- authorisation assert on the first line, and idempotent on the client mutation id.

create or replace function app.create_group(
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
  v_group_id uuid := coalesce(nullif(p_payload->>'id','')::uuid, extensions.gen_random_uuid());
  v_name     text := btrim(coalesce(p_payload->>'name',''));
  v_members  uuid[];
  v_result   jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'create_group', p_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  if v_name = '' then
    raise exception 'a group needs a name' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct value::uuid), array[]::uuid[]) into v_members
  from jsonb_array_elements_text(coalesce(p_payload->'member_profile_ids','[]'::jsonb));

  -- Only people the caller already shares a context with, or a placeholder profile they just
  -- created themselves. Otherwise "add member" doubles as a probe for whether an arbitrary
  -- profile id exists.
  perform 1
  from unnest(v_members) as m
  where m <> v_me
    and not auth_ext.shares_context_with(m)
    and not exists (
      select 1 from public.profiles pr
      where pr.id = m and pr.user_id is null and pr.created_by_profile_id = v_me
    );

  if found then
    raise exception 'cannot add a profile you have no shared context with' using errcode = '42501';
  end if;

  insert into public.groups (id, name, created_by_profile_id)
  values (v_group_id, v_name, v_me);

  insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
  select v_group_id, m, case when m = v_me then 'owner' else 'member' end, v_me
  from unnest(array_append(v_members, v_me)) as m
  on conflict (group_id, profile_id) do nothing;

  perform internal.emit_change(
    array_append(v_members, v_me), v_me, v_group_id, 'group', v_group_id, 'insert'
  );

  v_result := jsonb_build_object('group_id', v_group_id, 'name', v_name);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Add people to a group that already exists.
 *
 * Separate from create_group because the picker needs both: make a group now, and top it up
 * later when a fourth person joins the trip.
 */
create or replace function app.add_group_members(
  p_group_id           uuid,
  p_profile_ids        uuid[],
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth_ext.assert_signed_in();
  v_cached  jsonb;
  v_payload jsonb := jsonb_build_object('group_id', p_group_id, 'profile_ids', to_jsonb(p_profile_ids));
  v_added   integer;
  v_result  jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'add_group_members', v_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  with ins as (
    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select p_group_id, m, 'member', v_me
    from unnest(p_profile_ids) as m
    on conflict (group_id, profile_id) do nothing
    returning profile_id
  )
  select count(*)::int into v_added from ins;

  perform internal.emit_change(
    p_profile_ids, v_me, p_group_id, 'group', p_group_id, 'update'
  );

  v_result := jsonb_build_object('group_id', p_group_id, 'added', v_added);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

revoke all on function
  app.create_group(jsonb, uuid),
  app.add_group_members(uuid, uuid[], uuid)
from public;

grant execute on function
  app.create_group(jsonb, uuid),
  app.add_group_members(uuid, uuid[], uuid)
to authenticated;
