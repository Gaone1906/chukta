-- Phase 7 additions to the client API surface.
--
-- Same reasoning as 0018: PostgREST only exposes `public`, so an RPC that lives in `app` is
-- unreachable from a phone until a thin wrapper exists here. This file IS the list of what
-- Phase 7 added to the callable surface.
--
-- SECURITY INVOKER, like every other wrapper — the SECURITY DEFINER body still reads the same
-- request.jwt.claims, so its own authorisation checks apply unchanged.

create or replace function public.create_invite_link(p_profile_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.create_invite_link(p_profile_id);
$$;

create or replace function public.delete_account()
returns jsonb language sql set search_path = '' as $$
  select app.delete_account();
$$;

-- `anon` gets nothing — and it takes BOTH revokes to mean that.
--
-- 0019's `alter default privileges` removes Supabase's explicit grant to anon on anything
-- created from then on, which covers these two. What it does not touch is the EXECUTE grant
-- Postgres itself puts on PUBLIC for every new function, and anon is a member of PUBLIC — so
-- with only the default-privileges rule in place, anon could still execute both of these.
--
-- The guardrail test in tests/guardrails.test.sql caught exactly that, which is the entire
-- reason it asserts on "what can anon reach" rather than on any particular function name.
revoke all on function
  public.create_invite_link(uuid),
  public.delete_account()
from public, anon;

grant execute on function
  public.create_invite_link(uuid),
  public.delete_account()
to authenticated;
