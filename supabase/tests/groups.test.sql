-- Standalone group creation and the expense detail read.
--
-- Both are Phase 5 additions: the picker's "+ New group" escape hatch needs a group that
-- exists before any expense does, and the expense detail screen — which the design set never
-- had — needs one round trip that returns an expense in full.

begin;
select plan(9);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2');

delete from public.profiles where user_id in
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');

insert into public.profiles (id, user_id, display_name) values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'Dev'),
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'Ira');
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('dddddddd-0000-0000-0000-000000000003', 'Meher', 'dddddddd-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- ---------------------------------------------------------------- create_group

select lives_ok(
  $$ select app.create_group(
       jsonb_build_object(
         'id', 'a0a0a0a0-0000-0000-0000-000000000001',
         'name', 'Sunday football',
         'member_profile_ids', jsonb_build_array('dddddddd-0000-0000-0000-000000000003')),
       'd0d0d0d0-0000-0000-0000-000000000001'
     ) $$,
  'create_group makes a group with no expenses in it'
);

select is(
  (select count(*) from public.group_members
   where group_id = 'a0a0a0a0-0000-0000-0000-000000000001'),
  2::bigint,
  'the caller is added alongside the people they named'
);

select is(
  (select role::text from public.group_members
   where group_id = 'a0a0a0a0-0000-0000-0000-000000000001'
     and profile_id = 'dddddddd-0000-0000-0000-000000000001'),
  'owner',
  'the creator owns it'
);

select lives_ok(
  $$ select app.create_group(
       jsonb_build_object(
         'id', 'a0a0a0a0-0000-0000-0000-000000000001',
         'name', 'Sunday football',
         'member_profile_ids', jsonb_build_array('dddddddd-0000-0000-0000-000000000003')),
       'd0d0d0d0-0000-0000-0000-000000000001'
     ) $$,
  'replaying the mutation id is accepted rather than erroring'
);

select is(
  (select count(*) from public.groups where id = 'a0a0a0a0-0000-0000-0000-000000000001'),
  1::bigint,
  'and does not make a second group'
);

select throws_ok(
  $$ select app.create_group(jsonb_build_object('name', '   '), 'd0d0d0d0-0000-0000-0000-000000000002') $$,
  '22023',
  null,
  'a nameless group is refused'
);

-- Ira is a stranger: no shared group, no shared expense, and not a placeholder Dev created.
select throws_ok(
  $$ select app.create_group(
       jsonb_build_object(
         'name', 'Strangers',
         'member_profile_ids', jsonb_build_array('dddddddd-0000-0000-0000-000000000002')),
       'd0d0d0d0-0000-0000-0000-000000000003'
     ) $$,
  '42501',
  null,
  'you cannot add someone you share no context with — that would be a profile-id probe'
);

-- ---------------------------------------------------------------- get_expense_detail

select app.create_expense(
  jsonb_build_object(
    'id', 'eeee5555-0000-0000-0000-000000000001',
    'group_id', 'a0a0a0a0-0000-0000-0000-000000000001',
    'description', 'Pitch booking',
    'amount_minor', 100000,
    'split_type', 'equal',
    'spent_on', current_date,
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','paid_amount_minor',100000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','share_amount_minor',50000),
      jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000003','share_amount_minor',50000))
  ),
  'd0d0d0d0-0000-0000-0000-000000000004'
);

select is(
  (select (app.get_expense_detail('eeee5555-0000-0000-0000-000000000001')->>'my_paid_minor')::bigint
     - (app.get_expense_detail('eeee5555-0000-0000-0000-000000000001')->>'my_share_minor')::bigint),
  50000::bigint,
  'detail reports what the caller is owed on this one expense'
);

-- Ira is in no group with Dev and on none of his expenses, so this must not leak.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select throws_ok(
  $$ select app.get_expense_detail('eeee5555-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'someone with no claim on the expense cannot read it'
);

select * from finish();
rollback;
