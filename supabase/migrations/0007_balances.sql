-- Balances, derived rather than stored.
--
-- Everything hangs off one orientation-normalised view: each pair is recorded once, with `lo`
-- the lower profile id and `hi` the higher, and the SIGN carrying the direction. Normalising
-- the pair means "a owes b" and "b owes a" can never both exist and disagree.
--
-- Positive `amt` means the LOWER id owes the HIGHER id.

create or replace view app.v_pair_ledger as
  -- Debts created by expenses.
  select
    d.group_id,
    least(d.from_profile_id, d.to_profile_id)    as lo,
    greatest(d.from_profile_id, d.to_profile_id) as hi,
    d.currency                                   as ccy,
    case when d.from_profile_id < d.to_profile_id
         then  d.amount_minor
         else -d.amount_minor end                as amt
  from public.expense_debts d
  join public.expenses e on e.id = d.expense_id
  where e.deleted_at is null

  union all

  -- Settlements reduce the debt, so they carry the opposite sign.
  select
    s.group_id,
    least(s.from_profile_id, s.to_profile_id),
    greatest(s.from_profile_id, s.to_profile_id),
    s.currency,
    case when s.from_profile_id < s.to_profile_id
         then -s.amount_minor
         else  s.amount_minor end
  from public.settlements s
  where s.deleted_at is null
    and s.status in ('recorded','confirmed');

comment on view app.v_pair_ledger is
  'Every money movement as a normalised pair edge. Positive means the lower id owes the higher.';

-- Net position between two people, across everything.
create or replace view app.v_pair_balances as
  select lo, hi, ccy, sum(amt) as net_minor
  from app.v_pair_ledger
  group by lo, hi, ccy
  having sum(amt) <> 0;

-- Net position per person within one group. Positive means they are OWED money.
create or replace view app.v_group_balances as
  select group_id, profile_id, ccy, sum(net) as net_minor
  from (
    select group_id, lo as profile_id, ccy, -sum(amt) as net
    from app.v_pair_ledger group by group_id, lo, ccy
    union all
    select group_id, hi as profile_id, ccy, sum(amt) as net
    from app.v_pair_ledger group by group_id, hi, ccy
  ) t
  group by group_id, profile_id, ccy
  having sum(net) <> 0;

comment on view app.v_group_balances is
  'Per-person net inside a group. Positive = owed to them. Aggregated live, never stored: a '
  'maintained balance table would be faster but can drift, and a drifting balance is worse '
  'than a few milliseconds.';
