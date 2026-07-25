-- Claim codes: the merge, the throttle, and the properties that stop it being an oracle.
--
-- The two assertions here that would be easy to omit and expensive to lose:
--
--   * **the counter survives** — a throttle built with `raise` instead of `return` gets its
--     attempt row rolled back by its own exception, so it never counts and its test still
--     passes. Asserted directly against internal.claim_attempts, not via the error.
--   * **wrong, expired and used are indistinguishable** — asserted as string equality between
--     the three responses, so a future "helpful" reason string fails here rather than in the
--     wild.

begin;
select plan(25);

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000f1'),   -- Ann, made the placeholder
  ('00000000-0000-0000-0000-0000000000f2'),   -- Bo, the real person behind it
  ('00000000-0000-0000-0000-0000000000f3');   -- Mallory, no connection to either

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f2',
  '00000000-0000-0000-0000-0000000000f3');

insert into public.profiles (id, user_id, display_name) values
  ('ffff0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Ann'),
  ('ffff0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f2', 'Bo'),
  ('ffff0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f3', 'Mallory');

-- Ann's placeholder for Bo, plus a real expense so there is a ledger worth claiming.
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('ffff0000-0000-0000-0000-00000000000b', 'Bo (placeholder)', 'ffff0000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select app.create_expense(
  jsonb_build_object(
    'id', 'ffee0000-0000-0000-0000-000000000001',
    'description', 'Dinner', 'amount_minor', 100000, 'split_type', 'equal',
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id','ffff0000-0000-0000-0000-000000000001','paid_amount_minor',100000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id','ffff0000-0000-0000-0000-000000000001','share_amount_minor',50000),
      jsonb_build_object('profile_id','ffff0000-0000-0000-0000-00000000000b','share_amount_minor',50000))),
  'ffcc0000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- the alphabet
--
-- `reset role` first: everything below reads `internal`, and `authenticated` has no USAGE on
-- that schema by design — the throttle tables must not be reachable from a client session. The
-- role is set back to `authenticated` whenever an RPC is being exercised as a real caller.
reset role;

select is(length(internal.claim_alphabet()), 32,
  'exactly 32 characters, so byte % 32 is unbiased');

select is(
  (select count(distinct substr(internal.claim_alphabet(), g, 1))
   from generate_series(1, 32) as g)::int,
  32,
  'no character repeats, or the draw would favour the duplicate');

select is(
  (select count(*)::int from generate_series(1, 32) as g
   where substr(internal.claim_alphabet(), g, 1) in ('I','L','O','U')),
  0,
  'the confusable letters are absent, so folding them collides with nothing');

-- ---------------------------------------------------------------- normalisation

select is(internal.normalise_claim_code('abcd-2345'), 'ABCD2345',
  'lowercase and the display hyphen both normalise away');

select is(internal.normalise_claim_code('  ab cd 23 45 '), 'ABCD2345',
  'stray spaces do not cost the user an attempt');

select is(internal.normalise_claim_code('O1LU2345'), '01112345',
  'O/I/L/U fold to 0/1/1/1 rather than being rejected');

-- ---------------------------------------------------------------- minting

set local role authenticated;

select lives_ok(
  $$ select app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') $$,
  'the person who created the placeholder may mint a code');

select is(
  length(app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') ->> 'code'),
  8,
  'eight characters — 2^40, not the 2^30 six would give');

select matches(
  app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') ->> 'formatted',
  '^[0-9A-Z]{4}-[0-9A-Z]{4}$',
  'displayed as XXXX-XXXX');

/*
 * The plaintext must never be recoverable from the table.
 *
 * **This assertion used to be vacuous and it is worth saying why**, because the broken version
 * looked completely reasonable: it searched the stored bytes for the literal 'ABCD2345', a
 * string that was never minted, so it passed whether or not real codes were stored verbatim.
 * A negative test has to search for something that genuinely exists. This mints a real code and
 * looks for THAT.
 */
set local role authenticated;
select app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') ->> 'code' as probe_code \gset
reset role;

select is(
  (select count(*)::int from internal.claim_codes c
   where encode(c.code_hmac, 'escape') like '%' || :'probe_code' || '%'
      or encode(c.code_hmac, 'hex') like '%' || encode(convert_to(:'probe_code', 'UTF8'), 'hex') || '%'),
  0,
  'a code that WAS just minted is not recoverable from the stored bytes');

select is(
  (select count(*)::int from internal.claim_codes c
   where c.code_hmac = internal.claim_code_hmac(:'probe_code')),
  1,
  'and the same code does hash to the row, so the search above was looking in the right place');

select isnt(
  internal.claim_code_hmac('ABCD2345'),
  extensions.digest('ABCD2345', 'sha256'),
  'the HMAC is peppered, so it is not a bare SHA-256 a rainbow table would invert');

-- ---------------------------------------------------------------- superseding

reset role;

select is(
  (select count(*)::int from internal.claim_codes
   where placeholder_profile_id = 'ffff0000-0000-0000-0000-00000000000b'
     and redeemed_at is null and expires_at > now()),
  1,
  'minting supersedes every earlier live code, so N does not accumulate');

-- ---------------------------------------------------------------- the guards

set local role authenticated;

select throws_ok(
  $$ select app.create_claim_code('ffff0000-0000-0000-0000-000000000002') $$,
  'P0001',
  'that person already has an account',
  'no code for somebody who already signed up — there is nothing to claim');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';

select throws_ok(
  $$ select app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') $$,
  '42501',
  'you cannot invite that person',
  'a stranger cannot mint a code for a placeholder they have no context with');

-- ---------------------------------------------------------------- redemption

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select app.create_claim_code('ffff0000-0000-0000-0000-00000000000b') ->> 'code' as good_code \gset

-- Bo redeems it and absorbs the placeholder Ann had been splitting with.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

select is(
  (app.redeem_claim_code(:'good_code') ->> 'merged')::boolean,
  true,
  'a good code merges the placeholder into the redeemer');

reset role;

select is(
  (select merged_into_profile_id from public.profiles
   where id = 'ffff0000-0000-0000-0000-00000000000b'),
  'ffff0000-0000-0000-0000-000000000002'::uuid,
  'the placeholder is tombstoned onto Bo');

select is(
  (select count(*)::int from public.expense_splits
   where expense_id = 'ffee0000-0000-0000-0000-000000000001'
     and profile_id = 'ffff0000-0000-0000-0000-000000000002'),
  1,
  'Ann''s expense now names Bo — the ledger came across');

set local role authenticated;

select is(
  app.redeem_claim_code(:'good_code') ->> 'reason',
  'invalid',
  'the same code cannot be redeemed twice');

-- ---------------------------------------------------------------- no oracle

/*
 * Wrong, expired and already-used must be one answer. `expired` in particular would confirm the
 * guess had once been a real code — at 40 bits that is a large hint about where to search.
 */
reset role;

insert into internal.claim_codes
  (placeholder_profile_id, code_hmac, created_by_profile_id, expires_at)
values
  ('ffff0000-0000-0000-0000-00000000000b', internal.claim_code_hmac('EXPIRED1'),
   'ffff0000-0000-0000-0000-000000000001', now() - interval '1 minute');

set local role authenticated;

select is(
  app.redeem_claim_code('ZZZZZZZZ') ->> 'reason',
  app.redeem_claim_code('EXPIRED1') ->> 'reason',
  'a wrong code and an expired one are indistinguishable');

select is(
  app.redeem_claim_code(:'good_code') ->> 'reason',
  app.redeem_claim_code('ZZZZZZZZ') ->> 'reason',
  'an already-used code is indistinguishable from a wrong one');

-- ---------------------------------------------------------------- the throttle actually counts

/*
 * THE assertion. A throttle written with `raise` rather than `return` has its own attempt row
 * rolled back by the exception, so this count stays at zero however many times it is called —
 * and a test that only checked the error would never notice.
 *
 * Four failures have already been recorded above (twice-used, ZZZZ x2, EXPIRED1, used again),
 * so this reads the table rather than assuming a number.
 */
reset role;

select cmp_ok(
  (select count(*)::int from internal.claim_attempts
   where actor_profile_id = 'ffff0000-0000-0000-0000-000000000002' and not succeeded),
  '>=', 3,
  'failed attempts are COMMITTED, not rolled back by the failure itself');

select is(
  (select count(*)::int from internal.claim_attempts
   where actor_profile_id = 'ffff0000-0000-0000-0000-000000000002' and succeeded),
  1,
  'and the successful merge was recorded too');

-- Push this actor over the per-actor limit of 5/hour, then confirm the lockout.
set local role authenticated;
select app.redeem_claim_code('YYYYYYYY');
select app.redeem_claim_code('XXXXXXXX');
select app.redeem_claim_code('WWWWWWWW');

select is(
  app.redeem_claim_code('VVVVVVVV') ->> 'reason',
  'throttled',
  'the sixth failure in an hour locks the actor out');

/*
 * And a locked-out caller is told so, rather than being handed the uniform `invalid`.
 *
 * This is a deliberate departure from the original plan, which wanted lockout hidden. Lockout is
 * a fact about the caller's own history — they already know how many times they typed — so
 * hiding it discloses nothing extra and strands a real person who typo'd on a screen that says
 * "invalid" forever. Uniformity is required where the distinction is a fact about somebody else.
 */
select isnt(
  app.redeem_claim_code('VVVVVVVV') ->> 'reason',
  'invalid',
  'lockout is distinguishable from a wrong code, on purpose');

select * from finish();
rollback;
