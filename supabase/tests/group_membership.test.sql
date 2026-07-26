-- Managing a group after it exists: rename, leave, remove.
--
-- The interesting assertions here are all refusals. `create_group` and `add_group_members` were
-- the whole membership surface, so the risk in adding the rest is not that renaming fails — it
-- is that leaving quietly strands a debt, which nothing would notice until two people disagreed
-- about who owed what.

begin;
select plan(14);

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000ab1'),
  ('00000000-0000-0000-0000-000000000ab2'),
  ('00000000-0000-0000-0000-000000000ab3');

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-000000000ab1',
  '00000000-0000-0000-0000-000000000ab2',
  '00000000-0000-0000-0000-000000000ab3');

insert into public.profiles (id, user_id, display_name) values
  ('99990000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000ab1', 'Owen'),
  ('99990000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000ab2', 'Mira'),
  ('99990000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000ab3', 'Sam');

/*
 * The group is built directly rather than through `app.create_group`.
 *
 * That RPC refuses members the caller has no shared context with (`0016:44`) — a real guard,
 * and not the one under test here. Going through it would mean first manufacturing a shared
 * context between three brand-new accounts, which is a fixture for a different file.
 */
insert into public.groups (id, name, created_by_profile_id) values
  ('99991111-0000-0000-0000-000000000001', 'Flat', '99990000-0000-0000-0000-000000000001');

insert into public.group_members (group_id, profile_id, role) values
  ('99991111-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001', 'owner'),
  ('99991111-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000002', 'member'),
  ('99991111-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000003', 'member');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';

-- ---------------------------------------------------------------- rename

select is(
  app.rename_group('99991111-0000-0000-0000-000000000001', '  Flat 302  ',
                   '99992222-0000-0000-0000-000000000002') ->> 'name',
  'Flat 302',
  'renaming trims the name it stores');

select is(
  (select name from public.groups where id = '99991111-0000-0000-0000-000000000001'),
  'Flat 302',
  'and the row actually changed');

-- A blank name would hit the CHECK constraint and reach the client as a bare 23514 with nothing
-- actionable in it. Refused before that with something a person can do about it.
select throws_ok(
  $$ select app.rename_group('99991111-0000-0000-0000-000000000001', '   ',
                             '99992222-0000-0000-0000-000000000003') $$,
  'P0001',
  'a group name must be between 1 and 60 characters',
  'a blank name is refused with a message, not a constraint violation');

-- Any member may rename: this app has no hierarchy anywhere else, and inventing one for a text
-- field would be inconsistent with every other write.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab2","role":"authenticated"}';

select lives_ok(
  $$ select app.rename_group('99991111-0000-0000-0000-000000000001', 'The Flat',
                             '99992222-0000-0000-0000-000000000004') $$,
  'any member can rename, not just the owner');

-- ---------------------------------------------------------------- leaving while square

select is(
  app.leave_group('99991111-0000-0000-0000-000000000001',
                  '99992222-0000-0000-0000-000000000005') ->> 'left',
  'true',
  'a member with nothing outstanding can leave');

select is(
  (select left_at is not null from public.group_members
    where group_id = '99991111-0000-0000-0000-000000000001'
      and profile_id = '99990000-0000-0000-0000-000000000002'),
  true,
  'and the membership row is closed rather than deleted');

-- ---------------------------------------------------------------- leaving while owing

/*
 * THE assertion in this file. Leaving does not cancel a debt — the expense rows survive and
 * `app.v_pair_ledger` keeps counting them — it only removes the person from the roster that
 * displays and settles it. So the money would stop being anybody's problem while remaining
 * somebody's money.
 */
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';

select app.create_expense(
  jsonb_build_object(
    'id', '99993333-0000-0000-0000-000000000001',
    'group_id', '99991111-0000-0000-0000-000000000001',
    'description', 'Router',
    'amount_minor', 100000,
    'split_type', 'equal',
    'spent_on', current_date,
    'payers', jsonb_build_array(jsonb_build_object(
      'profile_id', '99990000-0000-0000-0000-000000000001', 'paid_amount_minor', 100000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id', '99990000-0000-0000-0000-000000000001', 'share_amount_minor', 50000),
      jsonb_build_object('profile_id', '99990000-0000-0000-0000-000000000003', 'share_amount_minor', 50000))),
  '99992222-0000-0000-0000-000000000006');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab3","role":"authenticated"}';

select throws_ok(
  $$ select app.leave_group('99991111-0000-0000-0000-000000000001',
                            '99992222-0000-0000-0000-000000000007') $$,
  'P0001',
  'settle up before leaving — your balance in this group is not zero',
  'somebody who owes money cannot leave and strand the debt');

-- ---------------------------------------------------------------- removing somebody else

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab3","role":"authenticated"}';

select throws_ok(
  $$ select app.remove_group_member('99991111-0000-0000-0000-000000000001',
                                    '99990000-0000-0000-0000-000000000001',
                                    '99992222-0000-0000-0000-000000000008') $$,
  '42501',
  'only the group owner can remove somebody',
  'a plain member cannot remove anyone — that changes another person''s access');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';

select throws_ok(
  $$ select app.remove_group_member('99991111-0000-0000-0000-000000000001',
                                    '99990000-0000-0000-0000-000000000003',
                                    '99992222-0000-0000-0000-000000000009') $$,
  'P0001',
  'that person has a balance in this group — settle up first',
  'and the owner cannot remove somebody who is mid-debt either');

select throws_ok(
  $$ select app.remove_group_member('99991111-0000-0000-0000-000000000001',
                                    '99990000-0000-0000-0000-000000000001',
                                    '9999222a-0000-0000-0000-000000000001') $$,
  'P0001',
  'use leave_group to remove yourself',
  'removing yourself is routed to leave_group, which has different rules and an extra job');

-- ---------------------------------------------------------------- the last one out

/*
 * An emptied group would otherwise sit in the database with nobody in it — invisible, since
 * every read is scoped by membership, but not actually closed. Archiving says what happened,
 * and `get_home_summary` already filters on `archived_at is null`.
 */
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';

insert into public.groups (id, name, created_by_profile_id) values
  ('99991111-0000-0000-0000-000000000002', 'Just me', '99990000-0000-0000-0000-000000000001');
insert into public.group_members (group_id, profile_id, role) values
  ('99991111-0000-0000-0000-000000000002', '99990000-0000-0000-0000-000000000001', 'owner');

select is(
  app.leave_group('99991111-0000-0000-0000-000000000002',
                  '9999222b-0000-0000-0000-000000000002') ->> 'archived',
  'true',
  'the last member out archives the group');

select is(
  (select archived_at is not null from public.groups
    where id = '99991111-0000-0000-0000-000000000002'),
  true,
  'and it is archived on the row, not just in the response');

-- ---------------------------------------------------------------- idempotency

/*
 * The outbox retries by design, so the case that matters is the SAME request arriving twice —
 * server committed, response lost. That returns the original result rather than renaming again.
 */
select is(
  app.rename_group('99991111-0000-0000-0000-000000000001', 'The Flat',
                   '99992222-0000-0000-0000-000000000004') ->> 'name',
  'The Flat',
  'a replayed key with the same payload returns the original result');

/*
 * A key reused for a DIFFERENT request is not a retry, it is a bug — and `claim_mutation`
 * refuses it rather than silently returning the wrong cached answer. Asserted here because the
 * first version of this test made exactly that mistake and the guard is what caught it.
 */
select throws_ok(
  $$ select app.rename_group('99991111-0000-0000-0000-000000000001', 'Something else entirely',
                             '99992222-0000-0000-0000-000000000004') $$,
  -- 22023, not P0001: internal.claim_mutation raises this as invalid_parameter_value, which is
  -- the more accurate class — the key is fine, the payload sent with it is not.
  '22023',
  'mutation 99992222-0000-0000-0000-000000000004 replayed with a different payload',
  'but the same key with a different payload is refused, not silently answered from cache');

select * from finish();
rollback;
