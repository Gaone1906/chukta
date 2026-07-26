-- The last two findings from the Phase 9 review, and one of them was worse than reported.

-- ================================================================ 1. the rate limit did not
--                                                                     actually limit anything
/*
 * The per-key coalescing check asked the wrong question.
 *
 *     and q.created_at > now() - interval '60 seconds'
 *
 * The review flagged this as "a burst arriving after the hold still queues a second row",
 * which sounded like a storage concern — the drain groups by `(recipient, coalesce_key)`, so
 * two rows under one key collapse into one message anyway.
 *
 * They do NOT collapse if their `not_before` differs, and under the hourly cap it always does.
 * Walk it through with a recipient already over 20/hour:
 *
 *   t=0     event → row A, held an hour, `not_before = t+1h`
 *   t=90s   event, same key → A's `created_at` is 90s old, so the 60-second window misses it
 *                           → row B, also held an hour, `not_before = t+1h+90s`
 *   t=1h    the drain sees only A due. One push.
 *   t=1h+90s  B is due. **A second push, for the same conversation.**
 *
 * So the cap shifted every notification an hour into the future and preserved the original
 * spacing exactly. Twenty-one events in an hour became twenty-one pushes an hour later. The
 * one control whose entire job is to stop a storm reliably reproduced it, just late — and late
 * is worse, because by then nobody is looking at the screen that would explain them.
 *
 * The fix is to ask what actually matters: **has this row gone out yet?** A pending row whose
 * `not_before` is still in the future has not been delivered and cannot have been, so merging
 * into it loses nothing. A wall-clock window was only ever a proxy for that, and it is a proxy
 * that breaks the moment anything legitimately delays a row — the rate limit, quiet hours, a
 * requeue after a failed dispatch.
 *
 * What this does NOT change, deliberately: two events genuinely 90 seconds apart with nothing
 * holding them back still produce two pushes. By then row A is due, or already `sending`, so it
 * no longer absorbs. The 45-second accumulation window is the policy, and it stays the policy —
 * this only stops the window from silently becoming "45 seconds, unless something is waiting,
 * in which case none at all".
 *
 * Everything else in this function is 0028's body verbatim.
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
  v_action   text;
  v_existing bigint;
  v_recent   int;
  v_hourly   int;
  v_when     timestamptz;
  v_hold     interval := interval '45 seconds';
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

  if v_kind = 'expense_edited' then
    select r.diff -> 'shares_changed', r.action into v_changed, v_action
    from public.expense_revisions r
    where r.expense_id = new.entity_id
    order by r.revision desc
    limit 1;

    if v_changed is not null
       and not (v_changed @> to_jsonb(new.recipient_profile_id::text)) then
      return null;
    end if;

    if v_action = 'restored' then
      v_kind := 'expense_restored';
    end if;
  end if;

  -- One action, one notification: `create_expense` with an inline group emits both
  -- `group/insert` and `expense/insert`. Same reasoning as 0028 — and the same `not_before`
  -- test, for the same reason as above.
  if v_kind = 'expense_added' and new.group_id is not null then
    perform 1 from internal.notification_queue q
     where q.recipient_profile_id = new.recipient_profile_id
       and q.kind = 'group_added'
       and q.status = 'pending'
       and q.data ->> 'group_id' = new.group_id::text
       and q.not_before > now();
    if found then
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

  v_coalesce := v_kind || ':' || coalesce(new.group_id::text, 'oneoff') || ':'
                || coalesce(new.actor_profile_id::text, 'system');

  v_title := case v_kind
    when 'expense_added'   then 'New expense'
    when 'expense_edited'  then 'Expense updated'
    when 'expense_deleted' then 'Expense removed'
    when 'expense_restored' then 'Expense restored'
    when 'comment'         then 'New comment'
    when 'settlement'      then 'Settled up'
    when 'group_added'     then 'Added to a group'
    else 'Hisaab'
  end;

  v_body := case v_kind
    when 'expense_added'   then v_actor || ' added an expense'
    when 'expense_edited'  then v_actor || ' changed your share'
    when 'expense_deleted' then v_actor || ' removed an expense'
    when 'expense_restored' then v_actor || ' restored an expense'
    when 'comment'         then v_actor || ' commented'
    when 'settlement'      then v_actor || ' recorded a settlement'
    when 'group_added'     then v_actor || ' added you to a group'
    else 'Something changed'
  end;

  -- (2) Edit debounce. Left on `created_at`: this one is genuinely about wall-clock time —
  -- "somebody is still fiddling with this expense" — and not about whether a row has been
  -- delivered. Only an edit may rewrite an edit; see 0028 for why that guard exists.
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
       where id = v_existing and kind = 'expense_edited';

      if found then
        return null;
      end if;
    end if;
  end if;

  -- (3) Rate limits. Anything for this key that has not gone out yet absorbs this event,
  -- however long ago it was queued. See the header.
  select count(*) into v_recent
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.coalesce_key = v_coalesce
    and q.status = 'pending'
    and q.not_before > now();

  if v_recent > 0 then
    update internal.notification_queue
       set event_id = new.id
     where recipient_profile_id = new.recipient_profile_id
       and coalesce_key = v_coalesce
       and status = 'pending'
       and not_before > now();
    return null;
  end if;

  select count(*) into v_hourly
  from internal.notification_queue q
  where q.recipient_profile_id = new.recipient_profile_id
    and q.created_at > now() - interval '1 hour';

  if v_hourly >= 20 then
    v_hold := interval '1 hour';
  end if;

  -- (5b) Quiet hours.
  v_when := internal.next_sendable_at(new.recipient_profile_id, now() + v_hold);

  insert into internal.notification_queue
    (recipient_profile_id, event_id, kind, coalesce_key, title, body, data, not_before, status)
  values
    (new.recipient_profile_id, new.id, v_kind, v_coalesce, v_title, v_body,
     jsonb_build_object(
       'entity_type', new.entity_type,
       'entity_id', new.entity_id,
       'group_id', new.group_id),
     v_when, 'pending');

  return null;
end;
$$;

-- The coalescing probe now filters on `(recipient, coalesce_key, status, not_before)`. The
-- existing due index is on `not_before` alone and the recipient index on `(recipient,
-- created_at)`, so neither serves this well once the table is large.
create index if not exists notification_queue_coalesce_idx
  on internal.notification_queue (recipient_profile_id, coalesce_key, not_before)
  where status = 'pending';

-- ================================================================ 2. nothing ever deleted
--                                                                     anything
/*
 * Four append-only tables, none of them purged, all of them growing per write.
 *
 * `mutation_log` is the fastest — one row for every mutation any user ever makes — and it was
 * not even on the review's list. `change_events` is next, with write amplification built in: a
 * six-person expense writes six rows, by design.
 *
 * ---------------------------------------------------------------- why 30 days is safe
 *
 * `sync_pull` does not hard-code a retention window; it compares the client's cursor against
 * `min(id)` in the table and answers `full_resync` when the cursor falls below it (`0015:30`).
 * So retention is whatever this function leaves behind, and shortening it can never desync a
 * client — it can only make one rehydrate.
 *
 * Thirty days is well past the point where that costs anything: the client's own persisted
 * cache expires at fourteen (`persister.ts:52`), so a device returning after a month rebuilds
 * from scratch regardless of what this table holds.
 *
 * Idempotency keys expire on the same schedule for a related reason — an outbox row lives for
 * hours at worst, and a retry arriving thirty days late is not a retry.
 *
 * ---------------------------------------------------------------- the cascade, which bites
 *
 * `notification_queue.event_id` is `references internal.change_events(id) on delete cascade`.
 * Deleting change events therefore deletes queued notifications, **including undelivered
 * ones** — silently, with no status change and nothing to find afterwards. That is the same
 * shape as the `digest` bug this phase already had once: work that looks handled and is gone.
 *
 * So change events still referenced by a live queue row are held back, explicitly, rather than
 * relying on "a pending row that old cannot exist". It can: that is what a stuck dispatcher
 * looks like, and the sweep in 0030 caps `attempts` at five and then marks the row `failed`,
 * which makes it purgeable on the next run. One month of grace, then it goes.
 */
create or replace function internal.purge_sync_spine()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval := interval '30 days';
begin
  -- Terminal notifications first, so the change events behind them stop being pinned.
  delete from internal.notification_queue
   where status in ('sent', 'skipped', 'failed')
     and created_at < now() - v_keep;

  -- Receipts are diagnostic and short-lived; a resolved one is worth a week, not a month.
  -- `pending` is excluded because an unchecked receipt is still work: it is where
  -- `DeviceNotRegistered` arrives, and dropping it means pushing to a dead device forever.
  delete from internal.push_receipts
   where status in ('ok', 'error')
     and created_at < now() - interval '7 days';

  delete from internal.change_events ce
   where ce.created_at < now() - v_keep
     and not exists (
       select 1 from internal.notification_queue q
        where q.event_id = ce.id
          and q.status in ('pending', 'sending'));

  delete from internal.mutation_log
   where created_at < now() - v_keep;
end;
$$;

revoke all on function internal.purge_sync_spine() from public, anon, authenticated;

-- Nightly, at an unremarkable hour and offset from the claim-code purge so the two never
-- contend for the same tables at the same minute.
do $$
begin
  begin
    perform cron.unschedule('hisaab-purge-sync-spine');
  exception when others then
    null;
  end;
end $$;

select cron.schedule('hisaab-purge-sync-spine', '43 3 * * *',
                     $$select internal.purge_sync_spine()$$);

notify pgrst, 'reload schema';
