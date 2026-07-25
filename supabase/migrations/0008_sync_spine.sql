-- One table doing three jobs: Realtime fan-out, offline delta-sync cursor, and the push
-- notification source.
--
-- Clients open exactly ONE Realtime subscription — change_events filtered to their own
-- profile — rather than subscribing to five money tables and paying a per-row RLS check on
-- each. Every write RPC appends one row per recipient inside the same transaction as the data,
-- so all three consumers are consistent with the data by construction rather than by luck.
--
-- The cost is write amplification: a six-person expense writes six rows. That is the trade.

create table internal.change_events (
  id                   bigserial primary key,
  recipient_profile_id uuid not null,
  actor_profile_id     uuid,
  group_id             uuid,
  entity_type          text not null check (entity_type in ('expense','settlement','comment','group','member','profile')),
  entity_id            uuid not null,
  op                   text not null check (op in ('insert','update','delete')),
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- The delta-sync cursor: "everything for me since event N".
create index change_events_recipient_idx on internal.change_events (recipient_profile_id, id);
create index change_events_created_idx on internal.change_events (created_at);

-- Idempotency. This is the case that WILL happen on mobile: the server committed, the response
-- was lost, the client retries from its outbox. Without this the retry duplicates the expense.
create table internal.mutation_log (
  client_mutation_id uuid primary key,
  profile_id         uuid not null,
  op                 text not null,
  request_sha256     bytea not null,
  result             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index mutation_log_created_idx on internal.mutation_log (created_at);

-- Push notification queue. Deliberately a queue drained by cron rather than an HTTP call
-- inside the mutation transaction: that is what makes coalescing possible at all, and it means
-- a push outage can never fail an expense write.
create table internal.notification_queue (
  id                   bigserial primary key,
  recipient_profile_id uuid not null,
  event_id             bigint references internal.change_events(id) on delete cascade,
  kind                 text not null,
  -- Rows sharing a coalesce_key collapse into one notification, so someone entering a trip's
  -- eleven receipts produces one push rather than eleven.
  coalesce_key         text not null,
  title                text not null,
  body                 text not null,
  data                 jsonb not null default '{}'::jsonb,
  not_before           timestamptz not null default now() + interval '45 seconds',
  status               text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  attempts             integer not null default 0,
  sent_at              timestamptz,
  error                text,
  created_at           timestamptz not null default now()
);

create index notification_queue_due_idx on internal.notification_queue (not_before) where status = 'pending';

create table public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform        text not null check (platform in ('ios','android')),
  device_id       text not null,
  app_version     text,
  timezone        text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  disabled_at     timestamptz,
  disabled_reason text,
  unique (profile_id, device_id)
);

create table public.notification_prefs (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  new_expenses     boolean not null default true,
  expense_edits    boolean not null default true,
  comments         boolean not null default true,
  settlements      boolean not null default true,
  reminders        boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end   time
);

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete set null,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  app_version text,
  platform    text,
  created_at  timestamptz not null default now()
);
