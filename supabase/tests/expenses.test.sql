-- The write path: one RPC, six tables, one transaction, one idempotency key.

begin;
select plan(13);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Ann');
insert into public.profiles (id, display_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Priya'),      -- a placeholder, never signed up
  ('cccccccc-0000-0000-0000-000000000001', 'Arjun');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ---------------------------------------------------------------- create

select lives_ok(
  $$ select app.create_expense(
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
     ) $$,
  'create_expense writes an expense, a group and its members in one call'
);

select is(
  (select count(*) from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
  1::bigint,
  'the expense exists'
);

select is(
  (select name from public.groups g
   join public.expenses e on e.group_id = g.id
   where e.id = 'eeee1111-0000-0000-0000-000000000001'),
  'Goa, finally',
  'naming the group promoted the participant set into a real group'
);

select is(
  (select count(*) from public.group_members gm
   join public.expenses e on e.group_id = gm.group_id
   where e.id = 'eeee1111-0000-0000-0000-000000000001'),
  3::bigint,
  'the creator and both named members are in the group'
);

select is(
  (select count(*) from public.expense_participants where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  3::bigint,
  'participants were derived from payers and splits'
);

-- ---------------------------------------------------------------- derived debts

select is(
  (select count(*) from public.expense_debts where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  2::bigint,
  'the payer who also owes is netted, so only two debt edges exist - not three'
);

select is(
  (select count(*) from public.expense_debts
   where expense_id = 'eeee1111-0000-0000-0000-000000000001'
     and from_profile_id = to_profile_id),
  0::bigint,
  'no self-edge: Ann does not owe herself'
);

select is(
  (select sum(amount_minor)::bigint from public.expense_debts where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  288000::bigint,
  'debts sum to exactly what the other two owe'
);

-- ---------------------------------------------------------------- audit + fan-out

select is(
  (select count(*) from public.expense_revisions
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and action = 'created'),
  1::bigint,
  'a revision snapshot was recorded'
);

select is(
  (select count(*) from internal.change_events where entity_id = 'eeee1111-0000-0000-0000-000000000001'),
  2::bigint,
  'change events fan out to the other participants, never to the actor'
);

-- ---------------------------------------------------------------- idempotency

select lives_ok(
  $$ select app.create_expense(
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
     ) $$,
  'replaying the same mutation id is accepted rather than erroring'
);

select is(
  (select count(*) from public.expenses),
  1::bigint,
  'THE RETRY CASE: server committed, response lost, client retried - still one expense'
);

-- ---------------------------------------------------------------- the guardrail

select throws_ok(
  $$
    insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'unbalanced', 1000, 'equal', current_date,
            'aaaaaaaa-0000-0000-0000-000000000001');
    insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 1000);
    insert into public.expense_splits (expense_id, group_id, profile_id, share_amount_minor)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 999);
    set constraints all immediate;
  $$,
  '23514',
  null,
  'splits that do not sum to the total are rejected at commit'
);

select * from finish();
rollback;
