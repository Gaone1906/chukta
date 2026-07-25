-- Identity — the decision that cannot be retrofitted.
--
-- `profiles.id` is the universal participant identity. NOTHING outside this file references
-- auth.users. A person a friend added to an expense but who has never opened the app is just a
-- profile with user_id IS NULL.
--
-- When they sign up, their row is CLAIMED IN PLACE — a single UPDATE sets user_id — and their
-- entire history is already correct, because every expense, split and debt row points at
-- profile_id. Nothing migrates.
--
-- The tempting alternative (expense_splits.user_id -> auth.users, plus a "shadow user"
-- concept) forces a multi-table data migration on every single signup and is miserable to
-- unpick later. Hence this shape from day one.

create table public.profiles (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid unique references auth.users(id) on delete set null,
  display_name            text not null check (length(btrim(display_name)) between 1 and 80),
  avatar_url              text,
  upi_vpa                 text check (upi_vpa ~ '^[\w.\-]{2,64}@[a-zA-Z]{2,32}$'),
  timezone                text not null default 'Asia/Kolkata',
  primary_auth_provider   text check (primary_auth_provider in ('apple','google','phone','email')),
  -- Who invited this placeholder, so the invite can be attributed and rate-limited.
  created_by_profile_id   uuid references public.profiles(id),
  claimed_at              timestamptz,
  -- Tombstone pointer: a merged-away profile keeps its row so stale offline clients holding
  -- the old id can still resolve it.
  merged_into_profile_id  uuid references public.profiles(id),
  merged_at               timestamptz,
  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint profiles_not_merged_into_self check (merged_into_profile_id is distinct from id)
);

comment on column public.profiles.user_id is
  'NULL means a placeholder: invited to an expense but not signed up yet.';

create index profiles_unclaimed_idx on public.profiles (created_by_profile_id) where user_id is null;
create index profiles_merged_idx on public.profiles (merged_into_profile_id) where merged_into_profile_id is not null;
create index profiles_name_trgm_idx on public.profiles using gin (display_name extensions.gin_trgm_ops);

-- Phone/email, normalised. This is what lets a placeholder be recognised at signup.
create type public.contact_kind as enum ('phone','email');

create table public.profile_contact_points (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          public.contact_kind not null,
  value_norm    text not null,          -- E.164 for phone, lower(btrim(...)) for email
  value_display text,
  -- Set only from a verified auth identity. Merging on an unverified contact point would be
  -- a straightforward account-takeover vector.
  verified_at   timestamptz,
  source        text not null default 'self' check (source in ('self','invite','oauth')),
  -- Set when a merge folds this contact point into another profile.
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (profile_id, kind, value_norm)
);

-- The core invariant: one live contact point maps to exactly one identity. This is what makes
-- two friends inviting the same person converge on one profile instead of two.
create unique index contact_points_live_unique
  on public.profile_contact_points (kind, value_norm)
  where retired_at is null;

-- Invite deep links. Only the hash is stored, never the token itself.
create table public.profile_claims (
  id                     uuid primary key default gen_random_uuid(),
  placeholder_profile_id uuid not null references public.profiles(id) on delete cascade,
  token_sha256           bytea not null unique,
  created_by_profile_id  uuid not null references public.profiles(id),
  expires_at             timestamptz not null default now() + interval '90 days',
  claimed_by_user_id     uuid references auth.users(id),
  claimed_at             timestamptz,
  created_at             timestamptz not null default now()
);

create index profile_claims_placeholder_idx on public.profile_claims (placeholder_profile_id);

-- Audit trail for merges. Money moved between identities; that should never be silent.
create table internal.profile_merges (
  id                bigserial primary key,
  source_profile_id uuid not null,
  target_profile_id uuid not null,
  actor_profile_id  uuid,
  reason            text not null check (reason in ('signup_claim','token_claim','verified_link','manual')),
  row_counts        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- Keep updated_at honest without every RPC having to remember it.
create or replace function internal.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function internal.touch_updated_at();
