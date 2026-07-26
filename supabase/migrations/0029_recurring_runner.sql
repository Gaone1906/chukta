-- Phase 9 — post the expenses that are due.
--
-- 0015 built `recurring_expense_rules`, `recurring_expense_runs` and `app.next_recurrence`
-- (which already clamps a 31st rule into February). What was missing is the thing that runs.
--
-- ---------------------------------------------------------------- the two failure modes
--
-- Rent is the canonical case, and it has exactly two ways to go wrong, in opposite directions:
--
-- **Posting twice.** A cron tick that overlaps a slow previous tick, a retry after a timeout, a
-- manual re-run during an incident. `recurring_expense_runs` has `PRIMARY KEY (rule_id, run_on)`
-- and that composite key is the entire guard: the second attempt hits a unique violation and is
-- swallowed, so the answer to "did this already post?" is a constraint rather than a check that
-- can race. **Insert the run row BEFORE creating the expense** — reversing those two makes the
-- guard useless, because a crash between them leaves the expense posted and unclaimed.
--
-- **Not posting at all.** Silence looks identical to "nothing was due", so a rule that throws
-- must not take the others down with it. Each rule is its own BEGIN/EXCEPTION block: one bad
-- template stops that rule, not the month's rent for everybody else.
--
-- ---------------------------------------------------------------- local midnight, not UTC
--
-- Each rule carries its own `timezone`, and "the 1st of the month" means the 1st *there*. A
-- runner that compared `next_run_on <= current_date` in UTC would fire Indian rules at 05:30
-- local on the right day and Californian ones on the day before — so the comparison is against
-- the current date IN THE RULE'S ZONE. This is why the job runs hourly rather than daily: it
-- has to be able to notice local midnight wherever the user is.

create or replace function app.run_due_recurring_expenses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule      public.recurring_expense_rules%rowtype;
  v_today     date;
  v_expense   uuid;
  v_posted    int := 0;
  v_skipped   int := 0;
  v_failed    int := 0;
  v_payload   jsonb;
  v_count     int;
begin
  for v_rule in
    select * from public.recurring_expense_rules
    where not is_paused
    order by id
  loop
    begin
      -- Today, where the rule lives.
      v_today := (now() at time zone v_rule.timezone)::date;

      if v_rule.next_run_on > v_today then
        continue;
      end if;

      if v_rule.end_on is not null and v_rule.next_run_on > v_rule.end_on then
        continue;
      end if;

      if v_rule.max_occurrences is not null then
        select count(*)::int into v_count
        from public.recurring_expense_runs where rule_id = v_rule.id;
        if v_count >= v_rule.max_occurrences then
          continue;
        end if;
      end if;

      /*
       * The claim, before the work.
       *
       * `on conflict do nothing` + `found` is what makes a retry safe: a second runner racing
       * this one inserts nothing and skips, rather than both proceeding to post rent. Because
       * this is written first, a crash before the expense exists leaves a claimed run with a
       * null expense_id — recoverable and visible, which is the right way round. The opposite
       * order would leave a real expense that no run row accounts for, and the next tick would
       * post it again.
       */
      insert into public.recurring_expense_runs (rule_id, run_on)
      values (v_rule.id, v_rule.next_run_on)
      on conflict (rule_id, run_on) do nothing;

      if not found then
        v_skipped := v_skipped + 1;

        -- Still advance the cursor, or a rule whose run was already claimed re-evaluates the
        -- same date on every tick forever.
        update public.recurring_expense_rules
           set next_run_on = app.next_recurrence(
                 v_rule.next_run_on, v_rule.frequency, v_rule.interval_count, v_rule.day_of_month)
         where id = v_rule.id;
        continue;
      end if;

      -- The template is a `create_expense` payload minus the date, which is this run's.
      v_payload := v_rule.template
        || jsonb_build_object(
             'id', extensions.gen_random_uuid(),
             'spent_on', v_rule.next_run_on,
             'group_id', v_rule.group_id);

      /*
       * Posted AS the rule's author, not as whoever's cron tick happened to run it.
       *
       * `create_expense` reads `auth_ext.assert_signed_in()`, and there is no session here — so
       * the author's claims are set for the duration of this one call. That also means the
       * rule cannot outlive its author's authorisation: if they lose access to the group, the
       * same check that would stop them adding an expense by hand stops the rule too.
       */
      perform set_config('request.jwt.claims',
        json_build_object(
          'sub', (select user_id from public.profiles where id = v_rule.created_by_profile_id),
          'role', 'authenticated')::text, true);

      v_expense := (app.create_expense(v_payload, extensions.gen_random_uuid()) ->> 'expense_id')::uuid;

      update public.recurring_expense_runs
         set expense_id = v_expense
       where rule_id = v_rule.id and run_on = v_rule.next_run_on;

      update public.recurring_expense_rules
         set last_run_on = v_rule.next_run_on,
             next_run_on = app.next_recurrence(
               v_rule.next_run_on, v_rule.frequency, v_rule.interval_count, v_rule.day_of_month)
       where id = v_rule.id;

      v_posted := v_posted + 1;

    exception when others then
      -- One rule's bad template must not stop everybody else's rent. Recorded, then onward.
      v_failed := v_failed + 1;
      raise warning 'recurring rule % failed: %', v_rule.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('posted', v_posted, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;

revoke all on function app.run_due_recurring_expenses() from public, anon, authenticated;

notify pgrst, 'reload schema';
