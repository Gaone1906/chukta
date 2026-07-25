-- SECURITY DEFINER helpers for RLS.
--
-- THE RECURSION TRAP: a policy on group_members that asks "are you in this group?" has to
-- query group_members, and Postgres raises
--   infinite recursion detected in policy for relation "group_members"
-- It will happen on the first policy anyone writes.
--
-- These functions break it. Being SECURITY DEFINER and owned by a role that bypasses RLS, they
-- read the table directly, so the policy never re-enters itself.
--
-- Every one of them:
--   * is STABLE, so the planner can hoist it out of a per-row loop
--   * sets search_path = '' so nothing can be shadowed by a caller-controlled schema
--   * is revoked from PUBLIC and granted only to authenticated

create or replace function auth_ext.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.deleted_at is null
  limit 1;
$$;

-- Follows the merge tombstone chain to the surviving profile, so a stale offline client
-- holding a pre-merge id still resolves correctly. Bounded in case of a cycle.
create or replace function auth_ext.resolve_profile_id(p_profile_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id   uuid := p_profile_id;
  v_next uuid;
  v_hops integer := 0;
begin
  loop
    select merged_into_profile_id into v_next from public.profiles where id = v_id;
    exit when v_next is null;
    v_id := v_next;
    v_hops := v_hops + 1;
    if v_hops > 10 then
      raise exception 'resolve_profile_id: merge chain too long from %', p_profile_id;
    end if;
  end loop;
  return v_id;
end;
$$;

-- THE recursion breaker. Policies say `group_id in (select auth_ext.my_group_ids())`.
--
-- Returns a SET rather than an array on purpose: `in (select ...)` is an uncorrelated
-- subquery, which the planner turns into an InitPlan evaluated once per statement. An array
-- form (`= any (fn())`) risks being re-evaluated per row, which is the whole thing we are
-- trying to avoid.
create or replace function auth_ext.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gm.group_id
  from public.group_members gm
  where gm.profile_id = auth_ext.current_profile_id()
    and gm.left_at is null;
$$;

create or replace function auth_ext.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.profile_id = auth_ext.current_profile_id()
      and gm.left_at is null
  );
$$;

-- Covers group-less one-off expenses too, which is exactly why expense_participants exists.
create or replace function auth_ext.can_read_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    left join public.expense_participants ep
      on ep.expense_id = e.id
     and ep.profile_id = auth_ext.current_profile_id()
    where e.id = p_expense_id
      and (
        (e.group_id is not null and auth_ext.is_group_member(e.group_id))
        or ep.profile_id is not null
      )
  );
$$;

-- Whether another profile is visible to the caller: a shared group, a shared expense, or
-- someone the caller invited themselves.
create or replace function auth_ext.shares_context_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.profile_id = auth_ext.current_profile_id()
      and mine.left_at is null
      and theirs.profile_id = p_profile_id
      and theirs.left_at is null
  )
  or exists (
    select 1
    from public.expense_participants mine
    join public.expense_participants theirs on theirs.expense_id = mine.expense_id
    where mine.profile_id = auth_ext.current_profile_id()
      and theirs.profile_id = p_profile_id
  )
  or exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.created_by_profile_id = auth_ext.current_profile_id()
  );
$$;

-- Assertions used at the top of every write RPC. They raise rather than return false, so a
-- missing check is a loud failure instead of a silent authorisation hole.
create or replace function auth_ext.assert_signed_in()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := auth_ext.current_profile_id();
begin
  if v_profile is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return v_profile;
end;
$$;

create or replace function auth_ext.assert_group_member(p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_group_id is not null and not auth_ext.is_group_member(p_group_id) then
    raise exception 'not a member of group %', p_group_id using errcode = '42501';
  end if;
end;
$$;

create or replace function auth_ext.assert_can_edit_expense(p_expense_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not auth_ext.can_read_expense(p_expense_id) then
    raise exception 'cannot edit expense %', p_expense_id using errcode = '42501';
  end if;
end;
$$;

-- These are policy internals, not an API surface.
revoke all on function
  auth_ext.current_profile_id(),
  auth_ext.resolve_profile_id(uuid),
  auth_ext.my_group_ids(),
  auth_ext.is_group_member(uuid),
  auth_ext.can_read_expense(uuid),
  auth_ext.shares_context_with(uuid),
  auth_ext.assert_signed_in(),
  auth_ext.assert_group_member(uuid),
  auth_ext.assert_can_edit_expense(uuid)
from public;

grant usage on schema auth_ext to authenticated;

grant execute on function
  auth_ext.current_profile_id(),
  auth_ext.resolve_profile_id(uuid),
  auth_ext.my_group_ids(),
  auth_ext.is_group_member(uuid),
  auth_ext.can_read_expense(uuid),
  auth_ext.shares_context_with(uuid)
to authenticated;
