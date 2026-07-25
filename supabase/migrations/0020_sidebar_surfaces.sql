-- Phase 7 — the backend the sidebar surfaces need.
--
-- Deliberately small. Phase 3 already built `profile_claims`, `notification_prefs` and
-- `feedback`, and 0010 already granted the self-scoped writes with column-level grants and
-- RLS — so Settings' profile edits, the notification toggles and the feedback box all work as
-- ordinary table writes with no RPC layer at all. What is left is the three things that carry
-- cross-user consequences, plus one new table.

-- ---------------------------------------------------------------- invite links

/*
 * Mint an invite link for someone you added but who has not signed up.
 *
 * Only the SHA-256 of the token is stored, so a database read cannot recover a live invite —
 * the same reason password hashes exist. The token is returned exactly once, here, and the
 * caller has to put it in the link immediately or lose it.
 *
 * Minting supersedes any earlier unclaimed link this inviter made for the same person. Without
 * that, "share again" quietly accumulates valid tokens for the same profile forever, and every
 * one of them stays a way in for 90 days.
 *
 * There is no equivalent for inviting a stranger, and that is not an omission: a link with no
 * placeholder behind it has nothing to claim, so a plain store link does the same job. The
 * client sends that one without asking the server for anything.
 */
create or replace function app.create_invite_link(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth_ext.assert_signed_in();
  v_target  public.profiles%rowtype;
  v_token   text;
begin
  select * into v_target from public.profiles where id = p_profile_id;

  if not found then
    raise exception 'no such person' using errcode = 'P0002';
  end if;

  -- Already has an account: there is nothing to claim, and minting a token that could fold
  -- their profile into someone else's would be an account-takeover vector rather than an
  -- invite. Callers show "they are already on Hisaab" instead.
  if v_target.user_id is not null then
    raise exception 'that person already has an account' using errcode = 'P0001';
  end if;

  if v_target.deleted_at is not null or v_target.merged_into_profile_id is not null then
    raise exception 'no such person' using errcode = 'P0002';
  end if;

  -- You may invite someone you created, or someone you already share an expense or group
  -- with. Anything wider would let a token be minted for a placeholder the caller has no
  -- business knowing exists.
  if v_target.created_by_profile_id is distinct from v_me
     and not auth_ext.shares_context_with(p_profile_id) then
    raise exception 'you cannot invite that person' using errcode = '42501';
  end if;

  update public.profile_claims
     set expires_at = now()
   where placeholder_profile_id = p_profile_id
     and created_by_profile_id = v_me
     and claimed_at is null
     and expires_at > now();

  -- URL-safe base64: these end up in a link, where + and / need escaping and = is noise.
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

  insert into public.profile_claims (placeholder_profile_id, token_sha256, created_by_profile_id)
  values (p_profile_id, extensions.digest(v_token, 'sha256'), v_me);

  return jsonb_build_object(
    'token', v_token,
    'profile_id', p_profile_id,
    'display_name', v_target.display_name,
    'expires_at', now() + interval '90 days'
  );
end;
$$;

-- ---------------------------------------------------------------- account deletion

/*
 * Delete the caller's account — by anonymising the profile, not by removing it.
 *
 * A hard delete is impossible here and it is worth being precise about why: every expense the
 * user was part of has splits and pairwise debt rows pointing at their `profiles.id`, and
 * those rows are half of somebody else's balance. Removing the profile would either cascade
 * away other people's money or leave dangling references. Neither is a deletion the other
 * person consented to.
 *
 * So: everything personal goes, the identity keeps existing as "Deleted user", and the
 * `auth.users` row — the actual login — is removed, which is what account deletion means to
 * the person asking and to Apple's review guideline requiring it in-app.
 */
create or replace function app.delete_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth_ext.assert_signed_in();
  v_user_id uuid := (select auth.uid());
begin
  update public.profiles
     set display_name = 'Deleted user',
         avatar_url   = null,
         upi_vpa      = null,
         deleted_at   = now()
   where id = v_me;

  -- Retired rather than deleted: the unique index on live contact points is what makes two
  -- friends inviting the same person converge, and a deleted account must not keep holding
  -- that email hostage if the person ever comes back.
  update public.profile_contact_points
     set retired_at = now()
   where profile_id = v_me and retired_at is null;

  update public.profile_claims
     set expires_at = now()
   where (placeholder_profile_id = v_me or created_by_profile_id = v_me)
     and claimed_at is null
     and expires_at > now();

  delete from public.device_tokens where profile_id = v_me;
  delete from public.notification_prefs where profile_id = v_me;

  -- Receipts are the one thing they uploaded that is theirs alone. The storage objects
  -- themselves are removed by the client before it calls this, since Storage is not reachable
  -- from plpgsql.
  delete from public.expense_attachments where uploaded_by_profile_id = v_me;

  -- Last, because profiles.user_id is ON DELETE SET NULL: this severs the login and leaves the
  -- profile behind as the tombstone every counterparty balance still points at.
  if v_user_id is not null then
    delete from auth.users where id = v_user_id;
  end if;

  return jsonb_build_object('profile_id', v_me, 'deleted', true);
end;
$$;

-- ---------------------------------------------------------------- tip jar

/*
 * Tips, recorded only after the store receipt has been verified server-side.
 *
 * There is no client write path and there must never be one: a client that can insert here can
 * claim to have paid. The `iap-verify` Edge Function holds the service key, checks the receipt
 * against Apple's and Google's APIs, and writes the row. The client only ever reads its own.
 */
create table public.tip_jar_purchases (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles(id) on delete set null,
  store             text not null check (store in ('app_store','play_store')),
  product_id        text not null,
  -- Apple's original_transaction_id / Google's purchaseToken. Unique so a replayed receipt
  -- cannot be counted twice.
  store_txn_id      text not null,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          char(3) not null default 'INR' check (currency = 'INR'),
  purchased_at      timestamptz not null default now(),
  verified_at       timestamptz not null default now(),
  raw_receipt       jsonb,
  created_at        timestamptz not null default now(),
  unique (store, store_txn_id)
);

create index tip_jar_purchases_profile_idx on public.tip_jar_purchases (profile_id, purchased_at desc);

alter table public.tip_jar_purchases enable row level security;

create policy tip_jar_read_own on public.tip_jar_purchases
  for select to authenticated
  using (profile_id = (select auth_ext.current_profile_id()));

-- SELECT only. The Edge Function writes as the service role, which bypasses RLS entirely.
grant select on public.tip_jar_purchases to authenticated;

-- ---------------------------------------------------------------- grants

revoke all on function
  app.create_invite_link(uuid),
  app.delete_account()
from public;

grant execute on function
  app.create_invite_link(uuid),
  app.delete_account()
to authenticated;
