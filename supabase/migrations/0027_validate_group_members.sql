-- Close the last unguarded writer of `public.group_members`.
--
-- ---------------------------------------------------------------- 0025 was incomplete
--
-- 0025 fixed the placeholder-takeover chain by validating participant ids in `create_expense`
-- and `update_expense`. It missed `add_group_members`, which writes to `group_members` — the
-- OTHER table `auth_ext.shares_context_with` consults — with no check on who it is writing.
--
-- So the identical takeover still worked, with one substitution: instead of manufacturing
-- shared context via a one-off expense, manufacture it via a group you own.
--
--   1. `upsert_contact_profile('x','email', <a known address>)` returns the victim's existing
--      placeholder id — the unthrottled email -> UUID oracle, unchanged.
--   2. `create_group({name:'t'})` — you are the owner, so `assert_group_member` will pass.
--   3. `add_group_members(your_group, ARRAY[victim_placeholder])` — **inserted unchecked.**
--   4. `shares_context_with(victim)` is now true via the shared-group branch.
--   5. `create_invite_link` / `create_claim_code` pass their gate; `claim_placeholder` /
--      `redeem_claim_code` merge the victim into you. Irreversible, as ever.
--
-- Reproduced end to end against a local stack before this fix, and the damage confirmed by
-- reading the tables afterwards: the placeholder tombstoned onto the attacker, the victim's
-- expense splits repointed, and — worst of the three — the victim's `profile_contact_points`
-- row moved too, so when the real person finally signs up `internal.claim_or_create_profile`
-- can no longer match them and they get an empty account instead of their own history.
--
-- ---------------------------------------------------------------- the general lesson
--
-- `shares_context_with` is derived from `group_members` and `expense_participants`. Any RPC that
-- can write EITHER table with attacker-chosen ids can forge context. There were four such
-- writers; `create_group` was hardened in 0016, two more in 0025, and this is the fourth and
-- last. Adding a fifth without this check would reopen the whole class, which is why the guard
-- is a shared function rather than an inline predicate copied around.

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
  v_me         uuid := auth_ext.assert_signed_in();
  v_cached     jsonb;
  v_payload    jsonb := jsonb_build_object('group_id', p_group_id, 'profile_ids', to_jsonb(p_profile_ids));
  v_added      integer;
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'add_group_members', v_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  /*
   * BEFORE the insert, and the order is load-bearing.
   *
   * Run afterwards, the rows this statement is about to write would themselves satisfy
   * `shares_context_with`, and the check would cheerfully rubber-stamp its own inserts. Same
   * trap as `create_expense`'s — see the note in 0025 — and the reason both call the shared
   * assertion at the top rather than validating as they go.
   *
   * `assert_known_profiles` gates placeholders only: a claimed account cannot be merged
   * (`merge_profiles` refuses any source with a `user_id`), so there is no takeover to reach
   * through one, and gating it would break adding a friend who is already on Chukta.
   */
  perform auth_ext.assert_known_profiles(v_me, p_profile_ids);

  with ins as (
    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select p_group_id, m, 'member', v_me
    from unnest(p_profile_ids) as m
    on conflict (group_id, profile_id) do nothing
    returning profile_id
  )
  select count(*)::int into v_added from ins;

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members
  where group_id = p_group_id and left_at is null;

  perform internal.emit_change(
    v_recipients, v_me, p_group_id, 'group', p_group_id, 'update'
  );

  v_result := jsonb_build_object('group_id', p_group_id, 'added', v_added);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

notify pgrst, 'reload schema';
