-- Optimistic concurrency and the read RPCs.
--
-- The scenario Phase 8's offline outbox is built around: two people edit the same expense
-- while both are offline. The first to reconnect wins normally; the second must get a typed
-- conflict carrying the server's snapshot, NOT a silent overwrite. Money is not a field where
-- last-writer-wins is acceptable.

begin;
select plan(12);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');
delete from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Ann');
insert into public.profiles (id, display_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Priya');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select app.create_expense(
  jsonb_build_object(
    'id','eeee1111-0000-0000-0000-000000000001','description','Beach shack dinner',
    'amount_minor',10000,'split_type','equal','spent_on',current_date,
    'new_group', jsonb_build_object('name','Goa, finally',
      'member_profile_ids', jsonb_build_array('bbbbbbbb-0000-0000-0000-000000000001')),
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',10000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',5000),
      jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',5000))),
  '99999999-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- edit

select lives_ok(
  $$ select app.update_expense('eeee1111-0000-0000-0000-000000000001',
       jsonb_build_object('description','Beach shack dinner (corrected)'),
       1, '99999999-0000-0000-0000-000000000002') $$,
  'an edit at the expected revision goes through'
);

select is(
  (select revision from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
  2,
  'the revision advanced'
);

select is(
  (select count(*) from public.expense_revisions
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and action = 'updated'),
  1::bigint,
  'the edit is in the audit trail'
);

-- ---------------------------------------------------------------- the conflict

select throws_ok(
  $$ select app.update_expense('eeee1111-0000-0000-0000-000000000001',
       jsonb_build_object('description','edited from a stale client'),
       1, '99999999-0000-0000-0000-000000000003') $$,
  'P0409',
  null,
  'THE OFFLINE CASE: a stale revision is rejected with a typed conflict, not silently applied'
);

select is(
  (select description from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
  'Beach shack dinner (corrected)',
  'and the stale edit did NOT overwrite the newer one'
);

-- ---------------------------------------------------------------- amounts stay balanced

select lives_ok(
  $$ select app.update_expense('eeee1111-0000-0000-0000-000000000001',
       jsonb_build_object(
         'amount_minor', 30000,
         'payers', jsonb_build_array(
           jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',30000)),
         'splits', jsonb_build_array(
           jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',15000),
           jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',15000))),
       2, '99999999-0000-0000-0000-000000000004') $$,
  'changing the amount along with payers and splits is accepted'
);

select is(
  (select sum(amount_minor)::bigint from public.expense_debts
   where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  15000::bigint,
  'the derived debts were rebuilt to match the new amount'
);

-- ---------------------------------------------------------------- delete beats edit

select lives_ok(
  $$ select app.delete_expense('eeee1111-0000-0000-0000-000000000001', 3,
                               '99999999-0000-0000-0000-000000000005') $$,
  'deleting at the expected revision works'
);

select throws_ok(
  $$ select app.update_expense('eeee1111-0000-0000-0000-000000000001',
       jsonb_build_object('description','edit after delete'),
       4, '99999999-0000-0000-0000-000000000006') $$,
  'P0409',
  null,
  'a delete beats a concurrent edit - restoring has to be an explicit choice'
);

select is(
  (select coalesce(sum(net_minor), 0)::bigint from app.v_group_balances
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'a deleted expense drops out of the balances entirely'
);

-- ---------------------------------------------------------------- read RPCs

select lives_ok(
  $$ select app.get_home_summary() $$,
  'get_home_summary runs for a signed-in caller'
);

select is(
  (select jsonb_array_length(app.get_home_summary()->'groups')),
  1,
  'home lists the one group the caller belongs to'
);

select * from finish();
rollback;
