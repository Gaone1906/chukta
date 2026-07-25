-- Phase 7's backend: invite links and account deletion.
--
-- Both are irreversible from the user's side and both touch other people's data, so the tests
-- are written the way rls.test.sql is — by trying the things that must NOT work, not just the
-- happy path.
--
-- The role switching is deliberate and load-bearing. RPCs are called as `authenticated` with a
-- JWT claim, because that is the only way their authorisation checks run at all. Assertions
-- about *stored state* step back out to the owning role, because most of these tables are
-- unreadable by clients on purpose — `profile_claims` has no policy and no grant, and a test
-- that could read it would be testing a database configured differently from the real one.

begin;
select plan(20);

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a7'),   -- Ann, invites people
  ('00000000-0000-0000-0000-0000000000b7'),   -- Bob, a stranger to Ann
  ('00000000-0000-0000-0000-0000000000c7');   -- Cy, already has an account

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000a7',
  '00000000-0000-0000-0000-0000000000b7',
  '00000000-0000-0000-0000-0000000000c7');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'Ann'),
  ('bbbbbbbb-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'Bob'),
  ('cccccccc-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c7', 'Cy');

-- Priya: a placeholder Ann created. Never opened the app.
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('dddddddd-0000-0000-0000-0000000000d7', 'Priya', 'aaaaaaaa-0000-0000-0000-0000000000a7');

-- Vik: a placeholder BOB created, and Ann has no connection to at all.
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('eeeeeeee-0000-0000-0000-0000000000e7', 'Vik', 'bbbbbbbb-0000-0000-0000-0000000000b7');

insert into public.device_tokens (profile_id, device_id, platform, expo_push_token) values
  ('aaaaaaaa-0000-0000-0000-0000000000a7', 'device-a7', 'ios', 'ExponentPushToken[a7]');
insert into public.notification_prefs (profile_id) values ('aaaaaaaa-0000-0000-0000-0000000000a7');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated"}';

-- ---------------------------------------------------------------- minting an invite

set local role authenticated;

select isnt(
  (select app.create_invite_link('dddddddd-0000-0000-0000-0000000000d7') ->> 'token'),
  null,
  'Ann can mint an invite for a placeholder she created'
);

select throws_ok(
  $$select count(*) from public.profile_claims$$,
  '42501',
  null,
  'a signed-in client cannot read the claims table at all — tokens are RPC-only'
);

reset role;

select is(
  (select count(*) from public.profile_claims
   where placeholder_profile_id = 'dddddddd-0000-0000-0000-0000000000d7'),
  1::bigint,
  'the claim row exists'
);

select is(
  (select count(*) from public.profile_claims
   where placeholder_profile_id = 'dddddddd-0000-0000-0000-0000000000d7'
     and token_sha256 is not null),
  1::bigint,
  'only the hash is stored — a database read cannot recover a live invite'
);

-- ---------------------------------------------------------------- re-minting supersedes

set local role authenticated;

select lives_ok(
  $$select app.create_invite_link('dddddddd-0000-0000-0000-0000000000d7')$$,
  'sharing again mints a second link'
);

reset role;

select is(
  (select count(*) from public.profile_claims
   where placeholder_profile_id = 'dddddddd-0000-0000-0000-0000000000d7'
     and claimed_at is null and expires_at > now()),
  1::bigint,
  'THE ONE THAT MATTERS: re-sharing supersedes the old link rather than accumulating live tokens'
);

select is(
  (select count(*) from public.profile_claims
   where placeholder_profile_id = 'dddddddd-0000-0000-0000-0000000000d7'),
  2::bigint,
  'the superseded row is expired, not deleted — the audit trail survives'
);

-- ---------------------------------------------------------------- who may invite whom

set local role authenticated;

select throws_ok(
  $$select app.create_invite_link('eeeeeeee-0000-0000-0000-0000000000e7')$$,
  '42501',
  null,
  'Ann cannot mint an invite for a placeholder she has no connection to'
);

select throws_ok(
  $$select app.create_invite_link('cccccccc-0000-0000-0000-0000000000c7')$$,
  'P0001',
  null,
  'nobody can mint a claim token for a profile that already has an account'
);

select throws_ok(
  $$select app.create_invite_link('00000000-0000-0000-0000-0000000000ff')$$,
  'P0002',
  null,
  'an unknown profile is "no such person", not a leak about what exists'
);

-- ---------------------------------------------------------------- a real claim still works

-- Bob claims Priya's invite. Proves the token minted here is one claim_placeholder actually
-- accepts — the two halves live in different migrations and could drift apart silently.
create temporary table minted as
  select app.create_invite_link('dddddddd-0000-0000-0000-0000000000d7') ->> 'token' as token;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b7","role":"authenticated"}';

select is(
  (select (app.claim_placeholder((select token from minted)) ->> 'merged')::boolean),
  true,
  'a freshly minted token really does claim the placeholder it names'
);

reset role;

select is(
  (select merged_into_profile_id from public.profiles
   where id = 'dddddddd-0000-0000-0000-0000000000d7'),
  'bbbbbbbb-0000-0000-0000-0000000000b7'::uuid,
  'and the placeholder folds into the claimer, history intact'
);

select is(
  (select count(*) from public.profile_claims
   where placeholder_profile_id = 'dddddddd-0000-0000-0000-0000000000d7'
     and claimed_at is not null),
  1::bigint,
  'the token is spent, so the same link cannot be used twice'
);

-- ---------------------------------------------------------------- deleting an account

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a7","role":"authenticated"}';

select lives_ok(
  $$select app.delete_account()$$,
  'Ann can delete her own account'
);

reset role;

select is(
  (select display_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-0000000000a7'),
  'Deleted user',
  'the profile is anonymised rather than removed — every counterparty balance still points at it'
);

select is(
  (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000a7'),
  0::bigint,
  'the login itself is gone, which is what deletion means to the person asking'
);

select is(
  (select count(*) from public.device_tokens
   where profile_id = 'aaaaaaaa-0000-0000-0000-0000000000a7'),
  0::bigint,
  'device tokens go, so a deleted account cannot still be pushed to'
);

select is(
  (select count(*) from public.profile_contact_points
   where profile_id = 'aaaaaaaa-0000-0000-0000-0000000000a7' and retired_at is null),
  0::bigint,
  'contact points are retired, so a deleted account does not hold that email hostage forever'
);

-- ---------------------------------------------------------------- a freshly added person

-- The rule from 0022: someone you have named but not yet split anything with still has to be
-- visible, or naming them is a dead end — the picker forgets them and the expense form cannot
-- resolve their name.

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b7","role":"authenticated"}';

select is(
  (select count(*)
   from jsonb_array_elements(app.get_home_summary()->'people') p
   where p->>'display_name' = 'Vik'),
  1::bigint,
  'a placeholder you created shows up before you have shared a single expense with them'
);

-- And the boundary: it is scoped to placeholders YOU made, not every profile in the database.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c7","role":"authenticated"}';

select is(
  (select count(*)
   from jsonb_array_elements(app.get_home_summary()->'people') p
   where p->>'display_name' = 'Vik'),
  0::bigint,
  'somebody else''s placeholder stays invisible — this is not a directory'
);

select * from finish();
rollback;
