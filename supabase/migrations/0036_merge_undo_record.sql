-- Make a merge reversible.
--
-- ---------------------------------------------------------------- what is actually lost today
--
-- `app.merge_profiles` is the most destructive operation in this schema and the only one with
-- no way back. Three kinds of loss, in increasing order of how badly they hurt:
--
-- 1. **The source's identity is overwritten.** The tombstone sets `display_name` to
--    'Merged account' and nulls `avatar_url` and `upi_vpa`. Whoever that placeholder was, that
--    is gone.
--
-- 2. **Repointed rows become indistinguishable.** `update ... set profile_id = target where
--    profile_id = source` is reversible only if you know WHICH rows moved, and afterwards the
--    target owns its own rows and the source's with nothing to tell them apart.
--
-- 3. **Colliding money rows are SUMMED and the source row deleted** (`0013:227`). When one
--    person split with their own placeholder, `share_amount_minor` becomes the total of both
--    and the second row is gone. You cannot later tell whether ₹500 was 200+300 or 100+400.
--    This is real money, and it is the one that cannot be reconstructed from anything else in
--    the database.
--
-- And `internal.profile_merges` — the table that exists precisely to record this — stored
-- `row_counts` = `{"source": uuid, "target": uuid}`. Not counts. Two columns that were already
-- there, under a name promising something else.
--
-- ---------------------------------------------------------------- what is captured, and why it suffices
--
-- **The source's rows, verbatim, before anything is touched.** That is sufficient for all three
-- losses, and the reason is worth stating because it is not obvious:
--
--     target_after = target_before + source     (for every summed row)
--  => target_before = target_after − source
--
-- So the source's own values are enough to undo a sum; nothing about the target needs storing.
-- Repointed rows are identified by being in the captured set. Identity fields come back from
-- the captured profile row. And the volume is bounded — a source is always an unclaimed
-- placeholder, so this is one person's history, not the table.
--
-- This deliberately stops at RECORDING. An automated `unmerge` is not built, and that is a
-- decision rather than an omission: by the time anybody wants one, the target will have carried
-- on being used, and blindly re-splitting rows that have since been edited would turn a
-- recoverable mistake into a corrupt ledger. What this guarantees is that a human with database
-- access can always reconstruct exactly what was there. That is the difference between a
-- support problem and an apology.

alter table internal.profile_merges
  add column if not exists undo jsonb not null default '{}'::jsonb;

comment on column internal.profile_merges.undo is
  'The source profile and every row belonging to it, captured verbatim immediately before the '
  'merge mutated anything. Enough to reconstruct the pre-merge state by hand — see 0036.';

comment on column internal.profile_merges.row_counts is
  'How many rows each table contributed. Genuinely counts since 0036; before that it held the '
  'two profile ids, which were already their own columns.';

create or replace function app.merge_profiles(
  p_source uuid,
  p_target uuid,
  p_reason text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source     public.profiles%rowtype;
  v_target     public.profiles%rowtype;
  v_counts     jsonb := '{}'::jsonb;
  v_undo       jsonb := '{}'::jsonb;
  v_recipients uuid[];
begin
  if p_source = p_target then
    raise exception 'cannot merge a profile into itself' using errcode = '22023';
  end if;

  -- Lock in a stable order so two concurrent merges cannot deadlock against each other.
  perform 1 from public.profiles
   where id in (p_source, p_target)
   order by id
   for update;

  select * into v_source from public.profiles where id = p_source;
  select * into v_target from public.profiles where id = p_target;

  if v_source.id is null or v_target.id is null then
    raise exception 'merge_profiles: profile not found' using errcode = 'P0002';
  end if;
  if v_source.merged_into_profile_id is not null then
    raise exception 'merge_profiles: source % is already merged', p_source using errcode = '22023';
  end if;
  if v_source.user_id is not null then
    raise exception 'merge_profiles: source % is a claimed account', p_source using errcode = '22023';
  end if;

  /*
   * ---------------------------------------------------------------- capture, before anything moves
   *
   * Placed after the guards so a refused merge writes nothing, and before the first `update` so
   * every value is pre-merge. `to_jsonb(t)` rather than a column list on purpose: a column added
   * to any of these tables later is captured automatically, whereas a hand-written list would
   * silently start losing whatever was added and nobody would notice until they needed it.
   */
  select jsonb_strip_nulls(jsonb_build_object(
    'captured_at', now(),
    'profile', to_jsonb(v_source),
    'group_members', (select jsonb_agg(to_jsonb(t)) from public.group_members t
                       where t.profile_id = p_source),
    'expense_splits', (select jsonb_agg(to_jsonb(t)) from public.expense_splits t
                        where t.profile_id = p_source),
    'expense_payers', (select jsonb_agg(to_jsonb(t)) from public.expense_payers t
                        where t.profile_id = p_source),
    'expense_participants', (select jsonb_agg(to_jsonb(t)) from public.expense_participants t
                              where t.profile_id = p_source),
    'settlements', (select jsonb_agg(to_jsonb(t)) from public.settlements t
                     where t.from_profile_id = p_source or t.to_profile_id = p_source),
    'contact_points', (select jsonb_agg(to_jsonb(t)) from public.profile_contact_points t
                        where t.profile_id = p_source),
    'expense_comments', (select jsonb_agg(to_jsonb(t)) from public.expense_comments t
                          where t.author_profile_id = p_source)
  )) into v_undo;

  -- Group membership: drop a duplicate, keep the earliest joined_at on the survivor.
  update public.group_members t
     set joined_at = least(t.joined_at, s.joined_at)
    from public.group_members s
   where s.profile_id = p_source and t.profile_id = p_target and t.group_id = s.group_id;

  delete from public.group_members s
   where s.profile_id = p_source
     and exists (select 1 from public.group_members t
                  where t.group_id = s.group_id and t.profile_id = p_target);

  update public.group_members set profile_id = p_target where profile_id = p_source;

  -- Splits and payers: if both identities are on the same expense (someone split with their
  -- own placeholder), SUM into the surviving row rather than dropping one. The source's own
  -- amounts are in `v_undo` above, which is what makes this subtraction reversible.
  update public.expense_splits t
     set share_amount_minor = t.share_amount_minor + s.share_amount_minor
    from public.expense_splits s
   where s.profile_id = p_source and t.profile_id = p_target and t.expense_id = s.expense_id;

  delete from public.expense_splits s
   where s.profile_id = p_source
     and exists (select 1 from public.expense_splits t
                  where t.expense_id = s.expense_id and t.profile_id = p_target);

  update public.expense_splits set profile_id = p_target where profile_id = p_source;

  update public.expense_payers t
     set paid_amount_minor = t.paid_amount_minor + s.paid_amount_minor
    from public.expense_payers s
   where s.profile_id = p_source and t.profile_id = p_target and t.expense_id = s.expense_id;

  delete from public.expense_payers s
   where s.profile_id = p_source
     and exists (select 1 from public.expense_payers t
                  where t.expense_id = s.expense_id and t.profile_id = p_target);

  update public.expense_payers set profile_id = p_target where profile_id = p_source;

  update public.expense_participants t
     set is_payer = t.is_payer or s.is_payer, is_ower = t.is_ower or s.is_ower
    from public.expense_participants s
   where s.profile_id = p_source and t.profile_id = p_target and t.expense_id = s.expense_id;

  delete from public.expense_participants s
   where s.profile_id = p_source
     and exists (select 1 from public.expense_participants t
                  where t.expense_id = s.expense_id and t.profile_id = p_target);

  update public.expense_participants set profile_id = p_target where profile_id = p_source;

  -- Settlements that become self-to-self are VOIDED, not deleted: the history stays auditable.
  update public.settlements
     set status = 'voided_by_merge'
   where (from_profile_id = p_source and to_profile_id = p_target)
      or (to_profile_id = p_source and from_profile_id = p_target);

  update public.settlements set from_profile_id = p_target
   where from_profile_id = p_source and status <> 'voided_by_merge';
  update public.settlements set to_profile_id = p_target
   where to_profile_id = p_source and status <> 'voided_by_merge';

  -- Straight repoints.
  update public.expense_comments set author_profile_id = p_target where author_profile_id = p_source;
  update public.expense_attachments set uploaded_by_profile_id = p_target where uploaded_by_profile_id = p_source;
  update public.expenses set created_by_profile_id = p_target where created_by_profile_id = p_source;
  update public.profiles set created_by_profile_id = p_target where created_by_profile_id = p_source;

  -- Contact points move across; a collision retires the source copy.
  update public.profile_contact_points s
     set retired_at = now()
   where s.profile_id = p_source
     and exists (select 1 from public.profile_contact_points t
                  where t.profile_id = p_target and t.kind = s.kind
                    and t.value_norm = s.value_norm and t.retired_at is null);

  update public.profile_contact_points
     set profile_id = p_target
   where profile_id = p_source and retired_at is null;

  -- Debts are fully derived, so rebuild rather than repoint — that also collapses any edge
  -- that has just become self-to-self.
  perform app.rebuild_expense_debts(e.id)
  from public.expenses e
  where exists (select 1 from public.expense_participants ep
                 where ep.expense_id = e.id and ep.profile_id = p_target);

  -- Tombstone. The row stays; the identity does not — which is why the original name, avatar
  -- and UPI id had to be captured above.
  update public.profiles
     set merged_into_profile_id = p_target,
         merged_at = now(),
         display_name = 'Merged account',
         avatar_url = null,
         upi_vpa = null
   where id = p_source;

  -- Actual counts this time, derived from what was captured.
  -- `jsonb_each` yields columns named key/value; aliasing the set is what makes them
  -- referenceable. Only the array entries are tables — `profile` and `captured_at` are not.
  select jsonb_object_agg(e.key, jsonb_array_length(e.value))
    into v_counts
    from jsonb_each(v_undo) e
   where jsonb_typeof(e.value) = 'array';

  insert into internal.profile_merges
    (source_profile_id, target_profile_id, actor_profile_id, reason, row_counts, undo)
  values
    (p_source, p_target, auth_ext.current_profile_id(), p_reason,
     coalesce(v_counts, '{}'::jsonb), v_undo);

  -- ONE event per affected person. Emitting one per repointed row is the single most likely
  -- notification storm this schema could produce.
  select coalesce(array_agg(distinct ep.profile_id), array[]::uuid[]) into v_recipients
  from public.expense_participants ep
  where ep.profile_id <> p_target
    and exists (select 1 from public.expense_participants me
                 where me.expense_id = ep.expense_id and me.profile_id = p_target);

  perform internal.emit_change(v_recipients, null, null, 'profile', p_target, 'update',
                               jsonb_build_object('merged_from', p_source));

  return jsonb_build_object('target_profile_id', p_target, 'source_profile_id', p_source);
end;
$$;

revoke all on function app.merge_profiles(uuid, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
