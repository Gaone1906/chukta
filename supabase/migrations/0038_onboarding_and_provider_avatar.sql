-- Make onboarding reachable, and keep the picture the provider already gave us.
--
-- ---------------------------------------------------------------- the screen nobody could see
--
-- `needsProfileSetup` in the client was `display_name = 'Someone'`, on the belief that the
-- signup trigger writes that placeholder when a provider sends no name. It does — but only when
-- there is no name AND no email, because `handle_new_auth_user` falls back to
-- `split_part(email, '@', 1)` before ever reaching it. Every OAuth and email signup therefore
-- lands with a real-looking name, and the profile screen has been unreachable for essentially
-- everyone. Found by signing in against an empty database and watching it go straight to Home.
--
-- Two things were lost with it, and the second is the one that matters:
--
--   * The completion seal on `/done` is only reached through that screen, so no user has ever
--     seen the stamp animation the whole brand is built around.
--   * **The screen is where `upi_vpa` is captured.** Skipping it means every account has a null
--     VPA, so when somebody owes THEM there is no id for the QR or the request. The receive half
--     of settle-up has been broken by default for every account ever created. It is settable in
--     Settings, but nothing has ever pointed anyone there.
--
-- `onboarded_at` replaces the guess. A name that happens to look real is not evidence that a
-- person has been asked anything; a timestamp written when they finish the screen is.
--
-- Nullable rather than defaulted, deliberately: existing rows get NULL and are shown the screen
-- once, which is the correct treatment for accounts that were never asked.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

comment on column public.profiles.onboarded_at is
  'When this person finished the profile screen. NULL means they have never been asked — see '
  '0038. Do not infer this from display_name; a provider-supplied name is not consent.';

-- The client writes this itself on save, so it needs the same narrow grant the other editable
-- columns have. `profiles_update_self` already scopes any update to your own row.
grant update (onboarded_at) on public.profiles to authenticated;

/*
 * ---------------------------------------------------------------- the provider's picture
 *
 * The trigger already takes the provider's NAME and drops its picture on the floor, so every
 * Google account starts with a blank avatar even though `raw_user_meta_data` arrived carrying
 * one. Asking someone to upload a photo that the identity provider just handed us is work we
 * created for them.
 *
 * Done in the trigger rather than by widening `internal.claim_or_create_profile`, on purpose.
 * Adding a parameter to a `create or replace function` does not replace it — it ADDS an
 * overload, and the existing five-argument call would keep resolving to the old body while
 * looking like it had been updated. That mistake already cost a debugging session once
 * (`0035`). Nothing about that function's signature changes here.
 *
 * `where avatar_url is null` matters: claiming a placeholder can bring an avatar with it, and a
 * fresh Google picture must not overwrite one that is already there.
 *
 * Google sends `picture`; Supabase normalises some providers to `avatar_url`. Both are checked,
 * and `nullif(..., '')` because an empty string is not a URL.
 */
create or replace function internal.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  v_profile := internal.claim_or_create_profile(
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

  update public.profiles
     set avatar_url = coalesce(
           nullif(new.raw_user_meta_data->>'avatar_url', ''),
           nullif(new.raw_user_meta_data->>'picture', '')
         )
   where id = v_profile
     and avatar_url is null;

  return new;
end;
$$;

notify pgrst, 'reload schema';
