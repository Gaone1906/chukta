-- Claim a person with a short typeable code.
--
-- `create_invite_link` already mints a 192-bit token for a LINK. This is the same idea sized for
-- a human mouth: eight characters somebody can read down a phone or text to a friend, so two
-- people can reconcile their ledgers at any time rather than only at invite time.
--
-- ---------------------------------------------------------------- why this is its own table
--
-- `public.profile_claims` defaults `expires_at` to **90 days**, which is right for a 192-bit
-- secret in a URL and catastrophic for a 40-bit one somebody types. One table cannot carry one
-- sane default for both, and a column-level override is exactly the kind of thing that gets
-- dropped by the next person adding a claim path. Separate table, separate expiry, no default
-- worth misreading.
--
-- ---------------------------------------------------------------- the entropy argument
--
-- 32 characters, 8 of them: 32^8 = 2^40.
--
-- The number that matters is NOT "how long to guess one code" — it is how long to guess ANY
-- live code, because a guesser does not care whose ledger they get. Expected guesses to a hit
-- is S/N for N live codes. So N is the security parameter, and the **15-minute expiry is the
-- control doing the real work**: it collapses N to whatever was generated in the last quarter
-- hour, which for this app is single digits.
--
-- The rejected alternative was 6 characters (2^30). Even throttled that is close enough to
-- reachable to be uncomfortable — and it buys exactly one less typed pair. 8 characters is
-- 1024x the work for `XXXX-XXXX` instead of `XXX-XXX`.
--
-- ---------------------------------------------------------------- and why HMAC, not digest()
--
-- `profile_claims` stores an unsalted SHA-256, which is fine at 192 bits: nobody inverts that.
-- At 40 bits it is decorative — the whole keyspace hashes on a consumer GPU in minutes, so a
-- read of the code table would hand over every live code.
--
-- The pepper lives in a different table so that reading `internal.claim_codes` alone is not
-- enough to brute-force it. **Be honest about what that does and does not buy:** it defends
-- against a partial read (one table exfiltrated, a backup of one relation, an injection scoped
-- to one query), and it does nothing against a full-database dump, where the attacker gets both.
-- The 15-minute expiry is what makes even that mostly worthless. Defence in depth, not a moat.

-- ---------------------------------------------------------------- storage

create table if not exists internal.claim_secrets (
  -- Single row, enforced by the primary key. `check (id)` makes `false` unrepresentable too, so
  -- there is exactly one legal value rather than two.
  id         boolean primary key default true check (id),
  pepper     bytea not null,
  created_at timestamptz not null default now()
);

insert into internal.claim_secrets (id, pepper)
values (true, extensions.gen_random_bytes(32))
on conflict (id) do nothing;

create table if not exists internal.claim_codes (
  id                     bigserial primary key,
  placeholder_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- HMAC-SHA256 of the normalised code. Unique GLOBALLY and across expired rows, so a code can
  -- never be reissued even by chance — the mint loop below retries on the collision.
  code_hmac              bytea not null unique,
  created_by_profile_id  uuid not null references public.profiles(id),
  expires_at             timestamptz not null,
  redeemed_at            timestamptz,
  redeemed_by_profile_id uuid references public.profiles(id),
  created_at             timestamptz not null default now()
);

create index if not exists claim_codes_placeholder_idx
  on internal.claim_codes (placeholder_profile_id);
create index if not exists claim_codes_expires_idx on internal.claim_codes (expires_at);

/*
 * Every redemption attempt, successful or not.
 *
 * This table is the throttle. It is in `internal` rather than `public` because PostgREST only
 * exposes `public` — there is no grant that would let a client read its own attempt history and
 * work out how close to a lockout it is.
 */
create table if not exists internal.claim_attempts (
  id               bigserial primary key,
  actor_profile_id uuid,
  actor_ip         inet,
  succeeded        boolean not null,
  created_at       timestamptz not null default now()
);

create index if not exists claim_attempts_actor_idx
  on internal.claim_attempts (actor_profile_id, created_at desc);
create index if not exists claim_attempts_ip_idx
  on internal.claim_attempts (actor_ip, created_at desc);
create index if not exists claim_attempts_created_idx
  on internal.claim_attempts (created_at desc);

-- ---------------------------------------------------------------- the alphabet

/*
 * Crockford-flavoured: digits plus uppercase letters, minus I, L, O and U.
 *
 * I/1, L/1 and O/0 are the confusions that actually happen when a code is read aloud or copied
 * off a screen; U is dropped because its absence is what stops a random draw spelling something
 * unfortunate at the user.
 *
 * **Exactly 32 characters, and that is load-bearing.** 256 is a whole multiple of 32, so
 * `byte % 32` is perfectly uniform. At 31 or 33 the modulo would quietly bias the low letters
 * and cost real entropy — the classic way a "random" token ends up weaker than its length says.
 */
create or replace function internal.claim_alphabet()
returns text language sql immutable set search_path = '' as $$
  select '0123456789ABCDEFGHJKMNPQRSTVWXYZ'::text;
$$;

/*
 * Normalise what the user typed.
 *
 * People will type the hyphen we display, lowercase, and stray spaces. All three have to reach
 * the same bytes the HMAC was taken over, or a correct code fails and the failure counts
 * against their lockout.
 *
 * The confusable characters are folded rather than rejected: someone reading `0` as `O` should
 * succeed, not burn an attempt. That does not weaken anything — those letters are not in the
 * alphabet, so folding them collides with nothing.
 */
create or replace function internal.normalise_claim_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')),
                   'OILU', '0111');
$$;

-- `convert_to(..., 'UTF8')` because pgcrypto's hmac overloads are (text,text,text) and
-- (bytea,bytea,text) — there is no mixed form, and the pepper is bytea. Encoding the code
-- explicitly also pins the byte representation, so the stored HMAC cannot shift with a server
-- encoding change.
create or replace function internal.claim_code_hmac(p_code text)
returns bytea language sql stable security definer set search_path = '' as $$
  select extensions.hmac(convert_to(internal.normalise_claim_code(p_code), 'UTF8'),
                         (select pepper from internal.claim_secrets where id),
                         'sha256');
$$;

-- ---------------------------------------------------------------- who is asking

/*
 * The caller's IP, if PostgREST passed one through. Best-effort by design.
 *
 * `x-forwarded-for` is a comma-separated chain and the client-supplied end of it is forgeable,
 * so this tier can be evaded by anyone who bothers. It is kept because it costs nothing and
 * raises the floor on casual abuse — and because the tier that actually holds regardless is the
 * global breaker below, which no amount of header spoofing touches.
 */
create or replace function internal.request_ip()
returns inet language plpgsql stable set search_path = '' as $$
declare
  v_raw text;
begin
  v_raw := split_part(
    coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-forwarded-for',
    ',', 1);
  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;
  return btrim(v_raw)::inet;
exception when others then
  -- A malformed or absent header must never fail a redemption.
  return null;
end;
$$;

-- ---------------------------------------------------------------- minting

/*
 * Mint a claim code for a placeholder you may invite.
 *
 * The guards are `create_invite_link`'s, deliberately — this is a second door onto the same
 * merge, and a second door with weaker locks is not a feature.
 *
 * **Superseding is NOT scoped to the caller**, which is the one place this deliberately differs
 * from `create_invite_link` (`0020:62-67` scopes its supersede to `created_by_profile_id =
 * v_me`). Two people can both have added the same person; if each mints a code and only your
 * own is retired when you regenerate, the other one stays live and "regenerate" has not done
 * what its name says. For a 40-bit secret, every stale live code is a permanent addition to N.
 *
 * There is deliberately NO rate limit on minting. It looks like an omission and is not: you can
 * only mint for a placeholder you already share context with, and codes you mint are codes for
 * YOUR OWN people — flooding the table does not improve anyone's odds of guessing somebody
 * else's. The redemption side is where guessing happens, and that is throttled three ways.
 */
create or replace function app.create_claim_code(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth_ext.assert_signed_in();
  v_target   public.profiles%rowtype;
  v_alphabet text := internal.claim_alphabet();
  v_code     text;
  v_expires  timestamptz;
  v_attempt  int := 0;
begin
  select * into v_target from public.profiles where id = p_profile_id;

  if not found or v_target.deleted_at is not null or v_target.merged_into_profile_id is not null then
    raise exception 'no such person' using errcode = 'P0002';
  end if;

  if v_target.user_id is not null then
    raise exception 'that person already has an account' using errcode = 'P0001';
  end if;

  if v_target.created_by_profile_id is distinct from v_me
     and not auth_ext.shares_context_with(p_profile_id) then
    raise exception 'you cannot invite that person' using errcode = '42501';
  end if;

  update internal.claim_codes
     set expires_at = now()
   where placeholder_profile_id = p_profile_id
     and redeemed_at is null
     and expires_at > now();

  v_expires := now() + interval '15 minutes';

  -- Retry on the unique index. The index spans expired rows too, so the space genuinely shrinks
  -- over time and a collision, while vanishingly unlikely, is not impossible.
  loop
    v_attempt := v_attempt + 1;

    select string_agg(substr(v_alphabet, (get_byte(b.bytes, i) % 32) + 1, 1), '')
      into v_code
    from (select extensions.gen_random_bytes(8) as bytes) b,
         generate_series(0, 7) as i;

    begin
      insert into internal.claim_codes
        (placeholder_profile_id, code_hmac, created_by_profile_id, expires_at)
      values
        (p_profile_id, internal.claim_code_hmac(v_code), v_me, v_expires);
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'could not mint a code, try again' using errcode = 'P0003';
      end if;
    end;
  end loop;

  -- The code is returned exactly once, here. Only its HMAC was stored, so there is no second
  -- chance to read it — same contract as the invite token.
  return jsonb_build_object(
    'code', v_code,
    'formatted', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4),
    'profile_id', p_profile_id,
    'display_name', v_target.display_name,
    'expires_at', v_expires
  );
end;
$$;

-- ---------------------------------------------------------------- redeeming

/*
 * Redeem a code, folding that placeholder into the caller's account.
 *
 * ================================================================ IT RETURNS, IT DOES NOT RAISE
 *
 * This is the single subtlest thing in the file, and getting it wrong produces a throttle that
 * passes its own tests while doing nothing.
 *
 * PostgREST runs each RPC in ONE transaction. So a function that inserts an attempt row and then
 * raises has its insert **rolled back with the exception** — the counter never moves, the
 * lockout never triggers, and a test that asserts "the sixth attempt is rejected" still passes
 * because it is asserting on the raise, not on the counter. The attempt row has to survive, so
 * every failure path returns a value and lets the transaction commit.
 *
 * ================================================================ what the reasons may reveal
 *
 * `wrong`, `expired` and `already used` collapse into ONE reason, `invalid`. Distinguishing them
 * is an oracle: "expired" confirms that code existed, which for a 40-bit secret is a third of
 * the way to a hit and tells an attacker to concentrate near valid-looking guesses.
 *
 * **`throttled` is deliberately NOT folded in, and this is a considered departure from the
 * plan**, which said a locked-out caller should be indistinguishable from a wrong code.
 * Re-derived: lockout state is a fact about the CALLER'S OWN attempt history, which they already
 * know — it discloses nothing about any code or any user. Hiding it buys no security and costs a
 * real person, who typo'd twice, a screen that says "invalid" forever with no hint to wait.
 * Uniformity is required exactly where the distinction is a fact about somebody else.
 */
create or replace function app.redeem_claim_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me          uuid := auth_ext.assert_signed_in();
  v_ip          inet := internal.request_ip();
  v_row         internal.claim_codes%rowtype;
  v_placeholder public.profiles%rowtype;
  v_norm        text := internal.normalise_claim_code(p_code);
begin
  -- ---------------------------------------------------------------- three tiers
  --
  -- Per-actor stops one signed-in account grinding. Per-IP stops one machine cycling accounts.
  -- The global breaker is the only one that bounds TOTAL guesses regardless of how many accounts
  -- or addresses the attacker controls, which is why it is here even though it can, in the
  -- limit, be used to deny service to everyone. That trade is deliberate: at 500 failures in
  -- five minutes something is badly wrong, and a short pause for legitimate users is a much
  -- smaller harm than an irreversible merge.
  if (select count(*) from internal.claim_attempts
       where actor_profile_id = v_me and not succeeded
         and created_at > now() - interval '1 hour') >= 5
     or (v_ip is not null and (select count(*) from internal.claim_attempts
       where actor_ip = v_ip and not succeeded
         and created_at > now() - interval '1 hour') >= 20)
     or (select count(*) from internal.claim_attempts
       where not succeeded and created_at > now() - interval '5 minutes') >= 500
  then
    return jsonb_build_object('ok', false, 'reason', 'throttled');
  end if;

  if length(v_norm) <> 8 then
    -- Not even the right shape. Still counted: length-probing is probing.
    insert into internal.claim_attempts (actor_profile_id, actor_ip, succeeded)
    values (v_me, v_ip, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_row
  from internal.claim_codes
  where code_hmac = internal.claim_code_hmac(v_norm)
  for update;

  -- One branch for wrong / expired / already redeemed. See the note above.
  if not found or v_row.redeemed_at is not null or v_row.expires_at <= now() then
    insert into internal.claim_attempts (actor_profile_id, actor_ip, succeeded)
    values (v_me, v_ip, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_placeholder from public.profiles where id = v_row.placeholder_profile_id;

  -- Redeeming your own code is a no-op, not an error, and must not burn the code: people will
  -- test their own code before sending it.
  if v_placeholder.id = v_me then
    return jsonb_build_object('ok', true, 'merged', false, 'profile_id', v_me);
  end if;

  -- Somebody got there first, or the person signed up in the meantime. `merge_profiles` would
  -- refuse a source with a `user_id` anyway; catching it here keeps the answer uniform.
  if v_placeholder.user_id is not null
     or v_placeholder.merged_into_profile_id is not null
     or v_placeholder.deleted_at is not null then
    update internal.claim_codes set redeemed_at = now() where id = v_row.id;
    insert into internal.claim_attempts (actor_profile_id, actor_ip, succeeded)
    values (v_me, v_ip, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  update internal.claim_codes
     set redeemed_at = now(), redeemed_by_profile_id = v_me
   where id = v_row.id;

  perform app.merge_profiles(v_placeholder.id, v_me, 'token_claim');

  insert into internal.claim_attempts (actor_profile_id, actor_ip, succeeded)
  values (v_me, v_ip, true);

  return jsonb_build_object(
    'ok', true,
    'merged', true,
    'profile_id', v_me,
    'display_name', v_placeholder.display_name
  );
end;
$$;

-- ---------------------------------------------------------------- housekeeping

/*
 * Drop rows nobody can use any more.
 *
 * Expired codes are kept for a day rather than deleted on expiry, so the unique index keeps
 * refusing to reissue a code that was live minutes ago. Attempts are kept a week — long enough
 * to see an attack in the table, short enough not to become a log nobody rotates.
 *
 * NOT SCHEDULED YET. `pg_cron` is stood up in Phase 9 for the FX poll and the push drain; this
 * gets a line in that same schedule. Until then the tables are small enough that nothing breaks
 * — leaving it unscheduled is a size problem later, never a correctness one, because every read
 * path already filters on `expires_at`/`redeemed_at` rather than trusting the table to be clean.
 */
create or replace function internal.purge_claim_codes()
returns void language sql security definer set search_path = '' as $$
  with a as (delete from internal.claim_codes where expires_at < now() - interval '1 day')
  delete from internal.claim_attempts where created_at < now() - interval '7 days';
$$;

-- ---------------------------------------------------------------- public API

create or replace function public.create_claim_code(p_profile_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.create_claim_code(p_profile_id);
$$;

create or replace function public.redeem_claim_code(p_code text)
returns jsonb language sql set search_path = '' as $$
  select app.redeem_claim_code(p_code);
$$;

/*
 * `revoke ... from public, anon`, not from anon alone.
 *
 * Postgres grants EXECUTE to PUBLIC on every newly created function, and `anon` is a member of
 * PUBLIC — so revoking from anon by name leaves the inherited grant and the function stays
 * reachable with no session at all. supabase/tests/guardrails.test.sql asserts this by asking
 * what anon can actually reach.
 */
revoke all on function
  app.create_claim_code(uuid),
  app.redeem_claim_code(text),
  public.create_claim_code(uuid),
  public.redeem_claim_code(text),
  internal.claim_code_hmac(text),
  internal.purge_claim_codes()
from public, anon;

grant execute on function
  app.create_claim_code(uuid),
  app.redeem_claim_code(text),
  public.create_claim_code(uuid),
  public.redeem_claim_code(text)
to authenticated;

notify pgrst, 'reload schema';
