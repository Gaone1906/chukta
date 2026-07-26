-- The notification pipeline: who hears about what, and how little of it.
--
-- Almost every assertion here is about NOT sending something. That is the point — the failure
-- mode of a push pipeline is not silence, it is eleven buzzes for one sitting of data entry,
-- and the user's response to that is to turn notifications off permanently. Each storm control
-- is tested by counting rows in `internal.notification_queue` directly, because the queue is
-- where the decision is made; asserting on what the dispatcher would send would let a broken
-- control pass so long as the dispatcher happened to filter it.

begin;
select plan(19);

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

-- ---------------------------------------------------------------- dead tokens

select internal.disable_push_token('ExponentPushToken[cy]', 'DeviceNotRegistered');

select is(
  (select disabled_reason from public.device_tokens where expo_push_token = 'ExponentPushToken[cy]'),
  'DeviceNotRegistered',
  'a token Expo reports as dead is disabled with its reason, not deleted');

select * from finish();
rollback;
