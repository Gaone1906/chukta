-- Phase 8, part one: make the sync spine reachable from a phone, and make it complete.
--
-- Phase 3 built `internal.change_events` to serve three consumers at once — Realtime fan-out,
-- the offline delta cursor, and the push queue. Two of the three work. The Realtime one never
-- could, and three fan-out gaps only show up once something is actually listening.
--
-- ---------------------------------------------------------------- why broadcast, not postgres_changes
--
-- Supabase's Postgres Changes feature replicates row deltas from a publication and re-checks
-- RLS per subscriber per row. `internal.change_events` cannot participate in that at ALL:
--
--   * the `internal` schema has no USAGE for `authenticated` (nspacl is null),
--   * the table has no grants whatsoever (relacl is null),
--   * it has no RLS enabled and therefore no policy to evaluate,
--   * and it is not in the `supabase_realtime` publication.
--
-- Every one of those is deliberate — the table is reachable only through SECURITY DEFINER
-- functions, which is what stops a client reading other people's fan-out. Undoing them to get
-- realtime would trade the whole containment story for a feature.
--
-- So the live path is **broadcast from the database** instead: a trigger calls
-- `realtime.send()`, which writes to `realtime.messages`, which the Realtime server tails over
-- logical replication and pushes to whoever is subscribed to that topic. The table stays
-- sealed; only a projection of it leaves.
--
-- Topic is `sync:<recipient_profile_id>` — one per person, which is exactly the "client opens
-- exactly ONE subscription" the plan asks for, and the narrowest possible authorisation
-- question: *is this your own topic?*
--
-- ---------------------------------------------------------------- three things that bite here
--
-- 1. `realtime.send` is SECURITY INVOKER and its INSERT is subject to RLS on
--    `realtime.messages`. Called as `authenticated` it is denied. It works here because the
--    trigger function below is SECURITY DEFINER owned by postgres, and postgres has BYPASSRLS.
--
-- 2. `realtime.send` wraps its whole body in `EXCEPTION WHEN OTHERS THEN RAISE WARNING`. That
--    is what makes it safe to call inside a money-write transaction — a broadcast failure can
--    never roll back an expense. It also means a broadcast failure is INVISIBLE: the write
--    commits, the message vanishes, nothing is raised. The pgTAP below therefore asserts on
--    the contents of `realtime.messages` directly rather than on `send` not throwing, because
--    "did not throw" is not evidence of anything here.
--
-- 3. `realtime.messages` is partitioned by day, and the partitions are created by the Realtime
--    *container* (Realtime.Tenants.create_messages_partitions/1), not by cron and not by
--    anything in this directory. A missing partition for today breaks both directions at once:
--    sends are swallowed, and subscribes fail too, because the subscribe-time authorisation
--    probe is itself an INSERT at now(). If realtime "stops working overnight", look here
--    first — nothing in these migrations can cause or fix it.
--
-- ---------------------------------------------------------------- and one that bites CI
--
-- `realtime.messages` and `realtime.send` are not ours. They are installed by the Realtime
-- server's own tenant migrations when that container first connects, which means they are
-- absent anywhere Postgres is running alone — including CI, which uses `supabase db start`
-- rather than `supabase start` precisely because it only wants a database.
--
-- So everything below that touches the `realtime` schema is guarded. Without the guards, the
-- policy would fail to create and CI would go red on migration 0023; worse, the trigger would
-- raise `undefined_function` on the first expense written and take every write RPC test down
-- with it — a database-only environment would be unable to record an expense at all.
--
-- The rule this follows: **a live-updates nicety must never be able to fail a money write.**
-- That is also why `realtime.send` swallows its own exceptions, and the guards extend the same
-- courtesy to the case where it does not exist at all.
--
-- If migrations are ever applied to a project before Realtime has initialised, this migration
-- installs the trigger but skips the policy, and nobody can subscribe. Re-running the policy
-- statement afterwards is the whole fix; the pgTAP in `supabase/tests/sync.test.sql` reports
-- exactly this as a skip rather than a pass, so it cannot go unnoticed.

-- ---------------------------------------------------------------- fan-out, corrected

/*
 * Fan out one change to everyone who should see it, inside the same transaction as the data.
 *
 * TWO CHANGES from 0011, both of which only became visible once a client subscribed.
 *
 * **The actor is now a recipient.** The old body ended `where r is distinct from p_actor`,
 * under the comment "never notify the actor about their own action". That is a *notification*
 * rule living in the *sync* spine, and it quietly made two things impossible:
 *
 *   - Two devices on one account could never converge. Add an expense on the phone and the
 *     tablet learns nothing, ever — not by broadcast, and not by `sync_pull` either, because
 *     that reads the same table. This is a stated Phase 8 acceptance criterion.
 *   - A device that goes offline mid-write has no event of its own to reconcile against.
 *
 * The push pipeline (Phase 9) must now drop the actor when it drains `notification_queue`,
 * which is where that rule always belonged. It does not exist yet, so there is nothing to
 * break — but it is the one thing that must not be forgotten, or everyone gets a push telling
 * them what they just did.
 *
 * **Recipients are de-duplicated.** With the actor filter gone, a caller that passes
 * `array_append(v_members, v_me)` where v_me is already in v_members would insert the same
 * event twice. `distinct` also drops NULLs, which the old form let through.
 */
create or replace function internal.emit_change(
  p_recipients  uuid[],
  p_actor       uuid,
  p_group_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_op          text,
  p_payload     jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into internal.change_events
    (recipient_profile_id, actor_profile_id, group_id, entity_type, entity_id, op, payload)
  select r, p_actor, p_group_id, p_entity_type, p_entity_id, p_op, p_payload
  from (select distinct unnest(p_recipients) as r) u
  where u.r is not null;
$$;

-- ---------------------------------------------------------------- the broadcast bridge

/*
 * Mirror every change event onto its recipient's private topic.
 *
 * A trigger rather than a call inside each RPC: `internal.emit_change` is the sole writer of
 * this table (nine call sites route through it, nothing inserts directly), so a trigger on the
 * table catches every event that will ever exist, including any added later, with no chance of
 * a new RPC forgetting to broadcast.
 *
 * The payload is the event, minus the recipient — the recipient is the topic, so repeating it
 * in the body would just be telling you your own name. `event_id` is the important field: it
 * is the same cursor `sync_pull` uses, so a client that receives one can advance its cursor
 * without a round trip, and a client that missed some can ask for everything after the last id
 * it saw.
 *
 * Deliberately NOT enriched. The plan's rule of thumb was "comments and settlements carry full
 * payloads, expenses carry {} and trigger a refetch" — but the client invalidates TanStack
 * Query keys rather than hand-patching cache entries, so a bare (entity_type, entity_id, op,
 * group_id) tick is all any of them need. Widening the payload would mean the fan-out has to
 * be re-checked against RLS by hand for every field, since a broadcast bypasses the read
 * policies that would otherwise gate it. A tick tells you to go and ask; it cannot leak.
 */
create or replace function internal.broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nothing to broadcast to. A syscache lookup per event, which is cheaper than the
  -- subtransaction an exception block would open, and it keeps a database-only environment
  -- (CI, or a project whose Realtime container has never connected) fully able to write money.
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'event_id',         new.id,
      'entity_type',      new.entity_type,
      'entity_id',        new.entity_id,
      'op',               new.op,
      'group_id',         new.group_id,
      'actor_profile_id', new.actor_profile_id,
      'payload',          new.payload
    ),
    'change',
    'sync:' || new.recipient_profile_id::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists change_events_broadcast on internal.change_events;
create trigger change_events_broadcast
  after insert on internal.change_events
  for each row execute function internal.broadcast_change();

-- ---------------------------------------------------------------- who may listen

/*
 * The authorisation for a private broadcast channel.
 *
 * `realtime.messages` already grants SELECT/INSERT/UPDATE to `authenticated` and already has
 * RLS enabled — with ZERO policies, which is why every subscribe attempt currently fails with
 * "Unauthorized: You do not have permissions to read from this Channel topic". This policy is
 * the entire fix; no grants and no ALTER TABLE are needed.
 *
 * SELECT only, on purpose. Receiving a broadcast is a read. Sending one from a client would be
 * an INSERT, and there is no policy for that — so a client cannot forge a change event onto
 * anyone's topic, including its own. Everything on these topics originates in a money-write
 * transaction or does not exist.
 *
 * **Do not add `private is true` to this USING clause**, however natural it looks. Realtime
 * authorises a subscribe by inserting a synthetic probe row and checking whether the subscriber
 * can read it back — and that probe row carries only `topic`, `extension` and the timestamps.
 * `private` defaults to false on it, and `payload`, `event` and `binary_payload` are all NULL.
 * A policy touching any of those fails the probe and blocks every subscription, with an error
 * that points at permissions rather than at the policy. Key off `realtime.topic()` and nothing
 * else.
 *
 * `realtime.topic()` is `current_setting('realtime.topic', true)`, so it is NULL outside the
 * subscribe handshake; `NULL = anything` is NULL, and the row is filtered out. That is the
 * safe direction, and it means an ordinary query against this table can never match.
 */
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice
      'realtime.messages is absent — skipping the sync_topic_read policy. Live updates are off '
      'until Realtime initialises and this statement is re-run. See 0023 and tests/sync.test.sql.';
    return;
  end if;

  drop policy if exists sync_topic_read on realtime.messages;

  create policy sync_topic_read on realtime.messages
    for select to authenticated
    using (
      realtime.topic() = 'sync:' || (select auth_ext.current_profile_id())::text
    );
end;
$$;

-- ---------------------------------------------------------------- fan-out gaps

/*
 * Create an expense — now telling the new group's members that the group exists.
 *
 * Unchanged from 0011 except for the emit at the end. The bug: when the expense creates its
 * group inline (`new_group` — the PRIMARY group-creation path in the product, since naming the
 * group field is how you promote a participant set into a group), the only event emitted was
 * for the expense, and its recipients are the expense's *participants*.
 *
 * So somebody added to the new group who is not a payer and not in the split — which is an
 * ordinary thing to do — was written into `group_members` as a full member and told nothing at
 * all. No event, so no broadcast, and `sync_pull` returns nothing for them either. They would
 * discover the group only if some later mutation happened to include them.
 *
 * `app.create_group` has always emitted 'group'/'insert' to every member. These two paths
 * create the same object and now behave the same way.
 */
create or replace function app.create_expense(
  p_payload            jsonb,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth_ext.assert_signed_in();
  v_cached     jsonb;
  v_expense_id uuid := coalesce((p_payload->>'id')::uuid, extensions.gen_random_uuid());
  v_group_id   uuid := nullif(p_payload->>'group_id','')::uuid;
  v_amount     bigint := (p_payload->>'amount_minor')::bigint;
  v_split_type public.split_type := (p_payload->>'split_type')::public.split_type;
  v_new_group  jsonb := p_payload->'new_group';
  v_members    uuid[];
  v_made_group boolean := false;
  v_payers     jsonb := coalesce(p_payload->'payers', '[]'::jsonb);
  v_splits     jsonb := coalesce(p_payload->'splits', '[]'::jsonb);
  v_participants uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'create_expense', p_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'amount_minor must be positive' using errcode = '22023';
  end if;

  -- Create the group inline when the user named one.
  if v_new_group is not null and v_new_group <> 'null'::jsonb then
    -- The group id comes from the client when it offered one. An expense written offline has
    -- to be able to name the group it belongs to before the server has ever seen either, and
    -- `create_group` has accepted a client id since 0016 — this is the same contract on the
    -- path people actually use.
    insert into public.groups (id, name, created_by_profile_id)
    values (
      coalesce(nullif(v_new_group->>'id','')::uuid, extensions.gen_random_uuid()),
      v_new_group->>'name',
      v_me
    )
    returning id into v_group_id;

    v_made_group := true;

    select coalesce(array_agg(distinct value::uuid), array[]::uuid[]) into v_members
    from jsonb_array_elements_text(coalesce(v_new_group->'member_profile_ids','[]'::jsonb));

    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select v_group_id, m, case when m = v_me then 'owner' else 'member' end, v_me
    from unnest(array_append(v_members, v_me)) as m
    on conflict (group_id, profile_id) do nothing;
  elsif v_group_id is not null then
    perform auth_ext.assert_group_member(v_group_id);
  end if;

  insert into public.expenses (
    id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id
  )
  values (
    v_expense_id,
    v_group_id,
    p_payload->>'description',
    v_amount,
    v_split_type,
    coalesce((p_payload->>'spent_on')::date, current_date)
  , v_me);

  insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
  select v_expense_id, v_group_id, (e->>'profile_id')::uuid, (e->>'paid_amount_minor')::bigint
  from jsonb_array_elements(v_payers) as e;

  insert into public.expense_splits (expense_id, group_id, profile_id, split_weight, share_amount_minor)
  select v_expense_id, v_group_id, (e->>'profile_id')::uuid,
         nullif(e->>'weight','')::numeric, (e->>'share_amount_minor')::bigint
  from jsonb_array_elements(v_splits) as e;

  -- Derived tables, written here rather than by a trigger so everything lands in one
  -- transaction the balanced-expense constraint can check at commit.
  insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower)
  select v_expense_id, v_group_id, p.profile_id,
         bool_or(p.is_payer), bool_or(p.is_ower)
  from (
    select (e->>'profile_id')::uuid as profile_id, true as is_payer, false as is_ower
    from jsonb_array_elements(v_payers) as e
    union all
    select (e->>'profile_id')::uuid, false, true
    from jsonb_array_elements(v_splits) as e
  ) p
  group by p.profile_id;

  perform app.rebuild_expense_debts(v_expense_id);

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_participants
  from public.expense_participants where expense_id = v_expense_id;

  insert into public.expense_revisions (expense_id, revision, action, actor_profile_id, snapshot, client_mutation_id)
  values (v_expense_id, 1, 'created', v_me, app.expense_snapshot(v_expense_id), p_client_mutation_id);

  -- The group first: a member who is not on the expense gets no expense event, so this is the
  -- only thing that tells them the group exists.
  if v_made_group then
    perform internal.emit_change(
      array_append(v_members, v_me), v_me, v_group_id, 'group', v_group_id, 'insert'
    );
  end if;

  perform internal.emit_change(v_participants, v_me, v_group_id, 'expense', v_expense_id, 'insert');

  v_result := jsonb_build_object('expense_id', v_expense_id, 'group_id', v_group_id, 'revision', 1);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;

/*
 * Add people to a group — now telling the people already in it.
 *
 * The old emit sent to `p_profile_ids`, i.e. only the people being added. Everyone already in
 * the group learned nothing, so their member list silently drifted out of date and their copy
 * of the group would show the wrong member count until something else happened to touch it.
 *
 * Emitting to the post-insert membership covers both halves in one call: the new people (who
 * need to know the group exists) and the existing ones (who need to know it grew).
 */
create or replace function app.add_group_members(
  p_group_id           uuid,
  p_profile_ids        uuid[],
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth_ext.assert_signed_in();
  v_cached     jsonb;
  v_payload    jsonb := jsonb_build_object('group_id', p_group_id, 'profile_ids', to_jsonb(p_profile_ids));
  v_added      integer;
  v_recipients uuid[];
  v_result     jsonb;
begin
  v_cached := internal.claim_mutation(p_client_mutation_id, v_me, 'add_group_members', v_payload);
  if v_cached is not null then
    return v_cached;
  end if;

  perform auth_ext.assert_group_member(p_group_id);

  with ins as (
    insert into public.group_members (group_id, profile_id, role, added_by_profile_id)
    select p_group_id, m, 'member', v_me
    from unnest(p_profile_ids) as m
    on conflict (group_id, profile_id) do nothing
    returning profile_id
  )
  select count(*)::int into v_added from ins;

  select coalesce(array_agg(profile_id), array[]::uuid[]) into v_recipients
  from public.group_members
  where group_id = p_group_id and left_at is null;

  perform internal.emit_change(
    v_recipients, v_me, p_group_id, 'group', p_group_id, 'update'
  );

  v_result := jsonb_build_object('group_id', p_group_id, 'added', v_added);
  return internal.finish_mutation(p_client_mutation_id, v_result);
end;
$$;
