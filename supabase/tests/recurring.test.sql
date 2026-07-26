-- Recurring expenses: the rent must post once, on the right day, in the right month.
--
-- The two assertions that carry the feature are the double-run guard and the February clamp.
-- Both are failures you would only notice from a user complaint — rent charged twice, or a
-- monthly rule that silently skipped a month — so they are tested directly rather than through
-- the cron job that will call this.

begin;
select plan(13);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a9');
delete from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a9';
insert into public.profiles (id, user_id, display_name) values
  ('aaee0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a9', 'Ravi');
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('aaee0000-0000-0000-0000-000000000002', 'Flatmate', 'aaee0000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- the clamp

/*
 * A rule set on the 31st has to survive months that do not have one. Without the clamp it
 * either errors or rolls into the next month, and "rent posted on 3 March" is the kind of bug
 * that quietly desynchronises a rule forever.
 */
select is(
  app.next_recurrence('2026-01-31'::date, 'monthly', 1, 31::smallint),
  '2026-02-28'::date,
  'a monthly rule on the 31st clamps to 28 February');

select is(
  app.next_recurrence('2026-02-28'::date, 'monthly', 1, 31::smallint),
  '2026-03-31'::date,
  'and springs back to the 31st in March — the clamp does not become the new day');

select is(
  app.next_recurrence('2024-01-31'::date, 'monthly', 1, 31::smallint),
  '2024-02-29'::date,
  'a leap year gets the 29th');

select is(
  app.next_recurrence('2026-07-26'::date, 'weekly', 2, null),
  '2026-08-09'::date,
  'a fortnightly rule adds two weeks');

-- ---------------------------------------------------------------- posting

insert into public.recurring_expense_rules
  (id, group_id, template, frequency, interval_count, day_of_month, start_on, timezone,
   next_run_on, created_by_profile_id)
values (
  'bbee0000-0000-0000-0000-000000000001',
  null,
  jsonb_build_object(
    'description', 'Rent',
    'amount_minor', 2400000,
    'split_type', 'equal',
    'payers', jsonb_build_array(
      jsonb_build_object('profile_id','aaee0000-0000-0000-0000-000000000001','paid_amount_minor',2400000)),
    'splits', jsonb_build_array(
      jsonb_build_object('profile_id','aaee0000-0000-0000-0000-000000000001','share_amount_minor',1200000),
      jsonb_build_object('profile_id','aaee0000-0000-0000-0000-000000000002','share_amount_minor',1200000))),
  'monthly', 1, 1::smallint, '2026-01-01', 'Asia/Kolkata',
  -- Due yesterday, so this tick must post it.
  (now() at time zone 'Asia/Kolkata')::date - 1,
  'aaee0000-0000-0000-0000-000000000001');

select is(
  (app.run_due_recurring_expenses() ->> 'posted')::int,
  1,
  'a rule that is due posts its expense');

select is(
  (select count(*)::int from public.expenses where description = 'Rent' and deleted_at is null),
  1,
  'and the expense really exists');

select is(
  (select count(*)::int from public.expense_splits s
   join public.expenses e on e.id = s.expense_id
   where e.description = 'Rent'),
  2,
  'split between both flatmates, from the template');

select isnt(
  (select expense_id from public.recurring_expense_runs
   where rule_id = 'bbee0000-0000-0000-0000-000000000001'),
  null,
  'the run row is linked to what it produced');

-- ---------------------------------------------------------------- THE double-run guard

/*
 * The assertion this feature lives or dies on. Cron retries happen — a timeout, an overlapping
 * tick, someone re-running the job during an incident. Rent must not post twice.
 */
select is(
  (app.run_due_recurring_expenses() ->> 'posted')::int,
  0,
  'running the job again immediately posts NOTHING');

select is(
  (select count(*)::int from public.expenses where description = 'Rent' and deleted_at is null),
  1,
  'and there is still exactly one rent expense — the composite key held');

select cmp_ok(
  (select next_run_on from public.recurring_expense_rules
   where id = 'bbee0000-0000-0000-0000-000000000001'),
  '>', (now() at time zone 'Asia/Kolkata')::date,
  'the cursor advanced, so the rule does not re-evaluate the same date forever');

-- ---------------------------------------------------------------- paused and bounded rules

update public.recurring_expense_rules
   set is_paused = true, next_run_on = (now() at time zone 'Asia/Kolkata')::date - 1
 where id = 'bbee0000-0000-0000-0000-000000000001';

select is(
  (app.run_due_recurring_expenses() ->> 'posted')::int,
  0,
  'a paused rule posts nothing even when overdue');

update public.recurring_expense_rules
   set is_paused = false, end_on = '2020-01-01', next_run_on = '2026-07-01'
 where id = 'bbee0000-0000-0000-0000-000000000001';

select is(
  (app.run_due_recurring_expenses() ->> 'posted')::int,
  0,
  'and a rule past its end date stops rather than back-filling');

select * from finish();
rollback;
