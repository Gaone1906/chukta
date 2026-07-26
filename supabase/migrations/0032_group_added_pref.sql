-- Being added to a group is not a new expense.
--
-- `internal.wants_notification` mapped `group_added` onto `new_expenses`, because
-- `notification_prefs` had five booleans and none of them were about membership. That mapping
-- was a placeholder, and a test caught what it actually does: somebody who turned new expenses
-- off was never told a group existed — and then expenses started appearing in it, from an app
-- that had never mentioned it. Muting the chatter should not hide the room.
--
-- The alternative was to make `group_added` unconditional. Rejected: every other category here
-- is refusable, and one that is not becomes the reason somebody turns the OS permission off
-- instead — which silences all five.
--
-- Its own column, then. This is the right shape for it regardless of the bug: membership is a
-- different kind of event from money moving. It is rare (once per group, not once per receipt),
-- it is high-signal, and it is the one notification that explains all the others.
--
-- Defaults true, like its neighbours, and back-fills every existing row to true — an existing
-- user has never expressed a preference about this, and "unset" means on everywhere else here.

alter table public.notification_prefs
  add column if not exists group_adds boolean not null default true;

comment on column public.notification_prefs.group_adds is
  'Tell me when someone puts me in a group. Deliberately independent of new_expenses.';

create or replace function internal.wants_notification(p_profile_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Default TRUE when no prefs row exists. A profile that has never opened Settings should
  -- still hear about an expense; the row is created lazily and its absence means "unset",
  -- not "off".
  select coalesce(
    (select case p_kind
       when 'expense_added'   then p.new_expenses
       when 'expense_edited'  then p.expense_edits
       -- A delete and a restore both move what you owe, which is what `new_expenses` is
       -- really gating. Only `group_added` was mapped onto it for want of anywhere else.
       when 'expense_deleted' then p.new_expenses
       when 'expense_restored' then p.new_expenses
       when 'comment'         then p.comments
       when 'settlement'      then p.settlements
       when 'group_added'     then p.group_adds
       -- A recurring expense IS a new expense — the only difference is who typed it.
       when 'recurring'       then p.new_expenses
       when 'nudge'           then p.reminders
       else true
     end
     from public.notification_prefs p where p.profile_id = p_profile_id),
    true);
$$;

notify pgrst, 'reload schema';
