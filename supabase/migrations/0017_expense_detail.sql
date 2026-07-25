-- Expense detail.
--
-- Every expense row in Group and Person detail led nowhere: the design set has no expense
-- detail screen at all, so nothing read one expense in full. This is the RPC behind that
-- screen, and it deliberately returns everything the screen needs in ONE round trip —
-- the expense, who paid, how it split, the line items, the comments and the history.
--
-- Display names are joined in here rather than resolved on the client. The client only knows
-- the people on its home summary, and an expense can legitimately involve someone who has
-- since left every shared group.

create or replace function app.get_expense_detail(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me        uuid := auth_ext.assert_signed_in();
  v_expense   public.expenses%rowtype;
  v_payers    jsonb;
  v_splits    jsonb;
  v_items     jsonb;
  v_comments  jsonb;
  v_history   jsonb;
  v_receipts  jsonb;
begin
  select * into v_expense from public.expenses where id = p_expense_id;

  if not found then
    raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
  end if;

  -- Being a participant is the gate. A group member who is not on this particular expense can
  -- still see it (it moves the group's balances), which is why the group check is an OR.
  if not exists (
    select 1 from public.expense_participants ep
    where ep.expense_id = p_expense_id and ep.profile_id = v_me
  ) and not (
    v_expense.group_id is not null and auth_ext.is_group_member(v_expense.group_id)
  ) then
    raise exception 'not your expense' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', p.profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'paid_amount_minor', p.paid_amount_minor
  ) order by p.paid_amount_minor desc), '[]'::jsonb) into v_payers
  from public.expense_payers p
  join public.profiles pr on pr.id = p.profile_id
  where p.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', s.profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'share_amount_minor', s.share_amount_minor,
    'weight', s.split_weight
  ) order by s.share_amount_minor desc), '[]'::jsonb) into v_splits
  from public.expense_splits s
  join public.profiles pr on pr.id = s.profile_id
  where s.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name,
    'amount_minor', i.amount_minor,
    'kind', i.kind,
    'participants', coalesce((
      select jsonb_agg(sh.profile_id) from public.expense_item_shares sh where sh.item_id = i.id
    ), '[]'::jsonb)
  ) order by i.position), '[]'::jsonb) into v_items
  from public.expense_items i
  where i.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'author_profile_id', c.author_profile_id,
    'display_name', pr.display_name,
    'avatar_url', pr.avatar_url,
    'body', c.body,
    'created_at', c.created_at
  ) order by c.created_at), '[]'::jsonb) into v_comments
  from public.expense_comments c
  join public.profiles pr on pr.id = c.author_profile_id
  where c.expense_id = p_expense_id and c.deleted_at is null;

  -- History carries the actor and the action, not the whole snapshot. The snapshots are large
  -- and the screen only lists "Priya edited this" — the full diff is a separate ask.
  select coalesce(jsonb_agg(jsonb_build_object(
    'revision', r.revision,
    'action', r.action,
    'actor_profile_id', r.actor_profile_id,
    'display_name', pr.display_name,
    'created_at', r.created_at,
    'diff', r.diff
  ) order by r.revision desc, r.created_at desc), '[]'::jsonb) into v_history
  from public.expense_revisions r
  left join public.profiles pr on pr.id = r.actor_profile_id
  where r.expense_id = p_expense_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'storage_path', a.storage_path, 'mime_type', a.mime_type
  ) order by a.created_at), '[]'::jsonb) into v_receipts
  from public.expense_attachments a
  where a.expense_id = p_expense_id;

  return jsonb_build_object(
    'expense', jsonb_build_object(
      'id', v_expense.id,
      'group_id', v_expense.group_id,
      'group_name', (select g.name from public.groups g where g.id = v_expense.group_id),
      'description', v_expense.description,
      'amount_minor', v_expense.amount_minor,
      'currency', v_expense.currency,
      'split_type', v_expense.split_type,
      'spent_on', v_expense.spent_on,
      'revision', v_expense.revision,
      'deleted_at', v_expense.deleted_at,
      'created_by_profile_id', v_expense.created_by_profile_id,
      'created_at', v_expense.created_at
    ),
    'my_share_minor', coalesce((
      select s.share_amount_minor from public.expense_splits s
      where s.expense_id = p_expense_id and s.profile_id = v_me
    ), 0),
    'my_paid_minor', coalesce((
      select p.paid_amount_minor from public.expense_payers p
      where p.expense_id = p_expense_id and p.profile_id = v_me
    ), 0),
    'payers', v_payers,
    'splits', v_splits,
    'items', v_items,
    'comments', v_comments,
    'history', v_history,
    'receipts', v_receipts
  );
end;
$$;

revoke all on function app.get_expense_detail(uuid) from public;
grant execute on function app.get_expense_detail(uuid) to authenticated;
