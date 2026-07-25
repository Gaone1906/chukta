-- Row level security, verified the only way that means anything: by trying to read data you
-- should NOT be able to see, and asserting you get nothing back.
--
-- A test that only checks you can read your own rows would pass just as happily with RLS
-- switched off entirely.

begin;
select plan(12);

-- ---------------------------------------------------------------- fixtures

-- NOTE: on_auth_user_created auto-creates a profile for every auth.users row. These fixtures
-- want specific, readable profile ids, so the auto-created rows are swapped out below. The
-- trigger's own behaviour is covered properly in identity.test.sql.

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),   -- Ann
  ('00000000-0000-0000-0000-0000000000b1'),   -- Bob (different group entirely)
  ('00000000-0000-0000-0000-0000000000c1');   -- Cy (shares a one-off with Ann, no group)

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000c1');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Ann'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Bob'),
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'Cy');

insert into public.groups (id, name, created_by_profile_id) values
  ('11111111-0000-0000-0000-000000000001', 'Goa, finally', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000001', 'Bob''s flat',  'bbbbbbbb-0000-0000-0000-000000000001');

insert into public.group_members (group_id, profile_id) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001');

-- Ann's group expense.
insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
values ('eeee1111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'Beach shack dinner', 432000, 'equal', current_date, 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
values ('eeee1111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 432000);
insert into public.expense_splits (expense_id, group_id, profile_id, share_amount_minor)
values ('eeee1111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 432000);
insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower)
values ('eeee1111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', true, true);

-- A group-LESS one-off between Ann and Cy. This is the case flat group checks would miss.
insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
values ('eeee2222-0000-0000-0000-000000000001', null,
        'Airport cab', 100000, 'equal', current_date, 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
values ('eeee2222-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 100000);
insert into public.expense_splits (expense_id, group_id, profile_id, share_amount_minor) values
  ('eeee2222-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 50000),
  ('eeee2222-0000-0000-0000-000000000001', null, 'cccccccc-0000-0000-0000-000000000001', 50000);
insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower) values
  ('eeee2222-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', true, true),
  ('eeee2222-0000-0000-0000-000000000001', null, 'cccccccc-0000-0000-0000-000000000001', false, true);

-- ---------------------------------------------------------------- as Ann

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*) from public.expenses),
  2::bigint,
  'Ann sees her group expense and her one-off, and nothing else'
);

select is(
  (select count(*) from public.groups),
  1::bigint,
  'Ann sees only the group she belongs to'
);

select is(
  (select count(*) from public.expenses where id = 'eeee2222-0000-0000-0000-000000000001'),
  1::bigint,
  'a group-less one-off is visible to its participants'
);

-- ---------------------------------------------------------------- as Bob

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*) from public.expenses),
  0::bigint,
  'THE TEST THAT MATTERS: a member of one group sees ZERO of another group''s expenses'
);

select is(
  (select count(*) from public.expenses where group_id = '11111111-0000-0000-0000-000000000001'),
  0::bigint,
  'naming another group''s id explicitly still returns nothing'
);

select is(
  (select count(*) from public.expense_splits),
  0::bigint,
  'splits are invisible too - the child policies hold on their own'
);

select is(
  (select count(*) from public.expense_payers),
  0::bigint,
  'payers are invisible'
);

select is(
  (select count(*) from public.groups where id = '11111111-0000-0000-0000-000000000001'),
  0::bigint,
  'the group itself is invisible'
);

select is(
  (select count(*) from public.group_members where group_id = '11111111-0000-0000-0000-000000000001'),
  0::bigint,
  'group membership does not leak - and querying it does not recurse'
);

-- ---------------------------------------------------------------- as Cy

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select is(
  (select count(*) from public.expenses),
  1::bigint,
  'Cy sees the one-off he is part of, but not Ann''s group expense'
);

select is(
  (select count(*) from public.expenses where group_id is not null),
  0::bigint,
  'sharing a one-off with Ann does not grant access to her groups'
);

-- ---------------------------------------------------------------- writes are closed

select throws_ok(
  $$ insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
     values (gen_random_uuid(), null, 'sneaky', 100, 'equal', current_date, 'cccccccc-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'clients cannot INSERT into expenses directly - writes only go through RPCs'
);

select * from finish();
rollback;
