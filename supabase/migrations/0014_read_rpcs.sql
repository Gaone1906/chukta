-- Read RPCs: one round trip per screen.
--
-- Home in particular assembles both tabs and every balance in a single call. The alternative
-- (a query per list, plus one per balance) is a waterfall on the slowest screen in the app.

/*
 * Simplified debts for a group: the fewest payments that clear it.
 *
 *   Pass 1 — exact cancellations. If a debtor owes precisely what some creditor is owed, pay
 *            them directly. Free wins, and they preserve the real relationship.
 *   Pass 2 — greedy: largest debtor against largest creditor, repeatedly.
 *
 * At most n-1 transfers. The true minimum is NP-hard (it reduces to subset-sum), so greedy is
 * the correct engineering answer. Mirrors packages/core/src/settle.ts.
 *
 * This is a VIEW of the balances. A recorded settlement always names the pair who actually
 * exchanged money, never a simplified edge.
 */
create or replace function app.simplify_group_debts(p_group_id uuid)
returns table (from_profile_id uuid, to_profile_id uuid, amount_minor bigint)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_creditors record;
  v_debtors   record;
  v_amount    bigint;
begin
  perform auth_ext.assert_group_member(p_group_id);

  create temporary table if not exists pg_temp.simplify_pos (profile_id uuid primary key, amount bigint) on commit drop;
  create temporary table if not exists pg_temp.simplify_neg (profile_id uuid primary key, amount bigint) on commit drop;
  delete from pg_temp.simplify_pos;
  delete from pg_temp.simplify_neg;

  insert into pg_temp.simplify_pos
  select profile_id, net_minor from app.v_group_balances
  where group_id is not distinct from p_group_id and net_minor > 0;

  insert into pg_temp.simplify_neg
  select profile_id, -net_minor from app.v_group_balances
  where group_id is not distinct from p_group_id and net_minor < 0;

  -- Pass 1: exact matches, smallest id first so the result is deterministic.
  for v_debtors in select * from pg_temp.simplify_neg order by profile_id loop
    select * into v_creditors
    from pg_temp.simplify_pos c
    where c.amount = v_debtors.amount
    order by c.profile_id
    limit 1;

    if found then
      from_profile_id := v_debtors.profile_id;
      to_profile_id   := v_creditors.profile_id;
      amount_minor    := v_debtors.amount;
      return next;

      delete from pg_temp.simplify_neg where profile_id = v_debtors.profile_id;
      delete from pg_temp.simplify_pos where profile_id = v_creditors.profile_id;
    end if;
  end loop;

  -- Pass 2: greedy, largest against largest.
  loop
    select * into v_creditors from pg_temp.simplify_pos order by amount desc, profile_id limit 1;
    exit when not found;
    select * into v_debtors from pg_temp.simplify_neg order by amount desc, profile_id limit 1;
    exit when not found;

    v_amount := least(v_creditors.amount, v_debtors.amount);

    from_profile_id := v_debtors.profile_id;
    to_profile_id   := v_creditors.profile_id;
    amount_minor    := v_amount;
    return next;

    update pg_temp.simplify_pos set amount = amount - v_amount where profile_id = v_creditors.profile_id;
    update pg_temp.simplify_neg set amount = amount - v_amount where profile_id = v_debtors.profile_id;
    delete from pg_temp.simplify_pos where amount <= 0;
    delete from pg_temp.simplify_neg where amount <= 0;
  end loop;

  return;
end;
$$;

/*
 * Home: both tabs and every balance in one call.
 */
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

  -- People: everyone the caller has a non-zero balance with, plus anyone they share a group
  -- with, so a settled friend still appears rather than vanishing off the tab.
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
      )
  ) t;

  return jsonb_build_object('profile_id', v_me, 'groups', v_groups, 'people', v_people);
end;
$$;

/*
 * Group detail: header, per-member breakdown, and a page of expenses.
 */
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
      'revision', ex.revision,
      'payers', (select jsonb_agg(jsonb_build_object('profile_id', p.profile_id, 'paid_amount_minor', p.paid_amount_minor))
                   from public.expense_payers p where p.expense_id = ex.id),
      'my_share_minor', coalesce((select s.share_amount_minor from public.expense_splits s
                                   where s.expense_id = ex.id and s.profile_id = v_me), 0),
      'split_count', (select count(*) from public.expense_splits s where s.expense_id = ex.id)
    ) as e
    from public.expenses ex
    where ex.group_id = p_group_id
      and ex.deleted_at is null
      and (p_before is null or ex.spent_on < p_before)
    order by ex.spent_on desc, ex.id
    limit greatest(1, least(p_limit, 200))
  ) t;

  return jsonb_build_object('group', v_group, 'members', v_members, 'expenses', v_expenses);
end;
$$;

/*
 * Person detail: the combined balance with one person across every group, plus the shared
 * expenses that make it up — each tagged with which group it came from, or untagged when it
 * was a one-off. That tag is exactly why expenses.group_id is nullable.
 */
create or replace function app.get_person_detail(
  p_profile_id uuid,
  p_limit      integer default 50
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_person   jsonb;
  v_net      bigint;
  v_by_group jsonb;
  v_expenses jsonb;
begin
  if not auth_ext.shares_context_with(p_profile_id) then
    raise exception 'no shared context with profile %', p_profile_id using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', pr.id, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url,
    'upi_vpa', pr.upi_vpa, 'is_placeholder', pr.user_id is null
  ) into v_person
  from public.profiles pr where pr.id = p_profile_id;

  select coalesce(case when pb.lo = v_me then -pb.net_minor else pb.net_minor end, 0)
    into v_net
  from app.v_pair_balances pb
  where pb.lo = least(v_me, p_profile_id) and pb.hi = greatest(v_me, p_profile_id);

  select coalesce(jsonb_agg(g), '[]'::jsonb) into v_by_group
  from (
    select jsonb_build_object(
      'group_id', l.group_id,
      'group_name', gr.name,
      'net_minor', sum(case when l.lo = v_me then -l.amt else l.amt end)
    ) as g
    from app.v_pair_ledger l
    left join public.groups gr on gr.id = l.group_id
    where l.lo = least(v_me, p_profile_id) and l.hi = greatest(v_me, p_profile_id)
    group by l.group_id, gr.name
    having sum(l.amt) <> 0
  ) t;

  select coalesce(jsonb_agg(e order by e->>'spent_on' desc), '[]'::jsonb) into v_expenses
  from (
    select jsonb_build_object(
      'id', ex.id,
      'description', ex.description,
      'amount_minor', ex.amount_minor,
      'spent_on', ex.spent_on,
      'group_id', ex.group_id,
      'group_name', gr.name,
      'my_share_minor', coalesce((select s.share_amount_minor from public.expense_splits s
                                   where s.expense_id = ex.id and s.profile_id = v_me), 0),
      'their_share_minor', coalesce((select s.share_amount_minor from public.expense_splits s
                                      where s.expense_id = ex.id and s.profile_id = p_profile_id), 0)
    ) as e
    from public.expenses ex
    left join public.groups gr on gr.id = ex.group_id
    where ex.deleted_at is null
      and exists (select 1 from public.expense_participants a
                   where a.expense_id = ex.id and a.profile_id = v_me)
      and exists (select 1 from public.expense_participants b
                   where b.expense_id = ex.id and b.profile_id = p_profile_id)
    order by ex.spent_on desc, ex.id
    limit greatest(1, least(p_limit, 200))
  ) t;

  return jsonb_build_object(
    'person', v_person,
    'net_minor', coalesce(v_net, 0),
    'by_group', v_by_group,
    'expenses', v_expenses
  );
end;
$$;

revoke all on function
  app.simplify_group_debts(uuid),
  app.get_home_summary(),
  app.get_group_detail(uuid, integer, date),
  app.get_person_detail(uuid, integer)
from public;

grant execute on function
  app.simplify_group_debts(uuid),
  app.get_home_summary(),
  app.get_group_detail(uuid, integer, date),
  app.get_person_detail(uuid, integer)
to authenticated;
