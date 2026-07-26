-- `get_group_detail` never returned a member's role, so the client could not tell who owns a
-- group. That did not matter until 0034 made removal owner-only: without it the group settings
-- screen either hides removal from everybody, or offers a button that raises 42501 for most
-- people who press it. Offering an action that is going to be refused is worse than not
-- offering it, so the read has to carry the fact the write is going to check.
--
-- Everything else in this function is 0014's body verbatim.
--
-- ⚠️ **`p_before` is `date`, matching 0014 exactly.** The first version of this file typed it
-- `timestamptz`, which is a DIFFERENT SIGNATURE — so `create or replace` did not replace
-- anything, it added a second overload. Postgres then refused every call with "function
-- app.get_group_detail(unknown) is not unique", and PostgREST resolved to whichever it liked.
-- Changing a parameter type in a `create or replace` is an ADD, never an edit; the drop below
-- is what makes this file idempotent against a database that already ran the broken version.
drop function if exists app.get_group_detail(uuid, integer, timestamptz);

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
      -- New. 'owner' | 'member', straight off the membership row.
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
      ), 0)
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

notify pgrst, 'reload schema';
