-- People you have added but not yet split anything with.
--
-- `get_home_summary` returned exactly two kinds of person: someone you share a group with, and
-- someone you share an expense with. Both require history. So the moment you named a new
-- friend, they existed in the database and were **invisible to the whole app** — the picker
-- listed them until you left the screen, then they were gone, and the expense form fell back to
-- "Someone" because it resolves names out of this summary.
--
-- Which made the sequence the app is actually *for* impossible: name a friend, then start
-- putting expenses on them. You could only add someone in the middle of creating an expense,
-- and only if you got it right the first time.
--
-- The rule added below is narrow on purpose. Not "any profile you can see" — only the
-- placeholders **you created** that nobody has claimed. You made the row, so it discloses
-- nothing you did not already know, and it stops being special the instant they sign up,
-- because from then on the ordinary expense and group rules apply.
create or replace function app.get_home_summary()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me     uuid := auth_ext.assert_signed_in();
  v_groups jsonb;
  v_people jsonb;
begin
  select coalesce(jsonb_agg(g order by g->>'name'), '[]'::jsonb) into v_groups
  from (
    select jsonb_build_object(
      'id', gr.id,
      'name', gr.name,
      'member_count', (select count(*) from public.group_members m
                        where m.group_id = gr.id and m.left_at is null),
      -- Positive means they are owed. Null means fully settled.
      'net_minor', coalesce((select b.net_minor from app.v_group_balances b
                              where b.group_id = gr.id and b.profile_id = v_me), 0),
      'currency', gr.currency
    ) as g
    from public.groups gr
    where gr.id in (select auth_ext.my_group_ids())
      and gr.deleted_at is null
      and gr.archived_at is null
  ) t;

  -- People: everyone the caller has a non-zero balance with, anyone they share a group with so
  -- a settled friend still appears rather than vanishing, and anyone they have added but not
  -- yet split anything with.
  select coalesce(jsonb_agg(p order by p->>'display_name'), '[]'::jsonb) into v_people
  from (
    select jsonb_build_object(
      'id', pr.id,
      'display_name', pr.display_name,
      'avatar_url', pr.avatar_url,
      'is_placeholder', pr.user_id is null,
      'shared_group_count', (
        select count(*) from public.group_members a
        join public.group_members b on b.group_id = a.group_id and b.profile_id = pr.id and b.left_at is null
        where a.profile_id = v_me and a.left_at is null
      ),
      'net_minor', coalesce((
        select case when pb.lo = v_me then -pb.net_minor else pb.net_minor end
        from app.v_pair_balances pb
        where (pb.lo = least(v_me, pr.id) and pb.hi = greatest(v_me, pr.id))
      ), 0)
    ) as p
    from public.profiles pr
    where pr.id <> v_me
      and pr.merged_into_profile_id is null
      and pr.deleted_at is null
      and (
        exists (
          select 1 from public.group_members a
          join public.group_members b on b.group_id = a.group_id and b.profile_id = pr.id and b.left_at is null
          where a.profile_id = v_me and a.left_at is null
        )
        or exists (
          select 1 from public.expense_participants a
          join public.expense_participants b on b.expense_id = a.expense_id and b.profile_id = pr.id
          where a.profile_id = v_me
        )
        -- New: a placeholder the caller created themselves, with no shared history yet.
        or (pr.created_by_profile_id = v_me and pr.user_id is null)
      )
  ) t;

  return jsonb_build_object('profile_id', v_me, 'groups', v_groups, 'people', v_people);
end;
$$;
