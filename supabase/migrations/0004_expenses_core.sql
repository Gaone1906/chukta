-- Expenses, and the tables derived from them.
--
-- Two structural choices worth understanding before changing anything here:
--
-- 1. `group_id` is NULLABLE. A null means a one-off expense between people, exactly as the
--    design describes: naming the group field promotes the participant set into a group,
--    leaving it blank does not.
--
-- 2. Every child table carries a DENORMALISED `group_id` with a composite foreign key back to
--    `expenses(id, group_id)`. That is not redundancy for its own sake — it makes each child's
--    RLS policy flat and self-contained instead of joining back to `expenses` on every row,
--    and the composite FK makes the two drifting apart structurally impossible.

create type public.split_type as enum ('equal','exact','percentage','shares','itemized');
create type public.item_kind as enum ('line','tax','tip','discount');

create table public.expenses (
  id                    uuid primary key,   -- client-generated, so offline creates are self-referential
  group_id              uuid references public.groups(id),
  description           text not null check (length(btrim(description)) between 1 and 120),
  category              text,
  amount_minor          bigint not null check (amount_minor > 0),
  currency              char(3) not null default 'INR' check (currency = 'INR'),
  split_type            public.split_type not null,
  spent_on              date not null,
  created_by_profile_id uuid not null references public.profiles(id),
  receipt_count         smallint not null default 0,
  -- Optimistic concurrency for the offline outbox: update_expense takes an expected revision
  -- and refuses to clobber a newer one.
  revision              integer not null default 1 check (revision > 0),
  deleted_at            timestamptz,
  deleted_by_profile_id uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Target of the child tables' composite FKs.
  unique (id, group_id)
);

create index expenses_group_feed_idx on public.expenses (group_id, spent_on desc, id) where deleted_at is null;
create index expenses_updated_idx on public.expenses (updated_at);

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function internal.touch_updated_at();

-- Who actually paid. Multiple rows = a multi-payer expense.
create table public.expense_payers (
  expense_id        uuid not null,
  group_id          uuid,
  profile_id        uuid not null references public.profiles(id),
  paid_amount_minor bigint not null check (paid_amount_minor > 0),
  primary key (expense_id, profile_id),
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

create index expense_payers_profile_idx on public.expense_payers (profile_id);

-- Who owes what. Whatever split type was chosen, it is flattened to this — nothing downstream
-- ever needs to know an expense was itemised or percentage-based.
create table public.expense_splits (
  expense_id         uuid not null,
  group_id           uuid,
  profile_id         uuid not null references public.profiles(id),
  -- The input as entered (share count, percentage, ...), kept so the form can be re-opened
  -- for editing. share_amount_minor is the authoritative money value.
  split_weight       numeric(18,6),
  share_amount_minor bigint not null check (share_amount_minor >= 0),
  primary key (expense_id, profile_id),
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

create index expense_splits_profile_idx on public.expense_splits (profile_id, expense_id);

-- Itemised inputs. Present only for split_type = 'itemized'; the flattened result still lives
-- in expense_splits.
create table public.expense_items (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null,
  group_id     uuid,
  position     integer not null,
  name         text not null check (length(btrim(name)) between 1 and 80),
  amount_minor bigint not null check (amount_minor >= 0),
  kind         public.item_kind not null default 'line',
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

create index expense_items_expense_idx on public.expense_items (expense_id, position);

create table public.expense_item_shares (
  item_id    uuid not null references public.expense_items(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  primary key (item_id, profile_id)
);

-- Pairwise debts, resolved at write time inside the same transaction as the expense.
-- Netting happens before this table is written, so a payer who also owes never self-edges.
create table public.expense_debts (
  expense_id      uuid not null,
  group_id        uuid,
  from_profile_id uuid not null references public.profiles(id),
  to_profile_id   uuid not null references public.profiles(id),
  amount_minor    bigint not null check (amount_minor > 0),
  currency        char(3) not null default 'INR' check (currency = 'INR'),
  primary key (expense_id, from_profile_id, to_profile_id),
  constraint expense_debts_no_self_edge check (from_profile_id <> to_profile_id),
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

-- Balances are a plain aggregate over these two indexes. Deliberately not a maintained
-- balance table: that would be faster but can drift, and a drifting balance is worse than a
-- few milliseconds.
create index expense_debts_from_idx on public.expense_debts (from_profile_id, to_profile_id);
create index expense_debts_to_idx on public.expense_debts (to_profile_id, from_profile_id);
create index expense_debts_group_idx on public.expense_debts (group_id);

-- Everyone touched by an expense, payer or ower. Exists so RLS on a group-less one-off
-- expense has something flat to check, and so Person detail is a single index scan.
create table public.expense_participants (
  expense_id uuid not null,
  group_id   uuid,
  profile_id uuid not null references public.profiles(id),
  is_payer   boolean not null default false,
  is_ower    boolean not null default false,
  primary key (expense_id, profile_id),
  foreign key (expense_id, group_id) references public.expenses(id, group_id) on delete cascade
);

create index expense_participants_profile_idx on public.expense_participants (profile_id, expense_id);
