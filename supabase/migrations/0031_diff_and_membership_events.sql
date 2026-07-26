-- Two defects an adversarial review of Phase 9 found in code Phase 9 depends on.
--
-- Both are the same shape: something that was correct for SYNC turns out to be wrong once a
-- notification reads it, because sync only needs "something about this changed" while a
-- notification needs "WHAT changed, and does it concern you".

-- ---------------------------------------------------------------- 1. shares_changed misses
--                                                                     people added and removed
/*
 * `app.expense_diff` computed the affected people as:
 *
 *     select profile_id from (before-splits UNION after-splits) group by profile_id
 *     having count(*) > 1
 *
 * `union` dedupes identical `(person, amount)` pairs, so somebody whose amount changed appears
 * twice and is caught. But somebody who was ADDED to the expense appears only in `after`, and
 * somebody REMOVED appears only in `before` — one row each, `count(*) = 1`, filtered out.
 *
 * **So the two people whose share moved the most — from nothing to something, or from something
 * to nothing — were the two the diff said were unaffected.** Harmless while nothing read it;
 * 0028 made it the rule that decides who gets told their money moved, at which point being
 * added to a bill silently is the exact failure the feature exists to prevent.
 *
 * A full outer join says what was meant: anyone whose amount differs on either side, including
 * where one side is absent.
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

    'shares_changed', coalesce((
      select jsonb_agg(profile_id order by profile_id)
      from (
        select coalesce(b.profile_id, a.profile_id) as profile_id
        from (
          select s->>'profile_id' as profile_id, s->>'share_amount_minor' as amount
          from jsonb_array_elements(p_before->'splits') s
        ) b
        full outer join (
          select s->>'profile_id' as profile_id, s->>'share_amount_minor' as amount
          from jsonb_array_elements(p_after->'splits') s
        ) a on a.profile_id = b.profile_id
        -- `is distinct from` rather than `<>`, so a NULL on either side — which is exactly what
        -- "was not on this expense" looks like — counts as a change instead of as unknown.
        where b.amount is distinct from a.amount
      ) changed
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------- 2. nobody is ever told they
--                                                                     were added to a group
/*
 * `app.add_group_members` emitted a single `group`/`update` event to the whole post-insert
 * membership — right for sync, since everyone's member list did change. But 0028 maps only
 * `group`/`insert` to `group_added`, so the people who were just added got the same "something
 * about this group changed" event as everybody else, and the one notification that would have
 * told them the group exists was never generated.
 *
 * Fixed by splitting the emit rather than by widening the notification mapping: `insert` and
 * `update` genuinely mean different things here, and making `update` sometimes mean "you were
 * added" would push a notification concern back into the sync spine — the mistake 0023 exists
 * to undo.
 *
 * Everything else is 0027's body verbatim, including the `assert_known_profiles` gate that
 * closed the placeholder-takeover chain.
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
  v_me         uuid := auth_ext.assert_signed_in();
  v_cached     jsonb;
  v_payload    jsonb := jsonb_build_object('group_id', p_group_id, 'profile_ids', to_jsonb(p_profile_ids));
  v_added      uuid[];
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'add_group_members', v_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  -- BEFORE the insert: afterwards these very rows would satisfy shares_context_with. See 0027.
  perform auth_ext.assert_known_profiles(v_me, p_profile_ids);

  with ins as (
    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select p_group_id, m, 'member', v_me
    from unnest(p_profile_ids) as m
    on conflict (group_id, profile_id) do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_added from ins;

  -- The people who genuinely joined just now. `insert` is what "you are in this group" means,
  -- and it is what the notification layer reads.
  if array_length(v_added, 1) > 0 then
    perform internal.emit_change(v_added, v_me, p_group_id, 'group', p_group_id, 'insert');
  end if;

  -- Everyone who was already here: their member list grew, which is a sync fact and not
  -- something worth a push. Deliberately excludes the people above so nobody gets both.
  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members
  where group_id = p_group_id and left_at is null
    and not (profile_id = any(v_added));

  if array_length(v_recipients, 1) > 0 then
    perform internal.emit_change(v_recipients, v_me, p_group_id, 'group', p_group_id, 'update');
  end if;

  v_result := jsonb_build_object('group_id', p_group_id, 'added', coalesce(array_length(v_added, 1), 0));
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

notify pgrst, 'reload schema';
