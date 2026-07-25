-- Groups and membership.
--
-- Note what is NOT here: a "one-off expense" group. Expenses between people who never named a
-- group simply have group_id IS NULL (see 0004). Modelling those as hidden groups would mean
-- filtering them out of the Groups tab forever, and would leave orphan rows behind every
-- abandoned add-expense draft.

create table public.groups (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (length(btrim(name)) between 1 and 60),
  -- v1 is INR only; the column exists so relaxing that later is a dropped constraint rather
  -- than a schema migration across every money table. See plan/PROGRESS.md.
  currency              char(3) not null default 'INR' check (currency = 'INR'),
  -- Whether Group detail shows simplified debts. Some people find "pay Meher, whom you never
  -- transacted with" genuinely confusing, so it is per-group rather than global.
  simplify_debts        boolean not null default true,
  created_by_profile_id uuid not null references public.profiles(id),
  archived_at           timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index groups_active_idx on public.groups (created_by_profile_id) where deleted_at is null;

create table public.group_members (
  group_id            uuid not null references public.groups(id) on delete cascade,
  profile_id          uuid not null references public.profiles(id),
  role                text not null default 'member' check (role in ('owner','member')),
  added_by_profile_id uuid references public.profiles(id),
  joined_at           timestamptz not null default now(),
  left_at             timestamptz,
  primary key (group_id, profile_id)
);

-- Drives "which groups am I in", which every RLS policy depends on.
create index group_members_profile_idx on public.group_members (profile_id) where left_at is null;

create trigger groups_touch_updated_at
  before update on public.groups
  for each row execute function internal.touch_updated_at();
