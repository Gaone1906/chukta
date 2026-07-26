-- Managing a group after it exists.
--
-- `create_group` and `add_group_members` were the entire membership surface, so once a group was
-- made you could never rename it, never leave it, and never take out somebody added by mistake.
-- The tables have carried `groups.name`, `group_members.left_at` and `groups.archived_at` since
-- 0003; nothing ever wrote them.
--
-- ---------------------------------------------------------------- the rule that shapes all three
--
-- **You cannot leave, or be removed from, a group where your balance is not zero.**
--
-- Membership is what makes a group's balances visible and settleable. Dropping out mid-debt does
-- not cancel the debt — the expense rows are still there and `app.v_pair_ledger` still counts
-- them — it just removes the person from the roster that displays and settles it. The money
-- silently stops being anybody's problem while remaining somebody's money.
--
-- Refusing is the honest alternative, and it is cheap to check: `app.v_group_balances` already
-- ends in `having sum(net) <> 0`, so a settled member simply has no row. "Are they square?" is
-- `not exists`, not a comparison.
--
-- ---------------------------------------------------------------- who may do what, and why
--
-- **Renaming: any member.** This app has no hierarchy anywhere else — any member can add an
-- expense, add people, settle up — and inventing one for a text field would be inconsistent
-- with all of it. These are groups between friends.
--
-- **Removing somebody else: the owner only.** That is a genuinely different act from renaming:
-- it changes another person's access rather than a label, so it takes the one role the schema
-- already has. Leaving yourself needs no role at all.

-- ---------------------------------------------------------------- rename

create or replace function app.rename_group(
  p_group_id           uuid,
  p_name               text,
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
  v_name       text := btrim(p_name);
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'rename_group',
    jsonb_build_object('group_id', p_group_id, 'name', v_name));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  -- Checked here as well as by the CHECK constraint: a constraint violation reaches the client
  -- as a raw 23514 with no useful message, and "name it something" is a decision the user can
  -- act on rather than a bug.
  if v_name is null or length(v_name) = 0 or length(v_name) > 60 then
    raise exception 'a group name must be between 1 and 60 characters'
      using errcode = 'P0001';
  end if;

  update public.groups set name = v_name
   where id = p_group_id and deleted_at is null;

  if not found then
    raise exception 'group % does not exist', p_group_id using errcode = 'P0002';
  end if;

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members where group_id = p_group_id and left_at is null;

  perform internal.emit_change(v_recipients, v_me, p_group_id, 'group', p_group_id, 'update');

  v_result := jsonb_build_object('group_id', p_group_id, 'name', v_name);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

-- ---------------------------------------------------------------- leave

/*
 * Leave a group.
 *
 * The last member out also archives the group. Without that it would sit in the database with
 * nobody in it — invisible to every user, since every read is scoped by membership, but not
 * actually closed. Archiving says what happened, and `get_home_summary` already filters on
 * `archived_at is null`, so it disappears from where it should.
 */
create or replace function app.leave_group(
  p_group_id           uuid,
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
  v_remaining  int;
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'leave_group', jsonb_build_object('group_id', p_group_id));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  if exists (
    select 1 from app.v_group_balances b
     where b.group_id = p_group_id and b.profile_id = v_me
  ) then
    raise exception 'settle up before leaving — your balance in this group is not zero'
      using errcode = 'P0001';
  end if;

  -- Recipients are collected BEFORE the update: afterwards this member no longer satisfies
  -- `left_at is null`, and they are precisely the person who needs to know it worked.
  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members where group_id = p_group_id and left_at is null;

  update public.group_members set left_at = now()
   where group_id = p_group_id and profile_id = v_me and left_at is null;

  select count(*) into v_remaining
  from public.group_members where group_id = p_group_id and left_at is null;

  if v_remaining = 0 then
    update public.groups set archived_at = now()
     where id = p_group_id and archived_at is null;
  end if;

  perform internal.emit_change(v_recipients, v_me, p_group_id, 'group', p_group_id, 'update');

  v_result := jsonb_build_object(
    'group_id', p_group_id, 'left', true, 'archived', v_remaining = 0);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

-- ---------------------------------------------------------------- remove somebody else

create or replace function app.remove_group_member(
  p_group_id           uuid,
  p_profile_id         uuid,
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
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(
    p_client_mutation_id, v_me, 'remove_group_member',
    jsonb_build_object('group_id', p_group_id, 'profile_id', p_profile_id));
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  -- Removing yourself is `leave_group`, which has different rules (no role needed) and an extra
  -- job (archiving an emptied group). Routing it here would skip both.
  if p_profile_id = v_me then
    raise exception 'use leave_group to remove yourself' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.group_members
     where group_id = p_group_id and profile_id = v_me and role = 'owner' and left_at is null
  ) then
    raise exception 'only the group owner can remove somebody' using errcode = '42501';
  end if;

  if exists (
    select 1 from app.v_group_balances b
     where b.group_id = p_group_id and b.profile_id = p_profile_id
  ) then
    raise exception 'that person has a balance in this group — settle up first'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members where group_id = p_group_id and left_at is null;

  update public.group_members set left_at = now()
   where group_id = p_group_id and profile_id = p_profile_id and left_at is null;

  if not found then
    raise exception 'that person is not in this group' using errcode = 'P0002';
  end if;

  perform internal.emit_change(v_recipients, v_me, p_group_id, 'group', p_group_id, 'update');

  v_result := jsonb_build_object('group_id', p_group_id, 'removed', p_profile_id);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

-- ---------------------------------------------------------------- the callable surface

create or replace function public.rename_group(
  p_group_id uuid, p_name text, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.rename_group(p_group_id, p_name, p_client_mutation_id);
$$;

create or replace function public.leave_group(p_group_id uuid, p_client_mutation_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.leave_group(p_group_id, p_client_mutation_id);
$$;

create or replace function public.remove_group_member(
  p_group_id uuid, p_profile_id uuid, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.remove_group_member(p_group_id, p_profile_id, p_client_mutation_id);
$$;

-- Both revokes are needed, not one. `alter default privileges` (0019) drops Supabase's explicit
-- grant to anon, but Postgres also grants EXECUTE to PUBLIC on every new function, and anon is a
-- member of PUBLIC. The guardrail test asserts on "what anon can reach", which is what catches
-- this if it is ever forgotten.
revoke all on function
  app.rename_group(uuid, text, uuid),
  app.leave_group(uuid, uuid),
  app.remove_group_member(uuid, uuid, uuid),
  public.rename_group(uuid, text, uuid),
  public.leave_group(uuid, uuid),
  public.remove_group_member(uuid, uuid, uuid)
from public, anon;

grant execute on function
  app.rename_group(uuid, text, uuid),
  app.leave_group(uuid, uuid),
  app.remove_group_member(uuid, uuid, uuid),
  public.rename_group(uuid, text, uuid),
  public.leave_group(uuid, uuid),
  public.remove_group_member(uuid, uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
