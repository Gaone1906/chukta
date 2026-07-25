-- Delta sync, storage buckets, and recurring expense templates.

/*
 * The offline client's catch-up call: "everything for me since event N".
 *
 * Reconnect order is fixed and matters — drain the outbox, THEN pull, THEN resubscribe.
 * Pulling first would clobber local optimistic state with rows the server has not yet been
 * told about.
 *
 * Returns `full_resync` when the cursor has fallen outside the retention window, so a client
 * that has been offline for a month rehydrates from scratch instead of silently missing rows.
 */
create or replace function app.sync_pull(
  p_since_event_id bigint default 0,
  p_limit          integer default 500
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_me        uuid := auth_ext.assert_signed_in();
  v_oldest    bigint;
  v_events    jsonb;
  v_cursor    bigint;
begin
  select min(id) into v_oldest from internal.change_events;

  if p_since_event_id > 0 and v_oldest is not null and p_since_event_id < v_oldest - 1 then
    return jsonb_build_object('full_resync', true, 'cursor', coalesce((select max(id) from internal.change_events), 0));
  end if;

  select coalesce(jsonb_agg(e order by (e->>'id')::bigint), '[]'::jsonb), max((e->>'id')::bigint)
    into v_events, v_cursor
  from (
    select jsonb_build_object(
      'id', ce.id,
      'entity_type', ce.entity_type,
      'entity_id', ce.entity_id,
      'op', ce.op,
      'group_id', ce.group_id,
      'actor_profile_id', ce.actor_profile_id,
      'payload', ce.payload,
      'created_at', ce.created_at
    ) as e
    from internal.change_events ce
    where ce.recipient_profile_id = v_me
      and ce.id > p_since_event_id
    order by ce.id
    limit greatest(1, least(p_limit, 2000))
  ) t;

  return jsonb_build_object(
    'full_resync', false,
    'events', v_events,
    'cursor', coalesce(v_cursor, p_since_event_id)
  );
end;
$$;

revoke all on function app.sync_pull(bigint, integer) from public;
grant execute on function app.sync_pull(bigint, integer) to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/heic','image/webp']),
  ('avatars',  'avatars',  true,   2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Receipts are private and gated on the expense, not on the uploader: everyone who can see the
-- expense can see its receipt, and nobody else. Path is receipts/{expense_id}/{uuid}.jpg.
create policy receipts_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (select auth_ext.can_read_expense(((storage.foldername(name))[1])::uuid))
  );

create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (select auth_ext.can_read_expense(((storage.foldername(name))[1])::uuid))
  );

create policy receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (select auth_ext.can_read_expense(((storage.foldername(name))[1])::uuid))
  );

-- Avatars are world-readable (they appear next to your name in other people's groups) but
-- only writable by their owner. Path is avatars/{profile_id}/...
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

create policy avatars_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth_ext.current_profile_id())
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth_ext.current_profile_id())
  );

-- ---------------------------------------------------------------- recurring

create table public.recurring_expense_rules (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid references public.groups(id) on delete cascade,
  -- The same payload shape app.create_expense accepts, minus the id.
  template              jsonb not null,
  frequency             text not null check (frequency in ('daily','weekly','monthly','yearly')),
  interval_count        integer not null default 1 check (interval_count > 0),
  day_of_month          smallint check (day_of_month between 1 and 31),
  weekday               smallint check (weekday between 0 and 6),
  start_on              date not null,
  end_on                date,
  max_occurrences       integer,
  timezone              text not null default 'Asia/Kolkata',
  next_run_on           date not null,
  last_run_on           date,
  is_paused             boolean not null default false,
  created_by_profile_id uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index recurring_due_idx on public.recurring_expense_rules (next_run_on) where is_paused = false;

-- THE idempotency guard for recurring expenses. Without this composite key, a cron retry
-- posts the rent twice.
create table public.recurring_expense_runs (
  rule_id    uuid not null references public.recurring_expense_rules(id) on delete cascade,
  run_on     date not null,
  expense_id uuid references public.expenses(id),
  created_at timestamptz not null default now(),
  primary key (rule_id, run_on)
);

alter table public.recurring_expense_rules enable row level security;
alter table public.recurring_expense_runs enable row level security;

create policy recurring_rules_read on public.recurring_expense_rules
  for select to authenticated
  using (
    created_by_profile_id = (select auth_ext.current_profile_id())
    or (group_id is not null and group_id in (select auth_ext.my_group_ids()))
  );

create policy recurring_runs_read on public.recurring_expense_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_expense_rules r
      where r.id = recurring_expense_runs.rule_id
        and (r.created_by_profile_id = (select auth_ext.current_profile_id())
          or (r.group_id is not null and r.group_id in (select auth_ext.my_group_ids())))
    )
  );

grant select on public.recurring_expense_rules, public.recurring_expense_runs to authenticated;

create trigger recurring_rules_touch_updated_at
  before update on public.recurring_expense_rules
  for each row execute function internal.touch_updated_at();

/*
 * Advance a rule's next run date.
 *
 * Clamps the day of month so a rule set for the 31st still fires in February rather than
 * being skipped or landing in March.
 */
create or replace function app.next_recurrence(
  p_from           date,
  p_frequency      text,
  p_interval_count integer,
  p_day_of_month   smallint
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'daily'   then p_from + (p_interval_count || ' days')::interval
    when 'weekly'  then p_from + (p_interval_count || ' weeks')::interval
    when 'yearly'  then p_from + (p_interval_count || ' years')::interval
    when 'monthly' then
      (date_trunc('month', p_from + (p_interval_count || ' months')::interval)
       + (least(
            coalesce(p_day_of_month, extract(day from p_from)::smallint),
            extract(day from (date_trunc('month', p_from + (p_interval_count || ' months')::interval)
                              + interval '1 month - 1 day'))::smallint
          ) - 1 || ' days')::interval)
  end::date;
$$;
