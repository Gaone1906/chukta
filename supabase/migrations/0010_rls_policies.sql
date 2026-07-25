-- Row level security.
--
-- Two rules run through all of this:
--
-- 1. NO WRITE POLICIES on any money table. Clients get SELECT and nothing else; every
--    mutation goes through a SECURITY DEFINER RPC in `app`. An expense is a six-table atomic
--    write with a sum invariant — letting the client write those tables one at a time makes
--    the invariant an honour system.
--
-- 2. EVERY helper call is wrapped in `(select ...)`. That makes the planner treat it as an
--    InitPlan evaluated once per statement instead of once per row. On a list of a few hundred
--    expenses that is the difference between one lookup and a few hundred, and it is the single
--    biggest RLS performance lever in Postgres.

alter table public.profiles                enable row level security;
alter table public.profile_contact_points  enable row level security;
alter table public.profile_claims          enable row level security;
alter table public.groups                  enable row level security;
alter table public.group_members           enable row level security;
alter table public.expenses                enable row level security;
alter table public.expense_payers          enable row level security;
alter table public.expense_splits          enable row level security;
alter table public.expense_items           enable row level security;
alter table public.expense_item_shares     enable row level security;
alter table public.expense_debts           enable row level security;
alter table public.expense_participants    enable row level security;
alter table public.expense_comments        enable row level security;
alter table public.expense_attachments     enable row level security;
alter table public.expense_revisions       enable row level security;
alter table public.settlements             enable row level security;
alter table public.device_tokens           enable row level security;
alter table public.notification_prefs      enable row level security;
alter table public.feedback                enable row level security;

-- ---------------------------------------------------------------- identity

create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = (select auth_ext.current_profile_id())
    or created_by_profile_id = (select auth_ext.current_profile_id())
    or (select auth_ext.shares_context_with(profiles.id))
  );

-- Own profile only, and only the display fields — user_id, merge pointers and claimed_at are
-- set by RPCs, never by the client.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth_ext.current_profile_id()))
  with check (id = (select auth_ext.current_profile_id()));

create policy contact_points_read on public.profile_contact_points
  for select to authenticated
  using (profile_id = (select auth_ext.current_profile_id()));

-- Deliberately no policy on profile_claims: invite tokens are only ever handled by RPCs.

-- ---------------------------------------------------------------- groups

create policy groups_read on public.groups
  for select to authenticated
  using (id in (select auth_ext.my_group_ids()));

-- No recursion: my_group_ids is SECURITY DEFINER and reads the table with RLS bypassed.
create policy group_members_read on public.group_members
  for select to authenticated
  using (group_id in (select auth_ext.my_group_ids()));

-- ---------------------------------------------------------------- expenses

create policy expenses_read on public.expenses
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or exists (
      select 1 from public.expense_participants ep
      where ep.expense_id = expenses.id
        and ep.profile_id = (select auth_ext.current_profile_id())
    )
  );

-- The child policies are flat because group_id is denormalised onto each of them; without
-- that they would each need a join back to expenses on every row.
create policy expense_payers_read on public.expense_payers
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or profile_id = (select auth_ext.current_profile_id())
    or exists (
      select 1 from public.expense_participants ep
      where ep.expense_id = expense_payers.expense_id
        and ep.profile_id = (select auth_ext.current_profile_id())
    )
  );

create policy expense_splits_read on public.expense_splits
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or profile_id = (select auth_ext.current_profile_id())
    or exists (
      select 1 from public.expense_participants ep
      where ep.expense_id = expense_splits.expense_id
        and ep.profile_id = (select auth_ext.current_profile_id())
    )
  );

create policy expense_debts_read on public.expense_debts
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or from_profile_id = (select auth_ext.current_profile_id())
    or to_profile_id = (select auth_ext.current_profile_id())
  );

create policy expense_participants_read on public.expense_participants
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or profile_id = (select auth_ext.current_profile_id())
  );

create policy expense_items_read on public.expense_items
  for select to authenticated
  using ((select auth_ext.can_read_expense(expense_items.expense_id)));

create policy expense_item_shares_read on public.expense_item_shares
  for select to authenticated
  using (
    exists (
      select 1 from public.expense_items i
      where i.id = expense_item_shares.item_id
        and (select auth_ext.can_read_expense(i.expense_id))
    )
  );

create policy expense_comments_read on public.expense_comments
  for select to authenticated
  using ((select auth_ext.can_read_expense(expense_comments.expense_id)));

create policy expense_attachments_read on public.expense_attachments
  for select to authenticated
  using ((select auth_ext.can_read_expense(expense_attachments.expense_id)));

create policy expense_revisions_read on public.expense_revisions
  for select to authenticated
  using ((select auth_ext.can_read_expense(expense_revisions.expense_id)));

create policy settlements_read on public.settlements
  for select to authenticated
  using (
    (group_id is not null and group_id in (select auth_ext.my_group_ids()))
    or from_profile_id = (select auth_ext.current_profile_id())
    or to_profile_id = (select auth_ext.current_profile_id())
  );

-- ---------------------------------------------------------------- self-scoped
-- These carry no cross-user invariants, so they skip the RPC layer entirely.

create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (profile_id = (select auth_ext.current_profile_id()))
  with check (profile_id = (select auth_ext.current_profile_id()));

create policy notification_prefs_own on public.notification_prefs
  for all to authenticated
  using (profile_id = (select auth_ext.current_profile_id()))
  with check (profile_id = (select auth_ext.current_profile_id()));

create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (profile_id = (select auth_ext.current_profile_id()));

create policy feedback_read_own on public.feedback
  for select to authenticated
  using (profile_id = (select auth_ext.current_profile_id()));

-- ---------------------------------------------------------------- grants
-- SELECT only on the money tables. There is no INSERT/UPDATE/DELETE grant to revoke later
-- because none is ever given.

grant select on
  public.profiles,
  public.profile_contact_points,
  public.groups,
  public.group_members,
  public.expenses,
  public.expense_payers,
  public.expense_splits,
  public.expense_items,
  public.expense_item_shares,
  public.expense_debts,
  public.expense_participants,
  public.expense_comments,
  public.expense_attachments,
  public.expense_revisions,
  public.settlements
to authenticated;

grant update (display_name, avatar_url, upi_vpa, timezone) on public.profiles to authenticated;

grant select, insert, update, delete on public.device_tokens to authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select, insert on public.feedback to authenticated;

grant select on app.v_pair_ledger, app.v_pair_balances, app.v_group_balances to authenticated;
