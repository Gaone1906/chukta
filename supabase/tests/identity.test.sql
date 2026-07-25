-- Identity: the signup trigger, claiming a placeholder in place, and merging.
--
-- This is the payoff for making profiles.id the universal participant identity. The case that
-- matters: a friend adds you to a dinner before you have ever opened the app, and when you
-- eventually sign up your history is simply there.

begin;
select plan(11);

-- ---------------------------------------------------------------- signup creates a profile

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000aaaa', 'ann@example.com',
        '{"full_name":"Ann Mehra"}'::jsonb, '{"provider":"google"}'::jsonb);

select is(
  (select display_name from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'),
  'Ann Mehra',
  'signing up creates a profile and captures the name from the auth metadata'
);

select is(
  (select primary_auth_provider from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'),
  'google',
  'the provider is remembered, so the login screen can say "you usually sign in with Google"'
);

select is(
  (select count(*) from public.profile_contact_points
   where profile_id = (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa')
     and kind = 'email' and verified_at is not null),
  1::bigint,
  'the verified email is recorded as a contact point'
);

-- ---------------------------------------------------------------- claim in place

-- Ann invites Priya, who has never opened the app, and they share an expense.
insert into public.profiles (id, display_name, created_by_profile_id)
values ('bbbbbbbb-0000-0000-0000-00000000bbbb', 'Priya',
        (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'));

insert into public.profile_contact_points (profile_id, kind, value_norm, source)
values ('bbbbbbbb-0000-0000-0000-00000000bbbb', 'email', 'priya@example.com', 'invite');

insert into public.expenses (id, description, amount_minor, split_type, spent_on, created_by_profile_id)
values ('eeee0001-0000-0000-0000-000000000001', 'Airport cab', 100000, 'equal', current_date,
        (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'));
insert into public.expense_payers (expense_id, profile_id, paid_amount_minor)
values ('eeee0001-0000-0000-0000-000000000001',
        (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), 100000);
insert into public.expense_splits (expense_id, profile_id, share_amount_minor) values
  ('eeee0001-0000-0000-0000-000000000001',
   (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), 50000),
  ('eeee0001-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000bbbb', 50000);
insert into public.expense_participants (expense_id, profile_id, is_payer, is_ower) values
  ('eeee0001-0000-0000-0000-000000000001',
   (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), true, true),
  ('eeee0001-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000bbbb', false, true);

-- Priya finally signs up, with the address she was invited by.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000bbbb', 'priya@example.com');

select is(
  (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000bbbb'),
  'bbbbbbbb-0000-0000-0000-00000000bbbb'::uuid,
  'THE PAYOFF: signup claims the existing placeholder in place rather than making a new profile'
);

select is(
  (select display_name from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000bbbb'),
  'Priya',
  'the name her friend used is kept'
);

select is(
  (select count(*) from public.expense_splits
   where profile_id = 'bbbbbbbb-0000-0000-0000-00000000bbbb'),
  1::bigint,
  'her share of the expense from before she signed up is already hers - nothing migrated'
);

select isnt(
  (select claimed_at from public.profiles where id = 'bbbbbbbb-0000-0000-0000-00000000bbbb'),
  null,
  'the claim is timestamped'
);

-- ---------------------------------------------------------------- merge

-- A second friend had also invited Priya, under a different address, creating a duplicate.
insert into public.profiles (id, display_name)
values ('cccccccc-0000-0000-0000-00000000cccc', 'Priya S');
insert into public.expenses (id, description, amount_minor, split_type, spent_on, created_by_profile_id)
values ('eeee0002-0000-0000-0000-000000000002', 'Turf booking', 60000, 'equal', current_date,
        (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'));
insert into public.expense_payers (expense_id, profile_id, paid_amount_minor)
values ('eeee0002-0000-0000-0000-000000000002',
        (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), 60000);
insert into public.expense_splits (expense_id, profile_id, share_amount_minor) values
  ('eeee0002-0000-0000-0000-000000000002',
   (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), 30000),
  ('eeee0002-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-00000000cccc', 30000);
insert into public.expense_participants (expense_id, profile_id, is_payer, is_ower) values
  ('eeee0002-0000-0000-0000-000000000002',
   (select id from public.profiles where user_id = '00000000-0000-0000-0000-00000000aaaa'), true, true),
  ('eeee0002-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-00000000cccc', false, true);

select lives_ok(
  $$ select app.merge_profiles('cccccccc-0000-0000-0000-00000000cccc',
                               'bbbbbbbb-0000-0000-0000-00000000bbbb', 'manual') $$,
  'the duplicate merges into the claimed profile'
);

select is(
  (select count(*) from public.expense_splits
   where profile_id = 'bbbbbbbb-0000-0000-0000-00000000bbbb'),
  2::bigint,
  'both expenses now belong to the surviving profile'
);

select is(
  (select merged_into_profile_id from public.profiles where id = 'cccccccc-0000-0000-0000-00000000cccc'),
  'bbbbbbbb-0000-0000-0000-00000000bbbb'::uuid,
  'the merged-away row survives as a tombstone, so stale offline clients still resolve'
);

select is(
  auth_ext.resolve_profile_id('cccccccc-0000-0000-0000-00000000cccc'),
  'bbbbbbbb-0000-0000-0000-00000000bbbb'::uuid,
  'resolve_profile_id follows the tombstone to the surviving identity'
);

select * from finish();
rollback;
