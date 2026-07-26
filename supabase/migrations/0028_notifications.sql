-- Phase 9 — the notification pipeline.
--
-- Phase 3 built the tables (`internal.notification_queue`, `public.notification_prefs`,
-- `public.device_tokens`) and nothing that writes to them. This is the logic.
--
-- ---------------------------------------------------------------- the shape, and why
--
-- A write RPC appends `internal.change_events` in its own transaction. An AFTER INSERT trigger
-- turns each event into a queued notification. `pg_cron` drains the queue out-of-band.
--
-- **Nothing here ever makes an HTTP call inside the mutation transaction.** That is the whole
-- reason for the queue: a push outage must not be able to fail somebody's expense write, and
-- coalescing is impossible if each event is dispatched the instant it happens.
--
-- ---------------------------------------------------------------- the actor filter moved here
--
-- `internal.emit_change` used to skip the actor. 0023 removed that, deliberately: excluding the
-- person who made the change is a NOTIFICATION rule, and having it in the SYNC spine meant a
-- second device on the same account could never learn about the first one's writes. The rule is
-- real, so it has to live somewhere — this is that somewhere.
--
-- It is enforced in the ENQUEUE, not the dispatcher. A row that should never be sent should
-- never be in the queue: it cannot then be sent by a future dispatcher that forgets to check,
-- and it does not count against the recipient's rate limit.

-- ---------------------------------------------------------------- two new states

/*
 * Phase 3 allowed `pending / sent / skipped / failed`. The drain needs two more.
 *
 * **`sending`** is the in-flight marker. `for update skip locked` stops two overlapping cron
 * ticks claiming the same row *within* a transaction, but the dispatch happens after that
 * transaction commits — the HTTP call is the Edge Function's, not the database's. Without a
 * durable claim, the next tick 30 seconds later re-reads the same pending row and sends the
 * notification twice.
 *
 * **`digest`** is the rate-limit overflow. A row past the hourly cap is marked rather than
 * dropped, so it can be rolled into a summary later: being late with a notification is a much
 * smaller failure than silently losing one, and a drop is indistinguishable from a bug.
 */
alter table internal.notification_queue drop constraint if exists notification_queue_status_check;
alter table internal.notification_queue add constraint notification_queue_status_check
  check (status in ('pending','sending','sent','skipped','failed','digest'));

-- ---------------------------------------------------------------- receipts from Expo

/*
 * What Expo said about each push we handed it.
 *
 * Two round trips, because Expo's API has two: the send returns a TICKET immediately, and the
 * real delivery outcome is only available from the receipts endpoint minutes later. A token
 * that has been uninstalled comes back as `DeviceNotRegistered` in the RECEIPT, not the ticket —
 * so a pipeline that only looks at tickets keeps pushing to dead devices forever, which is the
 * thing that gets a sender rate-limited.
 */
create table if not exists internal.push_receipts (
  id                bigserial primary key,
  queue_id          bigint references internal.notification_queue(id) on delete set null,
  device_token_id   uuid references public.device_tokens(id) on delete cascade,
  ticket_id         text,
  status            text not null default 'pending'
                      check (status in ('pending','ok','error')),
  error_code        text,
  checked_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists push_receipts_pending_idx
  on internal.push_receipts (created_at) where status = 'pending';

-- ---------------------------------------------------------------- quiet hours

/*
 * When may this person actually be disturbed?
 *
 * Returns the earliest time at or after `p_at` that is outside their quiet hours, in UTC.
 *
 * The timezone comes from the DEVICE, not the profile: it is the only place we learn it, and it
 * is the one that matches where the phone physically is. Falling back to Asia/Kolkata rather
 * than UTC is deliberate — this app's users are overwhelmingly in one timezone, and a wrong
 * guess of UTC would put "9am" at 2:30pm for them, which is worse than a wrong guess of IST is
 * for anybody else.
 *
 * **Handles the window that wraps midnight**, which is the normal case: 22:00–07:00 is two
 * intervals on a clock face, not one, and the naive `between` test silently never fires.
 */
create or replace function internal.next_sendable_at(
  p_profile_id uuid,
  p_at         timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start time;
  v_end   time;
  v_tz    text;
  v_local timestamp;
  v_quiet boolean;
begin
  select quiet_hours_start, quiet_hours_end into v_start, v_end
  from public.notification_prefs where profile_id = p_profile_id;

  if v_start is null or v_end is null or v_start = v_end then
    return p_at;
  end if;

  select coalesce(
      (select d.timezone from public.device_tokens d
        where d.profile_id = p_profile_id and d.disabled_at is null and d.timezone is not null
        order by d.last_seen_at desc limit 1),
      'Asia/Kolkata')
    into v_tz;

  begin
    v_local := p_at at time zone v_tz;
  exception when others then
    -- An unrecognised IANA name must not silently swallow the notification.
    return p_at;
  end;

  v_quiet := case
    when v_start < v_end then v_local::time >= v_start and v_local::time < v_end
    -- Wraps midnight: quiet if after the start OR before the end.
    else v_local::time >= v_start or v_local::time < v_end
  end;

  if not v_quiet then
    return p_at;
  end if;

  -- Next occurrence of the end time, local, converted back. `+ interval '1 day'` only when the
  -- end has already passed today, which is exactly the wrapped case after midnight.
  return (
    case
      when v_local::time < v_end then date_trunc('day', v_local) + v_end
      else date_trunc('day', v_local) + interval '1 day' + v_end
    end
  ) at time zone v_tz;
end;
$$;

-- ---------------------------------------------------------------- does this person want it?

create or replace function internal.wants_notification(p_profile_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Default TRUE when no prefs row exists. A profile that has never opened Settings should
  -- still hear about an expense; the row is created lazily and its absence means "unset",
  -- not "off".
  select coalesce(
    (select case p_kind
       when 'expense_added'   then p.new_expenses
       when 'expense_edited'  then p.expense_edits
       when 'expense_deleted' then p.new_expenses
       when 'comment'         then p.comments
       when 'settlement'      then p.settlements
       when 'group_added'     then p.new_expenses
       when 'recurring'       then p.new_expenses
       when 'nudge'           then p.reminders
       else true
     end
     from public.notification_prefs p where p.profile_id = p_profile_id),
    true);
$$;

-- ---------------------------------------------------------------- the enqueue

/*
 * One change event → at most one queued notification.
 *
 * ---------------------------------------------------------------- the five storm controls
 *
 * 1. **Coalescing.** `coalesce_key` groups everything the drain may collapse into one message,
 *    and `not_before` gives it 45 seconds to accumulate. Somebody entering a trip's receipts in
 *    one sitting produces one push, not eleven.
 * 2. **Edit debounce.** A second edit to the SAME expense inside five minutes updates the row
 *    already queued instead of adding another — someone fixing a typo three times is one event.
 * 3. **Rate limits.** At most one per (recipient, group) per 60 seconds, and 20 per recipient
 *    per hour. Over the hourly limit the row is still written, marked `digest`, so it is rolled
 *    into a summary rather than dropped — losing a notification silently is worse than being
 *    late with it.
 * 4. **Never the actor.** Enforced here, at the door.
 * 5. **Prefs and quiet hours.** Category gate, then `not_before` pushed past the quiet window.
 *
 * ---------------------------------------------------------------- the edit rule
 *
 * An edit only notifies people whose OWN share moved. `app.expense_diff` already computes
 * `shares_changed` on every revision, so a description fix — which changes no share — reaches
 * nobody. That is the difference between a useful notification and the kind people turn off.
 */
create or replace function internal.enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text;
  v_coalesce text;
  v_title    text;
  v_body     text;
  v_actor    text;
  v_changed  jsonb;
  v_existing bigint;
  v_recent   int;
  v_hourly   int;
  v_when     timestamptz;
  v_status   text := 'pending';
begin
  -- (4) Never the actor. Their own device already knows; this is the only place that rule lives
  -- now that the sync spine deliberately keeps the actor's events.
  if new.actor_profile_id is not null and new.recipient_profile_id = new.actor_profile_id then
    return null;
  end if;

  v_kind := case
    when new.entity_type = 'expense' and new.op = 'insert' then 'expense_added'
    when new.entity_type = 'expense' and new.op = 'update' then 'expense_edited'
    when new.entity_type = 'expense' and new.op = 'delete' then 'expense_deleted'
    when new.entity_type = 'comment' then 'comment'
    when new.entity_type = 'settlement' then 'settlement'
    when new.entity_type = 'group' and new.op = 'insert' then 'group_added'
    else null
  end;

  -- Profile merges and anything else structural sync the client but say nothing out loud.
  if v_kind is null then
    return null;
  end if;

  -- The edit rule: silent unless this recipient's own share actually moved.
  if v_kind = 'expense_edited' then
    select r.diff -> 'shares_changed' into v_changed
    from public.expense_revisions r
    where r.expense_id = new.entity_id
    order by r.revision desc
    limit 1;

    if v_changed is null
       or not (v_changed @> to_jsonb(new.recipient_profile_id::text)) then
      return null;
    end if;
  end if;

  -- (5a) Category preference.
  if not internal.wants_notification(new.recipient_profile_id, v_kind) then
    return null;
  end if;

  select coalesce(p.display_name, 'Someone') into v_actor
  from public.profiles p where p.id = new.actor_profile_id;
  v_actor := coalesce(v_actor, 'Someone');

  -- (1) Everything the drain may merge shares a key. Group-scoped where there is a group, so
  -- two different trips never collapse into one misleading sentence.
  v_coalesce := v_kind || ':' || coalesce(new.group_id::text, 'oneoff') || ':'
                || coalesce(new.actor_profile_id::text, 'system');

  v_title := case v_kind
    when 'expense_added'   then 'New expense'
    when 'expense_edited'  then 'Expense updated'
    when 'expense_deleted' then 'Expense removed'
    when 'comment'         then 'New comment'
    when 'settlement'      then 'Settled up'
    when 'group_added'     then 'Added to a group'
    else 'Hisaab'
  end;

  v_body := case v_kind
    when 'expense_added'   then v_actor || ' added an expense'
    when 'expense_edited'  then v_actor || ' changed your share'
    when 'expense_deleted' then v_actor || ' removed an expense'
    when 'comment'         then v_actor || ' commented'
    when 'settlement'      then v_actor || ' recorded a settlement'
    when 'group_added'     then v_actor || ' added you to a group'
    else 'Something changed'
  end;

  -- (2) Edit debounce: the same expense edited again within five minutes rides the row already
  -- waiting rather than queueing a second one.
  if v_kind = 'expense_edited' then
    select q.id into v_existing
    from internal.notification_queue q
    where q.recipient_profile_id = new.recipient_profile_id
      and q.status = 'pending'
      and q.data ->> 'entity_id' = new.entity_id::text
      and q.created_at > now() - interval '5 minutes'
    limit 1;

    if v_existing is not null then
      update internal.notification_queue
         set body = v_body, event_id = new.id
       where id = v_existing;
      return null;
    end if;
  end if;

  -- (3) Rate limits. Per-pair first: a burst inside one group is exactly what coalescing is
  -- for, so anything inside 60s joins the pending row rather than adding to it.
  select count(*) into v_recent
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.coalesce_key = v_coalesce
    and q.status = 'pending'
    and q.created_at > now() - interval '60 seconds';

  if v_recent > 0 then
    -- Already something pending for this exact key; the drain will summarise. Bump the event
    -- pointer so the summary counts this one.
    update internal.notification_queue
       set event_id = new.id
     where recipient_profile_id = new.recipient_profile_id
       and coalesce_key = v_coalesce
       and status = 'pending';
    return null;
  end if;

  select count(*) into v_hourly
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.created_at > now() - interval '1 hour';

  -- Marked, not dropped. A digest is late; a drop is a lie.
  if v_hourly >= 20 then
    v_status := 'digest';
  end if;

  -- (5b) Quiet hours.
  v_when := internal.next_sendable_at(new.recipient_profile_id, now() + interval '45 seconds');

  insert into internal.notification_queue
    (recipient_profile_id, event_id, kind, coalesce_key, title, body, data, not_before, status)
  values
    (new.recipient_profile_id, new.id, v_kind, v_coalesce, v_title, v_body,
     jsonb_build_object(
       'entity_type', new.entity_type,
       'entity_id', new.entity_id,
       'group_id', new.group_id),
     v_when, v_status);

  return null;
end;
$$;

drop trigger if exists change_events_notify on internal.change_events;
create trigger change_events_notify
  after insert on internal.change_events
  for each row execute function internal.enqueue_notification();

-- ---------------------------------------------------------------- the drain

/*
 * Claim everything due, collapsing each coalesce group into ONE message.
 *
 * Returns the messages to send. The Edge Function does the HTTP; this function decides what to
 * say and marks the rows, so the counting logic is testable without a network.
 *
 * `for update skip locked` so two overlapping cron ticks cannot send the same notification
 * twice — the drain runs every 30 seconds and a slow dispatch must not double-fire.
 */
create or replace function internal.claim_due_notifications(p_limit int default 100)
returns table (
  queue_ids  bigint[],
  profile_id uuid,
  title      text,
  body       text,
  data       jsonb,
  tokens     text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select q.id, q.recipient_profile_id, q.coalesce_key, q.title, q.body, q.data
    from internal.notification_queue q
    where q.status = 'pending' and q.not_before <= now()
    order by q.not_before
    limit p_limit
    for update skip locked
  ),
  grouped as (
    select
      array_agg(d.id order by d.id)                  as ids,
      d.recipient_profile_id                          as pid,
      min(d.title)                                    as title,
      -- N rows under one key become one sentence. The singular case keeps the original wording
      -- rather than saying "1 change", which reads like a machine wrote it.
      case when count(*) > 1
           then min(d.body) || ' (+' || (count(*) - 1)::text || ' more)'
           else min(d.body) end                       as body,
      min(d.data::text)::jsonb                        as data
    from due d
    group by d.recipient_profile_id, d.coalesce_key
  ),
  marked as (
    update internal.notification_queue q
       set status = 'sending', attempts = q.attempts + 1
      from grouped g
     where q.id = any(g.ids)
    returning q.id
  )
  select
    g.ids,
    g.pid,
    g.title,
    g.body,
    g.data,
    coalesce(
      (select array_agg(t.expo_push_token)
         from public.device_tokens t
        where t.profile_id = g.pid and t.disabled_at is null),
      array[]::text[])
  from grouped g
  -- `marked` has to be referenced or the CTE is never executed; Postgres only runs a data
  -- modifying CTE if something depends on it.
  where (select count(*) from marked) >= 0;
end;
$$;

create or replace function internal.complete_notifications(p_ids bigint[], p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update internal.notification_queue
     set status = case when p_error is null then 'sent' else 'failed' end,
         sent_at = case when p_error is null then now() else sent_at end,
         error = p_error
   where id = any(p_ids);
$$;

/*
 * Retire a token Expo told us is dead.
 *
 * Called from the receipt sweep, not the send: `DeviceNotRegistered` arrives in the RECEIPT.
 * Disabled rather than deleted so the reason survives for support, and so a reinstall that
 * returns the same token can be told apart from a brand-new device.
 */
create or replace function internal.disable_push_token(p_token text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.device_tokens
     set disabled_at = now(), disabled_reason = p_reason
   where expo_push_token = p_token and disabled_at is null;
$$;

revoke all on function
  internal.next_sendable_at(uuid, timestamptz),
  internal.wants_notification(uuid, text),
  internal.claim_due_notifications(int),
  internal.complete_notifications(bigint[], text),
  internal.disable_push_token(text, text)
from public, anon, authenticated;

notify pgrst, 'reload schema';
