-- The allocator, and the invariant that makes every downstream balance trustworthy.
--
-- THIS MUST MATCH packages/core/src/allocate.ts EXACTLY. The client computes a live split
-- preview offline; if the server then hands the spare paisa to a different person, the same
-- expense shows different numbers on two devices. The canonical cases live in
-- packages/core/src/fixtures.ts and are asserted against this function in
-- supabase/tests/allocator.test.sql — if one side changes, both change.

-- Floor division. Postgres integer division truncates toward zero, which is wrong for
-- negative totals (refunds): the floors would sum to MORE than the total, making the leftover
-- negative and the distribution loop silently incorrect.
create or replace function app.floor_div(numerator numeric, denominator numeric)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select floor(numerator / denominator);
$$;

/*
 * Largest-remainder (Hamilton) allocation.
 *
 *   1. exact_i = total * weight_i / W          -- exact rational, numeric throughout
 *   2. base_i  = floor(exact_i)
 *   3. R       = total - sum(base_i)           -- always in [0, n)
 *   4. order by fractional remainder desc, then weight desc, then key asc
 *   5. one extra minor unit to the first R participants
 *
 * Step 4's key tiebreak is what makes this reproducible rather than dependent on row order.
 */
create or replace function app.allocate_minor(
  p_total   bigint,
  p_weights numeric[],
  p_keys    text[]
)
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n            integer := coalesce(array_length(p_weights, 1), 0);
  v_total_weight numeric := 0;
  v_base         bigint[];
  v_remainder    numeric[];
  v_distributed  bigint := 0;
  v_leftover     bigint;
  v_numerator    numeric;
  v_quotient     numeric;
  i              integer;
  v_index        integer;
begin
  if v_n = 0 then
    raise exception 'allocate_minor: no participants';
  end if;

  if coalesce(array_length(p_keys, 1), 0) <> v_n then
    raise exception 'allocate_minor: % weights but % keys', v_n, coalesce(array_length(p_keys, 1), 0);
  end if;

  for i in 1 .. v_n loop
    if p_weights[i] < 0 then
      raise exception 'allocate_minor: weights must be non-negative';
    end if;
    v_total_weight := v_total_weight + p_weights[i];
  end loop;

  if v_total_weight = 0 then
    raise exception 'allocate_minor: weights sum to zero';
  end if;

  v_base := array_fill(0::bigint, array[v_n]);
  v_remainder := array_fill(0::numeric, array[v_n]);

  for i in 1 .. v_n loop
    v_numerator := p_total::numeric * p_weights[i];
    v_quotient := app.floor_div(v_numerator, v_total_weight);
    v_base[i] := v_quotient::bigint;
    -- Fractional part kept as an exact numerator over the shared denominator, so remainders
    -- compare exactly with no floating point in the ordering.
    v_remainder[i] := v_numerator - v_quotient * v_total_weight;
    v_distributed := v_distributed + v_base[i];
  end loop;

  v_leftover := p_total - v_distributed;

  if v_leftover > 0 then
    for v_index in
      select idx
      from unnest(p_weights, p_keys) with ordinality as t(weight, key, idx)
      order by v_remainder[t.idx] desc, t.weight desc, t.key asc
      limit v_leftover
    loop
      v_base[v_index] := v_base[v_index] + 1;
    end loop;
  end if;

  return v_base;
end;
$$;

comment on function app.allocate_minor(bigint, numeric[], text[]) is
  'Largest-remainder allocation. Must stay byte-identical to packages/core/src/allocate.ts.';

/*
 * The guardrail.
 *
 * Deferred to commit time so an RPC can write parent-then-children in one transaction. Every
 * balance in the app is only as trustworthy as this trigger.
 */
create or replace function internal.assert_expense_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_amount     bigint;
  v_paid       bigint;
  v_owed       bigint;
  v_payers     integer;
  v_splits     integer;
  v_deleted    timestamptz;
begin
  select amount_minor, deleted_at into v_amount, v_deleted
  from public.expenses where id = new.id;

  -- The row may have been removed later in the same transaction.
  if not found then
    return null;
  end if;

  -- A soft-deleted expense keeps its rows but is no longer required to balance, since delete
  -- is recorded rather than cascading.
  if v_deleted is not null then
    return null;
  end if;

  select coalesce(sum(paid_amount_minor), 0), count(*)
    into v_paid, v_payers
  from public.expense_payers where expense_id = new.id;

  select coalesce(sum(share_amount_minor), 0), count(*)
    into v_owed, v_splits
  from public.expense_splits where expense_id = new.id;

  if v_payers = 0 then
    raise exception 'expense % has no payers', new.id using errcode = 'check_violation';
  end if;

  if v_splits = 0 then
    raise exception 'expense % has no splits', new.id using errcode = 'check_violation';
  end if;

  if v_paid <> v_amount then
    raise exception 'expense %: payers sum to % but the total is %', new.id, v_paid, v_amount
      using errcode = 'check_violation';
  end if;

  if v_owed <> v_amount then
    raise exception 'expense %: splits sum to % but the total is %', new.id, v_owed, v_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger trg_expense_balanced
  after insert or update on public.expenses
  deferrable initially deferred
  for each row execute function internal.assert_expense_balanced();
