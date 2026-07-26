-- The notification pipeline: who hears about what, and how little of it.
--
-- Almost every assertion here is about NOT sending something. That is the point — the failure
-- mode of a push pipeline is not silence, it is eleven buzzes for one sitting of data entry,
-- and the user's response to that is to turn notifications off permanently. Each storm control
-- is tested by counting rows in `internal.notification_queue` directly, because the queue is
-- where the decision is made; asserting on what the dispatcher would send would let a broken
-- control pass so long as the dispatcher happened to filter it.

begin;
select plan(29);

-- ---------------------------------------------------------------- fixtures

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'),   -- Ann, does things
  ('00000000-0000-0000-0000-0000000000e2'),   -- Bo, hears about them
  ('00000000-0000-0000-0000-0000000000e3');   -- Cy, has opinions about being told

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-0000000000e2',
  '00000000-0000-0000-0000-0000000000e3');

insert into public.profiles (id, user_id, display_name) values
  ('eeee1111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'Ann'),
  ('eeee1111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'Bo'),
  ('eeee1111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e3', 'Cy');

insert into public.groups (id, name, created_by_profile_id) values
  ('e0000000-0000-0000-0000-000000000001', 'Goa', 'eeee1111-0000-0000-0000-000000000001');
-- Creating a group does not by itself make you a member; add_group_members asserts membership.
insert into public.group_members (group_id, profile_id, role) values
  ('e0000000-0000-0000-0000-000000000001', 'eeee1111-0000-0000-0000-000000000001', 'owner');

-- A helper: emit one change event as if a write RPC had.
create or replace function pg_temp.emit(
  p_recipient uuid, p_actor uuid, p_group uuid, p_type text, p_entity uuid, p_op text)
returns void language sql as $$
  insert into internal.change_events
    (recipient_profile_id, actor_profile_id, group_id, entity_type, entity_id, op)
  values (p_recipient, p_actor, p_group, p_type, p_entity, p_op);
$$;

-- ---------------------------------------------------------------- the actor filter

/*
 * The rule that moved. 0023 deliberately removed the actor filter from `emit_change` so a
 * second device on the same account could learn about the first one's writes — which means the
 * ONLY thing standing between a user and a push about their own tap is this trigger.
 */
select pg_temp.emit('eeee1111-0000-0000-0000-000000000001', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-000000000001', 'insert');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000001'),
  0,
  'nobody is notified about their own action');

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-000000000001', 'insert');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002'),
  1,
  'but the other participant is');

select is(
  (select body from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002'),
  'Ann added an expense',
  'and the message names who did it');

select cmp_ok(
  (select not_before from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002'),
  '>', now() + interval '30 seconds',
  'held back ~45s so more of the same can join it');

-- ---------------------------------------------------------------- coalescing

/*
 * THE assertion this whole design exists for. Ten more expenses from the same person in the
 * same group must not become ten more notifications.
 */
do $$
begin
  for i in 1..10 loop
    perform pg_temp.emit('eeee1111-0000-0000-0000-000000000002',
                         'eeee1111-0000-0000-0000-000000000001',
                         'e0000000-0000-0000-0000-000000000001', 'expense',
                         extensions.gen_random_uuid(), 'insert');
  end loop;
end $$;

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002'),
  1,
  'eleven expenses in one sitting are ONE queued notification, not eleven');

-- A different group is a different sentence, so it must not be folded in.
insert into public.groups (id, name, created_by_profile_id) values
  ('e0000000-0000-0000-0000-000000000002', 'Flat', 'eeee1111-0000-0000-0000-000000000001');

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000002', 'expense',
                    'e1000000-0000-0000-0000-000000000009', 'insert');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002'),
  2,
  'a different group is a separate notification — collapsing them would misreport which trip');

-- ---------------------------------------------------------------- the drain summarises

select is(
  (select count(*)::int from internal.claim_due_notifications(100)),
  0,
  'nothing is claimable yet: the 45-second hold has not elapsed');

-- Pull the hold forward rather than waiting 45 real seconds.
update internal.notification_queue set not_before = now() - interval '1 second';

select is(
  (select count(*)::int from internal.claim_due_notifications(100)),
  2,
  'once due, the two groups claim as two messages');

/*
 * Two rows marked, not twelve — because the queue never held twelve.
 *
 * Worth stating explicitly, because there were two ways to build this and only one is safe.
 * The collapsing could have happened at DRAIN time, with all eleven events queued and the
 * drainer summarising them. It happens at ENQUEUE time instead: the eleventh expense updates
 * the row already waiting rather than inserting a twelfth. So the queue's size is bounded by
 * the number of distinct conversations, not by how fast somebody is typing — which is what
 * stops a bulk import from becoming a table scan every thirty seconds.
 */
select is(
  (select count(*)::int from internal.notification_queue where status = 'sending'),
  2,
  'and the queue only ever HELD two rows — coalescing happens at enqueue, not at drain');

-- ---------------------------------------------------------------- preferences

update internal.notification_queue set status = 'sent';

insert into public.notification_prefs (profile_id, new_expenses) values
  ('eeee1111-0000-0000-0000-000000000003', false);

select pg_temp.emit('eeee1111-0000-0000-0000-000000000003', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-000000000002', 'insert');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000003' and status <> 'sent'),
  0,
  'somebody who turned new expenses off gets nothing');

/*
 * The absent-row case, which is the common one: a profile that has never opened Settings has no
 * prefs row at all, and must still be notified. Defaulting to silence would mean every new user
 * hears nothing until they go looking for a setting they do not know exists.
 */
select is(
  internal.wants_notification('eeee1111-0000-0000-0000-000000000002', 'expense_added'),
  true,
  'no prefs row means unset, not off');

-- ---------------------------------------------------------------- quiet hours

update public.notification_prefs
   set quiet_hours_start = '22:00', quiet_hours_end = '07:00'
 where profile_id = 'eeee1111-0000-0000-0000-000000000003';

insert into public.device_tokens (profile_id, expo_push_token, platform, device_id, timezone)
values ('eeee1111-0000-0000-0000-000000000003', 'ExponentPushToken[cy]', 'ios', 'dev-cy', 'Asia/Kolkata');

/*
 * A window that wraps midnight is the normal case and the one a naive BETWEEN silently gets
 * wrong: 22:00–07:00 is two intervals on a clock face, so `t >= 22:00 and t < 07:00` is never
 * true and quiet hours would simply never fire.
 */
select cmp_ok(
  internal.next_sendable_at('eeee1111-0000-0000-0000-000000000003',
                            '2026-07-26 18:00:00+00'),  -- 23:30 IST, inside quiet hours
  '>', '2026-07-26 18:00:00+00'::timestamptz,
  'a push at 23:30 local is deferred');

select is(
  to_char(internal.next_sendable_at('eeee1111-0000-0000-0000-000000000003',
                                    '2026-07-26 18:00:00+00') at time zone 'Asia/Kolkata',
          'HH24:MI'),
  '07:00',
  'and lands exactly at the end of the window, local time');

select is(
  internal.next_sendable_at('eeee1111-0000-0000-0000-000000000003',
                            '2026-07-26 09:00:00+00'),  -- 14:30 IST, wide awake
  '2026-07-26 09:00:00+00'::timestamptz,
  'a push in the afternoon is not delayed at all');

select is(
  internal.next_sendable_at('eeee1111-0000-0000-0000-000000000002',
                            '2026-07-26 18:00:00+00'),
  '2026-07-26 18:00:00+00'::timestamptz,
  'and somebody with no quiet hours set is never held back');

-- ---------------------------------------------------------------- the edit rule

update internal.notification_queue set status = 'sent';

insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
values ('e1000000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-000000000001',
        'Dinner', 100000, 'equal', current_date, 'eeee1111-0000-0000-0000-000000000001');

/*
 * A revision whose only change was the description: `shares_changed` is empty. Nobody's money
 * moved, so nobody is told. This is the difference between notifications people keep and
 * notifications people switch off.
 */
insert into public.expense_revisions (expense_id, revision, action, actor_profile_id, snapshot, diff)
values ('e1000000-0000-0000-0000-00000000000e', 2, 'updated', 'eeee1111-0000-0000-0000-000000000001',
        '{}'::jsonb, jsonb_build_object('fields', '{}'::jsonb, 'shares_changed', '[]'::jsonb));

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-00000000000e', 'update');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002' and status <> 'sent'),
  0,
  'fixing a typo in the description notifies NOBODY');

-- Now a revision where Bo's share actually moved.
insert into public.expense_revisions (expense_id, revision, action, actor_profile_id, snapshot, diff)
values ('e1000000-0000-0000-0000-00000000000e', 3, 'updated', 'eeee1111-0000-0000-0000-000000000001',
        '{}'::jsonb, jsonb_build_object(
          'fields', '{}'::jsonb,
          'shares_changed', jsonb_build_array('eeee1111-0000-0000-0000-000000000002')));

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-00000000000e', 'update');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002' and status <> 'sent'),
  1,
  'but changing what somebody owes does reach them');

-- Cy was NOT in shares_changed, so the same event says nothing to him.
select pg_temp.emit('eeee1111-0000-0000-0000-000000000003', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-00000000000e', 'update');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000003' and status <> 'sent'),
  0,
  'and a participant whose own share did not move hears nothing about the same edit');

-- ---------------------------------------------------------------- added and removed people
--
-- The case `app.expense_diff` used to get exactly backwards. Its `union ... having count(*) > 1`
-- caught anyone whose amount CHANGED but silently dropped anyone who appeared on only one side —
-- so the two people whose share moved most, from nothing to something or the reverse, were the
-- two it reported as unaffected. 0031 replaced it with a full outer join.

select is(
  (app.expense_diff(
     jsonb_build_object('expense', '{}'::jsonb,
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000'))),
     jsonb_build_object('expense', '{}'::jsonb,
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000'),
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000002','share_amount_minor','5000')))
   ) -> 'shares_changed'),
  jsonb_build_array('eeee1111-0000-0000-0000-000000000002'),
  'somebody ADDED to an expense is in shares_changed — they went from nothing to owing');

select is(
  (app.expense_diff(
     jsonb_build_object('expense', '{}'::jsonb,
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000'),
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000003','share_amount_minor','5000'))),
     jsonb_build_object('expense', '{}'::jsonb,
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000')))
   ) -> 'shares_changed'),
  jsonb_build_array('eeee1111-0000-0000-0000-000000000003'),
  'and somebody REMOVED is too — they stopped owing, which they should hear about');

select is(
  (app.expense_diff(
     jsonb_build_object('expense', '{}'::jsonb,
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000'))),
     jsonb_build_object('expense', jsonb_build_object('description','new'),
       'splits', jsonb_build_array(
         jsonb_build_object('profile_id','eeee1111-0000-0000-0000-000000000001','share_amount_minor','5000')))
   ) -> 'shares_changed'),
  '[]'::jsonb,
  'but an unchanged split set still reports nobody — the typo-fix case still holds');

-- ---------------------------------------------------------------- being added to a group

/*
 * `add_group_members` used to emit one `group`/`update` to everybody, and 0028 maps only
 * `group`/`insert` to `group_added` — so the person just added got the same "something changed"
 * event as the people who were already there, and was never actually told the group exists.
 */
update internal.notification_queue set status = 'sent';

select app.add_group_members(
  'e0000000-0000-0000-0000-000000000001',
  array['eeee1111-0000-0000-0000-000000000003']::uuid[],
  'ee999999-0000-0000-0000-000000000001'
) from (select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true)) _;

/*
 * Cy is the right person to assert this on, and not by accident: he turned `new_expenses` off
 * at line ~154. Before 0032, `group_added` was mapped onto that same column, so this assertion
 * failed — he was never told the group existed, and expenses then started appearing in it from
 * an app that had never mentioned it. Muting the chatter must not hide the room.
 */
select is(
  (select kind from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000003' and status <> 'sent'),
  'group_added',
  'the person just added to a group is told so, even with new expenses switched off');

select is(
  internal.wants_notification('eeee1111-0000-0000-0000-000000000003', 'expense_added'),
  false,
  'and the switch he DID set still holds — this is independence, not a blanket override');

-- The column is genuinely wired, rather than `group_added` having quietly become unconditional.
-- An un-refusable category is how people end up turning the OS permission off, which silences
-- all six.
update public.notification_prefs
   set group_adds = false
 where profile_id = 'eeee1111-0000-0000-0000-000000000003';

select is(
  internal.wants_notification('eeee1111-0000-0000-0000-000000000003', 'group_added'),
  false,
  'and somebody who does not want to hear about group adds can say so');

-- ---------------------------------------------------------------- the held row still absorbs
--
-- The storm the rate limit was supposed to stop, and used to reproduce an hour late.
--
-- The per-key check filtered on `created_at > now() - 60 seconds`. Anything held longer than
-- that — by the hourly cap, by quiet hours, by a requeue — aged out of its own coalescing
-- window while still sitting undelivered in the queue, so the next event queued a SECOND row
-- with a later `not_before`. Two rows under one key that come due at different times are two
-- pushes, because the drain can only collapse what is due together. 0033 tests `not_before`
-- instead: a row that has not gone out cannot have gone out, whatever its age.

update internal.notification_queue set status = 'sent';

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-00000000001a', 'insert');

-- Old enough to have fallen out of the wall-clock window, still undelivered. This is exactly
-- the state the hourly cap puts a row in, without having to queue twenty to get there.
update internal.notification_queue
   set created_at = now() - interval '10 minutes',
       not_before = now() + interval '30 minutes'
 where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002' and status = 'pending';

select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'expense',
                    'e1000000-0000-0000-0000-00000000001b', 'insert');

select is(
  (select count(*)::int from internal.notification_queue
   where recipient_profile_id = 'eeee1111-0000-0000-0000-000000000002' and status = 'pending'),
  1,
  'an event arriving while a row for the same key is still held joins it, however old it is');

-- ---------------------------------------------------------------- the purge
--
-- Four append-only tables, none of which deleted anything before 0033.

update internal.notification_queue set status = 'sent';

-- A settled notification and the change event behind it, both a month past.
select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000001', 'comment',
                    'e1000000-0000-0000-0000-0000000000c1', 'insert');

update internal.notification_queue
   set status = 'sent', created_at = now() - interval '40 days'
 where status = 'pending';
update internal.change_events
   set created_at = now() - interval '40 days'
 where entity_id = 'e1000000-0000-0000-0000-0000000000c1';

-- And one that was never delivered, equally old. `notification_queue.event_id` cascades on
-- delete, so purging its change event would take the undelivered notification with it —
-- silently, which is the failure mode this phase already shipped once as `digest`.
select pg_temp.emit('eeee1111-0000-0000-0000-000000000002', 'eeee1111-0000-0000-0000-000000000001',
                    'e0000000-0000-0000-0000-000000000002', 'comment',
                    'e1000000-0000-0000-0000-0000000000c2', 'insert');

update internal.change_events
   set created_at = now() - interval '40 days'
 where entity_id = 'e1000000-0000-0000-0000-0000000000c2';

select internal.purge_sync_spine();

select is(
  (select count(*)::int from internal.change_events
   where entity_id = 'e1000000-0000-0000-0000-0000000000c1'),
  0,
  'a change event past retention, with nothing undelivered behind it, is purged');

select is(
  (select count(*)::int from internal.change_events
   where entity_id = 'e1000000-0000-0000-0000-0000000000c2'),
  1,
  'but one still pinned by an undelivered notification is held back, cascade and all');

select is(
  (select count(*)::int from internal.notification_queue where status = 'pending'),
  1,
  'and the undelivered notification itself survives — a purge must never be a silent drop');

-- ---------------------------------------------------------------- dead tokens

select internal.disable_push_token('ExponentPushToken[cy]', 'DeviceNotRegistered');

select is(
  (select disabled_reason from public.device_tokens where expo_push_token = 'ExponentPushToken[cy]'),
  'DeviceNotRegistered',
  'a token Expo reports as dead is disabled with its reason, not deleted');

select * from finish();
rollback;
