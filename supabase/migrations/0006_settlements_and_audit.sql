-- Settlements, comments, and the edit/delete audit trail.

create type public.settlement_method as enum ('upi','cash','bank','other');

create table public.settlements (
  id                      uuid primary key,   -- client-generated, like expenses
  -- NULL means a person-level settlement that spans groups, which is what the Person detail
  -- screen records. Settling from Group detail sets it.
  group_id                uuid references public.groups(id),
  from_profile_id         uuid not null references public.profiles(id),
  to_profile_id           uuid not null references public.profiles(id),
  amount_minor            bigint not null check (amount_minor > 0),
  currency                char(3) not null default 'INR' check (currency = 'INR'),
  method                  public.settlement_method not null default 'upi',
  note                    text check (note is null or length(note) <= 200),
  settled_on              date not null,
  recorded_by_profile_id  uuid not null references public.profiles(id),
  -- Settlement is SELF-REPORTED. Nothing here is verified against a bank; the counterparty
  -- may optionally confirm, which is the honest version of that.
  confirmed_by_profile_id uuid references public.profiles(id),
  confirmed_at            timestamptz,
  status                  text not null default 'recorded'
                            check (status in ('recorded','confirmed','disputed','voided','voided_by_merge')),
  revision                integer not null default 1,
  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint settlements_no_self_payment check (from_profile_id <> to_profile_id)
);

create index settlements_pair_idx on public.settlements (from_profile_id, to_profile_id, settled_on desc) where deleted_at is null;
create index settlements_group_idx on public.settlements (group_id, settled_on desc) where deleted_at is null;

create trigger settlements_touch_updated_at
  before update on public.settlements
  for each row execute function internal.touch_updated_at();

create table public.expense_comments (
  id                uuid primary key default gen_random_uuid(),
  expense_id        uuid not null,
  group_id          uuid,
  author_profile_id uuid not null references public.profiles(id),
  body              text not null check (length(btrim(body)) between 1 and 2000),
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz,
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

create index expense_comments_feed_idx on public.expense_comments (expense_id, created_at desc) where deleted_at is null;

create table public.expense_attachments (
  id                     uuid primary key default gen_random_uuid(),
  expense_id             uuid not null,
  group_id               uuid,
  storage_path           text not null unique,   -- receipts/{expense_id}/{uuid}.jpg
  mime_type              text not null,
  byte_size              integer,
  uploaded_by_profile_id uuid not null references public.profiles(id),
  created_at             timestamptz not null default now(),
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

-- Full snapshots, not diffs.
--
-- An expense document is under 4 KB, so storing the whole thing makes "restore this version"
-- and the offline conflict diff trivial, and ten thousand users generate megabytes rather than
-- gigabytes. `diff` is precomputed only so the history list renders without loading two
-- snapshots to compare.
create table public.expense_revisions (
  id                 bigserial primary key,
  expense_id         uuid not null,
  revision           integer not null,
  action             text not null check (action in ('created','updated','deleted','restored','merged_participants')),
  actor_profile_id   uuid references public.profiles(id),
  snapshot           jsonb not null,
  diff               jsonb,
  client_mutation_id uuid,
  created_at         timestamptz not null default now(),
  unique (expense_id, revision, action)
);

create index expense_revisions_expense_idx on public.expense_revisions (expense_id, revision desc);
