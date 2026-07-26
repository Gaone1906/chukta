-- Development seed. Applied automatically by `supabase db reset`.
--
-- Mirrors the names and amounts in the design prototypes so screens can be held next to
-- design-reference/screens/ and compared directly.
--
-- Deliberately includes the states that are easy to forget and hard to hand-craft later:
--   * a fully SETTLED group (Sunday football) — exercises the checkmark badge
--   * a PLACEHOLDER participant (Priya, never signed up) — exercises the invite path
--   * a group-less ONE-OFF expense — exercises the nullable group_id
--   * a MULTI-PAYER expense — exercises the netting in rebuild_expense_debts
--   * amounts that do not divide evenly, so the allocator's leftover paisa is visible
--
-- The signed-in dev user is wired up by src/features/auth/devSignIn.ts. This seed creates
-- everyone else and then attaches them once that account exists — see the DO block at the end.

/*
 * Dev-only helper: insert a complete, balanced expense split equally.
 *
 * Defined here rather than in a migration so it never reaches the production schema, and
 * dropped at the end of this file. Uses app.allocate_minor for the split so seeded data goes
 * through exactly the same allocator as the app — an uneven amount really does leave one
 * person a paisa heavier, which is what makes the UI worth looking at.
 */
create or replace function internal.seed_expense(
  p_id           uuid,
  p_group_id     uuid,
  p_description  text,
  p_amount_minor bigint,
  p_payer        uuid,
  p_participants uuid[],
  p_spent_on     date
)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_keys   text[];
  v_shares bigint[];
  i        integer;
begin
  if exists (select 1 from public.expenses where id = p_id) then
    return;
  end if;

  -- Keys must be ordered the same way the shares are indexed.
  select array_agg(p order by p) into v_keys
  from unnest(p_participants) p;

  v_shares := app.allocate_minor(
    p_amount_minor,
    array_fill(1::numeric, array[array_length(p_participants, 1)]),
    v_keys
  );

  insert into public.expenses
    (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
  values
    (p_id, p_group_id, p_description, p_amount_minor, 'equal', p_spent_on, p_payer);

  insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
  values (p_id, p_group_id, p_payer, p_amount_minor);

  for i in 1 .. array_length(v_keys, 1) loop
    insert into public.expense_splits (expense_id, group_id, profile_id, share_amount_minor)
    values (p_id, p_group_id, v_keys[i]::uuid, v_shares[i]);
  end loop;

  insert into public.expense_participants (expense_id, group_id, profile_id, is_payer, is_ower)
  select p_id, p_group_id, x.profile_id, bool_or(x.is_payer), bool_or(x.is_ower)
  from (
    select p_payer as profile_id, true as is_payer, false as is_ower
    union all
    select k::uuid, false, true from unnest(v_keys) k
  ) x
  group by x.profile_id;

  perform app.rebuild_expense_debts(p_id);
end;
$fn$;

-- Stable ids so the seed is re-runnable and referencable from tests.
insert into public.profiles (id, display_name, upi_vpa) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Priya Sharma', 'priya@okhdfcbank'),
  ('aaaa0000-0000-4000-8000-000000000002', 'Arjun Verma',  'arjun@okaxis'),
  ('aaaa0000-0000-4000-8000-000000000003', 'Meher Irani',  null),
  ('aaaa0000-0000-4000-8000-000000000004', 'Kabir Shah',   'kabir@oksbi'),
  ('aaaa0000-0000-4000-8000-000000000005', 'Rhea Kapoor',  'rhea@okicici')
on conflict (id) do nothing;

-- Priya is a placeholder: invited to expenses, never opened the app. Her contact point is
-- what a real signup would match against to claim this profile in place.
insert into public.profile_contact_points (profile_id, kind, value_norm, source) values
  ('aaaa0000-0000-4000-8000-000000000001', 'email', 'priya@example.com', 'invite')
on conflict do nothing;

/*
 * Everything below hangs off whichever dev account is signed in, so it is built inside a
 * DO block that resolves that profile at run time. If nobody has signed in yet the seed
 * quietly does nothing — the app creates the account on first dev sign-in, and a
 * `supabase db reset` afterwards fills it in.
 */
do $$
declare
  v_me        uuid;
  v_goa       uuid := 'bbbb0000-0000-4000-8000-000000000001';
  v_flat      uuid := 'bbbb0000-0000-4000-8000-000000000002';
  v_football  uuid := 'bbbb0000-0000-4000-8000-000000000003';
  v_priya     uuid := 'aaaa0000-0000-4000-8000-000000000001';
  v_arjun     uuid := 'aaaa0000-0000-4000-8000-000000000002';
  v_meher     uuid := 'aaaa0000-0000-4000-8000-000000000003';
  v_kabir     uuid := 'aaaa0000-0000-4000-8000-000000000004';
begin
  /*
   * The dev account by ADDRESS, not by creation order.
   *
   * This used to take the earliest signed-in profile, which is the same thing right up until
   * the sign-in screen's "New account" button is pressed — that mints a `dev-<random>` account,
   * and from then on which profile the fixtures land on depends on tap history. It cost real
   * time three separate times: the app shows "No groups yet", the database plainly contains
   * three groups, and nothing connects the two.
   *
   * `dev@chukta.test` is `devSignIn`'s default (features/auth/devSignIn.ts), so the seeded
   * account and the account the Dev sign-in button logs into are now the same thing by
   * construction rather than by luck.
   */
  select p.id into v_me
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where u.email = 'dev@chukta.test' and p.deleted_at is null;

  if v_me is null then
    raise notice 'seed: no dev@chukta.test account yet — create it, then re-run the seed';
    return;
  end if;

  -- ---------------------------------------------------------------- groups

  insert into public.groups (id, name, created_by_profile_id) values
    (v_goa,      'Goa, finally',    v_me),
    (v_flat,     'Flat 302',        v_me),
    (v_football, 'Sunday football', v_me)
  on conflict (id) do nothing;

  insert into public.group_members (group_id, profile_id, role) values
    (v_goa, v_me, 'owner'), (v_goa, v_priya, 'member'), (v_goa, v_arjun, 'member'),
    (v_goa, v_meher, 'member'),
    (v_flat, v_me, 'owner'), (v_flat, v_arjun, 'member'), (v_flat, v_meher, 'member'),
    (v_football, v_me, 'owner'), (v_football, v_kabir, 'member')
  on conflict do nothing;

  -- ------------------------------------------------- Goa: single payer, uneven split
  -- 4,320 across four people is 1,080 each — clean. 2,850 across four is not: the allocator
  -- has to hand out the leftover two paisa, and the UI must still total exactly.
  perform internal.seed_expense(
    'cccc0000-0000-4000-8000-000000000001', v_goa, 'Beach shack dinner', 432000, v_me,
    array[v_me, v_priya, v_arjun, v_meher], current_date - 6);

  perform internal.seed_expense(
    'cccc0000-0000-4000-8000-000000000002', v_goa, 'Airport cabs', 285000, v_arjun,
    array[v_me, v_priya, v_arjun, v_meher], current_date - 5);

  -- ------------------------------------------------- Flat 302
  perform internal.seed_expense(
    'cccc0000-0000-4000-8000-000000000003', v_flat, 'Groceries', 184000, v_me,
    array[v_me, v_arjun, v_meher], current_date - 3);

  -- ------------------------------------------------- one-off, no group
  perform internal.seed_expense(
    'cccc0000-0000-4000-8000-000000000004', null, 'Concert tickets', 700000, v_me,
    array[v_me, v_priya], current_date - 1);

  -- ------------------------------------------------- Sunday football: fully settled
  -- Expense then an exactly matching settlement, so the balance nets to zero and the row
  -- shows the gold checkmark rather than an amount.
  perform internal.seed_expense(
    'cccc0000-0000-4000-8000-000000000005', v_football, 'Turf booking', 330000, v_me,
    array[v_me, v_kabir], current_date - 10);

  insert into public.settlements
    (id, group_id, from_profile_id, to_profile_id, amount_minor, method, settled_on, recorded_by_profile_id, status)
  values
    ('dddd0000-0000-4000-8000-000000000001', v_football, v_kabir, v_me, 165000, 'upi',
     current_date - 9, v_me, 'confirmed')
  on conflict (id) do nothing;

  raise notice 'seed: attached fixtures to profile %', v_me;
end;
$$;

-- Dev-only; never part of the deployed schema.
drop function if exists internal.seed_expense(uuid, uuid, text, bigint, uuid, uuid[], date);
