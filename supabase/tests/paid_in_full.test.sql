-- "Paid in full" per expense — migration 0039.
--
-- Two things in here are not ordinary coverage and should not be deleted if they ever go red:
--
--   * **The per-edge coverage rule.** Over-covering ONE debt edge must not stamp an expense that
--     still has another edge outstanding. A "sum of settlements equals amount_minor" check would
--     pass that case, and would be wrong.
--   * **Deleting a stamped expense.** Its settlements must be voided in the same transaction, or
--     the balance keeps credit for an expense that no longer exists — the failure that silently
--     corrupts a ledger, and the reason this file exists at all.
--
-- The `get_*_detail` key-set assertions are the durable fix for the 0035 regression, where a
-- `create or replace` renamed a read RPC's payload keys and nothing failed, because the client
-- casts out of `jsonb` and defaults on missing keys. They are deliberately exact rather than
-- "contains", because a rename both adds and removes — only an exact set catches one.
--
-- (The expected key lists are in the database's collation order, which ignores underscores:
-- `spent_on` sorts before `split_count`.)

begin;
select plan(32);

-- Same fixture shape as expenses.test.sql: the auth trigger auto-creates a profile per user, so
-- the auto-created rows are swapped out for ones with readable ids.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b1');

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Ann'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Priya');
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'Arjun', 'aaaaaaaa-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Ann fronts ₹4,320 for three people. Two debt edges, ₹1,440 each, both pointing at Ann.
select app.create_expense(
  jsonb_build_object(
    'id', 'eeee1111-0000-0000-0000-000000000001',
    'description', 'Beach shack dinner',
    'amount_minor', 432000,
    'split_type', 'equal',
    'spent_on', current_date,
    'new_group', jsonb_build_object(
       'name', 'Goa, finally',
       'member_profile_ids', jsonb_build_array(
         'bbbbbbbb-0000-0000-0000-000000000001',
         'cccccccc-0000-0000-0000-000000000001')),
    'payers', jsonb_build_array(
       jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',432000)),
    'splits', jsonb_build_array(
       jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',144000),
       jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',144000),
       jsonb_build_object('profile_id','cccccccc-0000-0000-0000-000000000001','share_amount_minor',144000))
  ),
  '99999999-0000-0000-0000-000000000001'
);

select is(
  (select count(*) from public.expense_debts where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  2::bigint,
  'the expense produced two debt edges, both owed to Ann'
);

select is(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'a fresh expense is not paid in full'
);

-- ---------------------------------------------------------------- the payload contracts
--
-- 0035 renamed keys here and shipped. These lock the shape.

select is(
  (select string_agg(k, ',' order by k)
   from jsonb_object_keys(app.get_expense_detail('eeee1111-0000-0000-0000-000000000001')) k),
  'comments,expense,history,items,my_paid_minor,my_share_minor,outstanding_to_me,'
  || 'paid_in_full_at,payers,receipts,settled_to_me,splits',
  'get_expense_detail emits exactly the keys lib/api.ts reads'
);

select is(
  (select string_agg(k, ',' order by k)
   from jsonb_object_keys(
     (select app.get_group_detail(e.group_id) -> 'expenses' -> 0
      from public.expenses e where e.id = 'eeee1111-0000-0000-0000-000000000001')) k),
  'amount_minor,description,id,my_share_minor,paid_in_full_at,participant_count,payer_names,'
  || 'payers,revision,spent_on,split_count,split_type',
  'get_group_detail''s expense payload has payers, split_count and revision back — the 0035 fix'
);

select is(
  (select string_agg(k, ',' order by k)
   from jsonb_object_keys(
     app.get_person_detail('bbbbbbbb-0000-0000-0000-000000000001') -> 'expenses' -> 0) k),
  'amount_minor,description,group_id,group_name,id,my_share_minor,paid_in_full_at,spent_on,'
  || 'their_share_minor',
  'get_person_detail emits exactly the keys lib/api.ts reads'
);

-- ---------------------------------------------------------------- coverage is per edge
--
-- ⚠️ The assertion that kills the naive implementation. This settlement is worth ₹2,880 — the
-- WHOLE outstanding total — but it all lands on Priya's edge. Arjun still owes ₹1,440, so the
-- expense is not paid, and any check that compared a sum against `amount_minor` would say it was.

insert into public.settlements
  (id, group_id, expense_id, from_profile_id, to_profile_id, amount_minor, method, settled_on,
   recorded_by_profile_id)
select 'ffff1111-0000-0000-0000-000000000001', e.group_id, e.id,
       'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       288000, 'upi', current_date, 'aaaaaaaa-0000-0000-0000-000000000001'
from public.expenses e where e.id = 'eeee1111-0000-0000-0000-000000000001';

select is(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'over-covering ONE edge does not stamp an expense whose other edge is still outstanding'
);

delete from public.settlements where id = 'ffff1111-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- who may mark

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$ select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                                  '99999999-0000-0000-0000-000000000010') $$,
  '42501',
  null,
  'a debtor cannot mark their own debt paid — only the person owed the money can'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                                  '99999999-0000-0000-0000-000000000011') $$,
  'the person owed the money can mark it paid in full'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'recorded'),
  2::bigint,
  'one settlement per outstanding edge, each linked to the expense'
);

select is(
  (select string_agg(distinct amount_minor::text, ',') from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'recorded'),
  '144000',
  'each settlement is that edge''s amount, not the expense total'
);

select isnt(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'covering every edge stamps it'
);

select is(
  (select coalesce(sum(b.net_minor), 0)::bigint from app.v_group_balances b
   where b.group_id = (select group_id from public.expenses
                        where id = 'eeee1111-0000-0000-0000-000000000001')
     and b.profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'the stamp moved the balance: Ann is owed nothing in this group'
);

select lives_ok(
  $$ select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                                  '99999999-0000-0000-0000-000000000012') $$,
  'marking an already-paid expense is accepted rather than refused'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  2::bigint,
  'and writes nothing more — a no-op, never a second set of settlement rows'
);

-- ---------------------------------------------------------------- editing a stamped expense
--
-- No code handles this. The stamp is derived from coverage, so raising the amount un-stamps it
-- automatically and the payments stay — that money really did move, there is simply more owed
-- now. Asserted so nobody later "fixes" it.

select lives_ok(
  $$ select app.update_expense('eeee1111-0000-0000-0000-000000000001',
       jsonb_build_object(
         'amount_minor', 600000,
         'payers', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',600000)),
         'splits', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',200000),
            jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',200000),
            jsonb_build_object('profile_id','cccccccc-0000-0000-0000-000000000001','share_amount_minor',200000))),
       1, '99999999-0000-0000-0000-000000000013') $$,
  'the expense is edited upward'
);

select is(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'raising the amount un-stamps it, with no special-casing in update_expense'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'recorded'),
  2::bigint,
  'and the settlements survive the edit — that money really did change hands'
);

select lives_ok(
  $$ select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                                  '99999999-0000-0000-0000-000000000014') $$,
  'marking again tops up the difference'
);

select isnt(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'and it is stamped again'
);

-- ---------------------------------------------------------------- taking it back

select lives_ok(
  $$ select app.unmark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                                    '99999999-0000-0000-0000-000000000015') $$,
  'the person owed the money can withdraw it'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'voided'),
  4::bigint,
  'every linked settlement is voided, not deleted — the record is history'
);

select is(
  (select coalesce(sum(b.net_minor), 0)::bigint from app.v_group_balances b
   where b.group_id = (select group_id from public.expenses
                        where id = 'eeee1111-0000-0000-0000-000000000001')
     and b.profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  400000::bigint,
  'and the balance comes back'
);

select is(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'the stamp is gone with it'
);

-- ---------------------------------------------------------------- nothing was ever owed
--
-- Everyone paid exactly their own share, so there are no debt edges. "For every edge, covered"
-- over an empty set is vacuously true, which would stamp it — hence the explicit guard.
--
-- Created here rather than at the end of the file for a reason that costs an hour to rediscover:
-- `restore_expense` runs `set constraints all immediate`, and that lasts for the rest of the
-- transaction — so any `create_expense` after it trips the balanced-expense trigger at INSERT,
-- before its payers exist, rather than at commit.

select app.create_expense(
  jsonb_build_object(
    'id', 'eeee1111-0000-0000-0000-000000000002',
    'description', 'Separate cheques',
    'amount_minor', 100000,
    'split_type', 'exact',
    'spent_on', current_date,
    'group_id', (select group_id from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
    'payers', jsonb_build_array(
       jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',50000),
       jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','paid_amount_minor',50000)),
    'splits', jsonb_build_array(
       jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',50000),
       jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',50000))
  ),
  '99999999-0000-0000-0000-000000000019'
);

select is(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000002'),
  null,
  'an expense nobody owed anything on is not "paid in full" — there was nothing to pay'
);

select throws_ok(
  $$ select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000002',
                                  '99999999-0000-0000-0000-000000000020') $$,
  '42501',
  null,
  'and marking it is refused rather than silently writing nothing'
);

-- ---------------------------------------------------------------- deleting a stamped expense
--
-- THE ONE THAT SILENTLY CORRUPTS A LEDGER. A soft delete drops the expense's debts out of
-- v_pair_ledger, but settlements are joined to nothing — so without the void inside
-- delete_expense, Ann would go ₹4,000 into the red against people who owe her nothing.

select app.mark_expense_paid('eeee1111-0000-0000-0000-000000000001',
                             '99999999-0000-0000-0000-000000000016');

select lives_ok(
  $$ select app.delete_expense('eeee1111-0000-0000-0000-000000000001', 2,
                               '99999999-0000-0000-0000-000000000017') $$,
  'a stamped expense is deleted'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'voided_by_delete'),
  2::bigint,
  'the delete voided the settlements it made meaningless, under its own status'
);

select is(
  (select coalesce(sum(b.net_minor), 0)::bigint from app.v_group_balances b
   where b.group_id = (select group_id from public.expenses
                        where id = 'eeee1111-0000-0000-0000-000000000001')
     and b.profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'so the balance is square rather than showing Ann ₹4,000 in the red for an expense that is gone'
);

-- The client's offline overlay is computed at enqueue time, so undoing a delete has to know what
-- comes back to the ledger alongside the debts. On a deleted expense `settled_to_me` reports the
-- voided-by-delete rows for exactly that reason.
select is(
  jsonb_array_length(
    app.get_expense_detail('eeee1111-0000-0000-0000-000000000001') -> 'settled_to_me'),
  2,
  'a deleted expense still reports what restoring it would bring back — one entry per debtor'
);

select lives_ok(
  $$ select app.restore_expense('eeee1111-0000-0000-0000-000000000001',
                                '99999999-0000-0000-0000-000000000018') $$,
  'and it can be restored'
);

select is(
  (select count(*) from public.settlements
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and status = 'recorded'),
  2::bigint,
  'restoring un-voids what the delete voided — but only that, never what a user withdrew'
);

select isnt(
  app.expense_paid_in_full_at('eeee1111-0000-0000-0000-000000000001'),
  null,
  'so it comes back stamped'
);

select * from finish();
rollback;
