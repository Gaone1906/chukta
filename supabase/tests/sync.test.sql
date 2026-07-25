-- Phase 8's backend: the sync spine, and who is allowed to listen to it.
--
-- Two things make this file different from the others.
--
-- **`realtime.send` cannot fail.** Its body is wrapped in `EXCEPTION WHEN OTHERS THEN RAISE
-- WARNING`, so a broadcast that is denied by RLS, lands on a missing partition, or is
-- malformed looks *identical to success* from the caller's side. `lives_ok` on a write RPC
-- therefore proves nothing about whether anything was broadcast. Every assertion here reads
-- `realtime.messages` back.
--
-- **The realtime schema is not ours.** `realtime.messages` and `realtime.send` are installed by
-- the Realtime server's own tenant migrations, so they are absent wherever Postgres runs alone
-- — which is exactly how CI runs (`supabase db start`, not `supabase start`). Those assertions
-- are skipped there rather than quietly passing, so "we never tested it" and "we tested it and
-- it worked" stay distinguishable.

begin;
select plan(17);

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a8'),   -- Ann, does everything
  ('00000000-0000-0000-0000-0000000000b8'),   -- Bob, on the expense
  ('00000000-0000-0000-0000-0000000000c8');   -- Cy, in the group but NOT on the expense

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000a8',
  '00000000-0000-0000-0000-0000000000b8',
  '00000000-0000-0000-0000-0000000000c8');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a8', 'Ann'),
  ('bbbbbbbb-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000b8', 'Bob'),
  ('cccccccc-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c8', 'Cy');

-- Ann has to share a context with Bob and Cy before she may put them in a group, so give her
-- one: a prior one-off expense the three of them were on.
select app.create_expense(
  jsonb_build_object(
    'description', 'Context-setting chai',
    'amount_minor', 300,
    'split_type', 'equal',
    'spent_on', current_date,
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id', 'aaaaaaaa-0000-0000-0000-0000000000a8', 'paid_amount_minor', 300)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id', 'aaaaaaaa-0000-0000-0000-0000000000a8', 'share_amount_minor', 100),
      jsonb_build_object('profile_id', 'bbbbbbbb-0000-0000-0000-0000000000b8', 'share_amount_minor', 100),
      jsonb_build_object('profile_id', 'cccccccc-0000-0000-0000-0000000000c8', 'share_amount_minor', 100))
  ),
  '11111111-0000-0000-0000-0000000000a8'
) from (select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}', true)) _;

-- ---------------------------------------------------------------- fan-out

-- The expense that matters: a brand-new group containing Cy, who is on no split at all.
select app.create_expense(
  jsonb_build_object(
    'id', 'eeee8888-0000-0000-0000-000000000001',
    'description', 'Trip kitty',
    'amount_minor', 200000,
    'split_type', 'equal',
    'spent_on', current_date,
    'new_group', jsonb_build_object(
      'id', 'a5a5a5a5-0000-0000-0000-000000000008',
      'name', 'Manali',
      'member_profile_ids', jsonb_build_array(
        'bbbbbbbb-0000-0000-0000-0000000000b8',
        'cccccccc-0000-0000-0000-0000000000c8')),
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id', 'aaaaaaaa-0000-0000-0000-0000000000a8', 'paid_amount_minor', 200000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id', 'aaaaaaaa-0000-0000-0000-0000000000a8', 'share_amount_minor', 100000),
      jsonb_build_object('profile_id', 'bbbbbbbb-0000-0000-0000-0000000000b8', 'share_amount_minor', 100000))
  ),
  '22222222-0000-0000-0000-0000000000a8'
);

select is(
  (select count(*) from internal.change_events
   where entity_id = 'eeee8888-0000-0000-0000-000000000001'
     and recipient_profile_id = 'aaaaaaaa-0000-0000-0000-0000000000a8'),
  1::bigint,
  'the actor receives their own expense event — without it a second device can never catch up'
);

select is(
  (select count(*) from internal.change_events
   where entity_id = 'eeee8888-0000-0000-0000-000000000001'),
  2::bigint,
  'and the other participant does too; Cy is on no split, so gets no expense event'
);

-- The gap this phase closed. Cy is a full row in group_members and was told nothing at all:
-- not by broadcast, and not by sync_pull either, since both read this table.
select is(
  (select count(*) from internal.change_events
   where entity_type = 'group'
     and entity_id = 'a5a5a5a5-0000-0000-0000-000000000008'
     and op = 'insert'
     and recipient_profile_id = 'cccccccc-0000-0000-0000-0000000000c8'),
  1::bigint,
  'a member of the new group who is on no split still learns the group exists'
);

select is(
  (select count(*) from internal.change_events
   where entity_type = 'group'
     and entity_id = 'a5a5a5a5-0000-0000-0000-000000000008'
     and op = 'insert'),
  3::bigint,
  'the inline new_group path now fans out to every member, matching create_group'
);

-- ---------------------------------------------------------------- growing a group

select app.add_group_members(
  'a5a5a5a5-0000-0000-0000-000000000008',
  array['bbbbbbbb-0000-0000-0000-0000000000b8']::uuid[],  -- already a member: adds nobody
  '33333333-0000-0000-0000-0000000000a8'
);

select is(
  (select count(*) from internal.change_events
   where entity_type = 'group' and op = 'update'
     and recipient_profile_id = 'cccccccc-0000-0000-0000-0000000000c8'),
  1::bigint,
  'someone already in the group hears about the roster changing, not just the new arrival'
);

-- ---------------------------------------------------------------- the delta cursor

select ok(
  (select (app.sync_pull(0, 500) -> 'events') @> jsonb_build_array(
     jsonb_build_object('entity_id', 'eeee8888-0000-0000-0000-000000000001', 'op', 'insert'))
   from (select set_config('request.jwt.claims',
     '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}', true)) _),
  'sync_pull hands the actor back their own write, which is what makes a two-device account converge'
);

select ok(
  (select (app.sync_pull(0, 500) ->> 'cursor')::bigint
        > (select coalesce(min(id), 0) from internal.change_events)),
  'the cursor advances past what it returned'
);

select is(
  (select jsonb_array_length(
     app.sync_pull((select max(id) from internal.change_events), 500) -> 'events')),
  0,
  'and asking again from that cursor returns nothing'
);

-- ---------------------------------------------------------------- broadcast

-- Gated on the realtime schema being present AND having a partition covering today: a missing
-- partition makes every send a silent no-op, which would read as "the trigger is broken".
select case
  when to_regclass('realtime.messages') is null then 'false'
  when not exists (
    select 1 from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    where i.inhparent = 'realtime.messages'::regclass
      and pg_get_expr(c.relpartbound, c.oid) like '%' || current_date::text || '%'
  ) then 'false'
  else 'true'
end as has_realtime \gset

\if :has_realtime

select is(
  (select count(*) from realtime.messages
   where topic = 'sync:cccccccc-0000-0000-0000-0000000000c8'
     and event = 'change'
     and payload->>'entity_type' = 'group'),
  2::bigint,
  'every change event is mirrored onto its recipient''s own topic'
);

select is(
  (select payload->>'event_id' from realtime.messages
   where topic = 'sync:aaaaaaaa-0000-0000-0000-0000000000a8'
     and payload->>'entity_id' = 'eeee8888-0000-0000-0000-000000000001'),
  (select id::text from internal.change_events
   where recipient_profile_id = 'aaaaaaaa-0000-0000-0000-0000000000a8'
     and entity_id = 'eeee8888-0000-0000-0000-000000000001'),
  'the broadcast carries the same cursor sync_pull uses, so a live client never needs a round trip to advance'
);

select is(
  (select count(*) from realtime.messages where topic = 'sync:aaaaaaaa-0000-0000-0000-0000000000a8'
     and payload ? 'recipient_profile_id'),
  0::bigint,
  'the recipient is the topic, so it is not repeated in the body'
);

-- The authorisation half. Realtime decides whether you may subscribe by inserting a probe row
-- and asking whether you can read it back, with `realtime.topic` set to the topic you asked
-- for — so this is the real check, not an approximation of it.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}', true);

select set_config('realtime.topic', 'sync:aaaaaaaa-0000-0000-0000-0000000000a8', true);
select isnt(
  (select count(*) from realtime.messages),
  0::bigint,
  'Ann can read her own topic, which is what lets the subscribe succeed'
);

select set_config('realtime.topic', 'sync:bbbbbbbb-0000-0000-0000-0000000000b8', true);
select is(
  (select count(*) from realtime.messages),
  0::bigint,
  'and reads nothing at all on Bob''s — a broadcast bypasses the read policies, so the topic is the only gate'
);

select throws_ok(
  $$insert into realtime.messages (topic, extension, event, payload, private)
    values ('sync:aaaaaaaa-0000-0000-0000-0000000000a8', 'broadcast', 'change', '{}'::jsonb, true)$$,
  '42501',
  null,
  'and cannot forge one onto it: the policy is SELECT-only, so every change event originates in a money write'
);

reset role;

\else

select skip(
  'Realtime is not installed in this database — CI runs `supabase db start`, which is Postgres alone. '
  'The migration guards on the same condition, so the trigger degrades to a no-op rather than failing writes.',
  6);

\endif

-- ---------------------------------------------------------------- client-generated ids

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}';
set local role authenticated;

select is(
  app.upsert_contact_profile('Nikhil', null, null,
    'f00df00d-0000-0000-0000-000000000008', '44444444-0000-0000-0000-0000000000a8'),
  'f00df00d-0000-0000-0000-000000000008'::uuid,
  'a placeholder can be given the id the client already put on an offline expense'
);

select is(
  app.upsert_contact_profile('Nikhil', null, null,
    'f00df00d-0000-0000-0000-000000000008', '44444444-0000-0000-0000-0000000000a8'),
  'f00df00d-0000-0000-0000-000000000008'::uuid,
  'and replaying that mutation returns the same person rather than a second stranger with the same name'
);

select throws_ok(
  $$select app.upsert_contact_profile('Impostor', null, null,
      'bbbbbbbb-0000-0000-0000-0000000000b8', null)$$,
  '42501',
  null,
  'but naming somebody else''s profile id is refused, so this cannot be used to test whether an id exists'
);

reset role;

select * from finish();
rollback;
