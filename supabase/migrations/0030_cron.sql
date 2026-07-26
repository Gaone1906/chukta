-- Phase 9 — the clock.
--
-- Four jobs. Everything they call already exists and is already tested; this file only decides
-- how often, and how the database is allowed to reach the outside world.
--
-- ---------------------------------------------------------------- no secrets in this file
--
-- The dispatcher needs a function URL and a service key. **Neither is written here and neither
-- belongs in a migration** — migrations are committed, and a key in git is a key that has to be
-- rotated. They live in Supabase Vault, read at call time, and **every job no-ops when they are
-- absent** rather than erroring.
--
-- That last part is what makes `supabase db reset` usable: a fresh local database has no vault
-- secrets, so without the guard every developer would get a failing cron job every thirty
-- seconds forever. Silence on an unconfigured machine, work on a configured one.
--
-- To configure an environment (NOT in this file, and not in any committed file):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'hisaab_functions_url');
--   select vault.create_secret('<service key>', 'hisaab_service_key');

create extension if not exists pg_cron;

-- ---------------------------------------------------------------- reaching the outside

create or replace function internal.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select decrypted_secret into v
  from vault.decrypted_secrets where name = p_name limit 1;
  return v;
exception when others then
  -- Vault absent or unreadable is the same answer as unset: do nothing quietly.
  return null;
end;
$$;

/*
 * Hand the due notifications to the dispatcher.
 *
 * The HTTP call is `net.http_post`, which is **asynchronous** — it queues the request and
 * returns an id immediately. That matters more than it looks: a synchronous call would hold a
 * transaction open for the duration of a round trip to Expo, every thirty seconds, and a slow
 * response would stack ticks on top of each other.
 *
 * Claiming happens HERE rather than in the Edge Function, so the rows are marked `sending` in
 * the same transaction that decides to send them. If the function is unreachable the rows sit
 * in `sending` and are swept back by `internal.requeue_stuck_notifications` below — visible and
 * recoverable, rather than sent twice.
 */
create or replace function internal.dispatch_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url  text := internal.vault_secret('hisaab_functions_url');
  v_key  text := internal.vault_secret('hisaab_service_key');
  v_msgs jsonb;
begin
  if v_url is null or v_key is null then
    return;   -- unconfigured environment; see the header.
  end if;

  select jsonb_agg(to_jsonb(d)) into v_msgs
  from internal.claim_due_notifications(100) d;

  if v_msgs is null then
    return;   -- nothing due.
  end if;

  perform net.http_post(
    url     := v_url || '/push-dispatch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('messages', v_msgs)
  );
end;
$$;

/*
 * Put back anything that was claimed and never resolved.
 *
 * A dispatch can die between the claim and the callback — the function times out, the worker is
 * recycled, the deploy happens mid-flight. Those rows sit in `sending` forever otherwise, which
 * is the silent-failure end of this pipeline and the one nobody notices.
 *
 * **Swept on `claimed_at`, not `created_at`.** They answer different questions: `created_at` is
 * when the event happened, `claimed_at` is when THIS attempt started. A row held back an hour by
 * the rate limit, or overnight by quiet hours, is already older than any sweep window by the
 * time it is claimed — so sweeping on `created_at` would tear it back out of the dispatcher
 * within seconds, every time, and the notification would loop until `attempts` hit five and it
 * was marked failed. Exactly the rows that waited longest would be the ones that never arrived.
 *
 * Ten minutes is comfortably longer than any legitimate dispatch and short enough that a
 * genuinely lost notification is still worth delivering. `attempts` is incremented by the claim,
 * so a row that keeps dying is visible in the table rather than looping unbounded.
 */
create or replace function internal.requeue_stuck_notifications()
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.notification_queue
     set status = case when attempts >= 5 then 'failed' else 'pending' end,
         error  = case when attempts >= 5 then 'dispatch never completed' else error end
   where status = 'sending'
     and coalesce(claimed_at, created_at) < now() - interval '10 minutes';
$$;

revoke all on function
  internal.vault_secret(text),
  internal.dispatch_notifications(),
  internal.requeue_stuck_notifications()
from public, anon, authenticated;

-- ---------------------------------------------------------------- the dispatcher's way back in

/*
 * PostgREST only exposes `public`, so the Edge Function cannot reach `internal` however
 * privileged its key is. These two wrappers are the entire surface it needs — reporting what
 * Expo said, and retiring a dead token.
 *
 * **Granted to `service_role` and nothing else.** `authenticated` must never reach these: a
 * client that can call `complete_notifications` can mark somebody else's notifications sent,
 * which is a silent, untraceable way to stop a person being told their money moved. That is
 * why they are separate wrappers rather than a widened grant on the originals.
 */
create or replace function public.complete_notifications(p_ids bigint[], p_error text default null)
returns void language sql security definer set search_path = '' as $$
  select internal.complete_notifications(p_ids, p_error);
$$;

create or replace function public.disable_push_token(p_token text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select internal.disable_push_token(p_token, p_reason);
$$;

revoke all on function
  public.complete_notifications(bigint[], text),
  public.disable_push_token(text, text)
from public, anon, authenticated;

grant execute on function
  public.complete_notifications(bigint[], text),
  public.disable_push_token(text, text)
to service_role;

-- ---------------------------------------------------------------- the schedule

/*
 * Registered idempotently. `cron.schedule` upserts on job name, but unscheduling first keeps a
 * renamed or retired job from being left behind on a database that has seen an older version of
 * this migration.
 */
do $$
declare
  v_job text;
begin
  foreach v_job in array array[
    'hisaab-notification-dispatch',
    'hisaab-notification-sweep',
    'hisaab-recurring',
    'hisaab-purge-claim-codes'
  ] loop
    begin
      perform cron.unschedule(v_job);
    exception when others then
      null;   -- not previously scheduled
    end;
  end loop;
end $$;

-- Every 30 seconds. The queue's 45-second coalescing window means a notification waits at most
-- ~75s, which is well inside "prompt" for this app and buys the collapsing that makes bulk
-- entry survivable.
select cron.schedule('hisaab-notification-dispatch', '30 seconds',
                     $$select internal.dispatch_notifications()$$);

select cron.schedule('hisaab-notification-sweep', '*/5 * * * *',
                     $$select internal.requeue_stuck_notifications()$$);

/*
 * Hourly, not daily, and that is load-bearing: each rule is evaluated against ITS OWN timezone,
 * so "the 1st of the month" has to be noticed at local midnight wherever the user is. A daily
 * job would fire every rule at one UTC instant and post a day early or late for most of them.
 */
select cron.schedule('hisaab-recurring', '0 * * * *',
                     $$select app.run_due_recurring_expenses()$$);

-- 0026 wrote this and deliberately left it unscheduled, waiting for exactly this file.
select cron.schedule('hisaab-purge-claim-codes', '17 3 * * *',
                     $$select internal.purge_claim_codes()$$);
