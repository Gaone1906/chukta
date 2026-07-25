-- Claiming a placeholder at signup, and merging two profiles that turn out to be one person.
--
-- This is the payoff for making profiles.id the universal identity. A friend adds "Priya" to a
-- dinner before Priya has ever opened the app; Priya signs up months later; her entire history
-- is simply there, because every expense, split and debt already points at her profile_id.

/*
 * Path A — claim in place. The common case, and it moves no data at all.
 *
 * Runs from the auth.users insert trigger. Matches the new user's VERIFIED contact points
 * against unclaimed placeholders; if one matches, that profile becomes theirs.
 */
create or replace function internal.claim_or_create_profile(
  p_user_id  uuid,
  p_email    text,
  p_phone    text,
  p_name     text,
  p_provider text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := nullif(lower(btrim(p_email)), '');
  v_phone   text := nullif(btrim(p_phone), '');
  v_profile uuid;
begin
  -- Already claimed? (Re-running the trigger must be harmless.)
  select id into v_profile from public.profiles where user_id = p_user_id;
  if v_profile is not null then
    return v_profile;
  end if;

  -- An unclaimed placeholder whose contact point matches this verified identity.
  select cp.profile_id into v_profile
  from public.profile_contact_points cp
  join public.profiles p on p.id = cp.profile_id
  where cp.retired_at is null
    and p.user_id is null
    and p.merged_into_profile_id is null
    and p.deleted_at is null
    and (
      (v_email is not null and cp.kind = 'email' and cp.value_norm = v_email)
      or (v_phone is not null and cp.kind = 'phone' and cp.value_norm = v_phone)
    )
  order by p.created_at
  limit 1;

  if v_profile is not null then
    update public.profiles
       set user_id = p_user_id,
           claimed_at = now(),
           primary_auth_provider = coalesce(p_provider, primary_auth_provider),
           -- Keep the name their friend used unless they never had one.
           display_name = coalesce(nullif(btrim(display_name), ''), p_name, 'Someone')
     where id = v_profile;

    update public.profile_contact_points
       set verified_at = now()
     where profile_id = v_profile
       and retired_at is null
       and ((v_email is not null and kind = 'email' and value_norm = v_email)
         or (v_phone is not null and kind = 'phone' and value_norm = v_phone));

    return v_profile;
  end if;

  -- No placeholder: a brand new person.
  insert into public.profiles (user_id, display_name, claimed_at, primary_auth_provider)
  values (p_user_id, coalesce(nullif(btrim(p_name), ''), 'Someone'), now(), p_provider)
  returning id into v_profile;

  if v_email is not null then
    insert into public.profile_contact_points (profile_id, kind, value_norm, verified_at, source)
    values (v_profile, 'email', v_email, now(), 'oauth')
    on conflict do nothing;
  end if;

  if v_phone is not null then
    insert into public.profile_contact_points (profile_id, kind, value_norm, verified_at, source)
    values (v_profile, 'phone', v_phone, now(), 'oauth')
    on conflict do nothing;
  end if;

  return v_profile;
end;
$$;

create or replace function internal.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform internal.claim_or_create_profile(
    new.id,
    new.email,
    new.phone,
    -- Apple hands the real name over on the FIRST authorisation only, and it arrives in
    -- raw_user_meta_data. If it is not captured here it is gone for good.
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(coalesce(new.email,''), '@', 1)),
    new.raw_app_meta_data->>'provider'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function internal.handle_new_auth_user();

/*
 * Path B — token claim. The invite link carries a token; the client calls this after signup.
 *
 * Works even when the invitee signs up with a different address than the one they were
 * invited by, which Apple's Hide My Email makes routine.
 */
create or replace function app.claim_placeholder(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me          uuid := auth_ext.assert_signed_in();
  v_claim       public.profile_claims%rowtype;
  v_placeholder public.profiles%rowtype;
begin
  select * into v_claim
  from public.profile_claims
  where token_sha256 = extensions.digest(p_token, 'sha256')
    and claimed_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite link is invalid or has expired' using errcode = 'P0002';
  end if;

  select * into v_placeholder from public.profiles where id = v_claim.placeholder_profile_id;

  if v_placeholder.id = v_me then
    return jsonb_build_object('profile_id', v_me, 'merged', false);
  end if;

  update public.profile_claims
     set claimed_at = now(), claimed_by_user_id = (select auth.uid())
   where id = v_claim.id;

  -- Still a placeholder: fold it into the caller's profile.
  if v_placeholder.user_id is null then
    perform app.merge_profiles(v_placeholder.id, v_me, 'token_claim');
    return jsonb_build_object('profile_id', v_me, 'merged', true);
  end if;

  -- It already belongs to a real account — nothing to claim.
  return jsonb_build_object('profile_id', v_me, 'merged', false);
end;
$$;

/*
 * Path C — merge two profiles that are one person.
 *
 * Happens when two friends invited the same person separately, or when someone signs in with
 * Apple and later with Google. Every reference is repointed with collision handling, and the
 * source row survives as a tombstone so stale offline clients can still resolve the old id.
 */
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
  -- own placeholder), SUM into the surviving row rather than dropping one.
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

  -- Tombstone. The row stays; the identity does not.
  update public.profiles
     set merged_into_profile_id = p_target,
         merged_at = now(),
         display_name = 'Merged account',
         avatar_url = null,
         upi_vpa = null
   where id = p_source;

  v_counts := jsonb_build_object('source', p_source, 'target', p_target);
  insert into internal.profile_merges (source_profile_id, target_profile_id, actor_profile_id, reason, row_counts)
  values (p_source, p_target, auth_ext.current_profile_id(), p_reason, v_counts);

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

-- merge_profiles is called by other app functions, never directly by a client.
revoke all on function
  app.merge_profiles(uuid, uuid, text),
  app.claim_placeholder(text)
from public;

grant execute on function app.claim_placeholder(text) to authenticated;
