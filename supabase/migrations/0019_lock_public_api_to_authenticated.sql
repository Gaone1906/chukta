-- Close the anon hole in the public API surface.
--
-- 0018 did `revoke all ... from public`, which removes the PUBLIC pseudo-role grant that
-- Postgres puts on every new function. It does NOT remove Supabase's own default privileges,
-- which grant EXECUTE on functions in `public` to `anon` and `authenticated` explicitly.
--
-- The symptom, from an unauthenticated curl:
--
--   {"code":"42501","message":"permission denied for schema app"}
--
-- That error comes from INSIDE the wrapper — so anon was executing it and only failing at the
-- schema boundary. No data was reachable (every RPC asserts a signed-in profile, and anon has
-- no USAGE on `app`), but "it fails a step later than intended" is not the same as "it is
-- refused", and the whole point of the wrapper list is that it is the exact client API.

revoke all on function
  public.get_home_summary(),
  public.get_group_detail(uuid, integer, date),
  public.get_person_detail(uuid, integer),
  public.get_expense_detail(uuid),
  public.simplify_group_debts(uuid),
  public.sync_pull(bigint, integer),
  public.create_expense(jsonb, uuid),
  public.update_expense(uuid, jsonb, integer, uuid),
  public.delete_expense(uuid, integer, uuid),
  public.restore_expense(uuid, uuid),
  public.add_comment(uuid, text, uuid),
  public.record_settlement(jsonb, uuid),
  public.create_group(jsonb, uuid),
  public.add_group_members(uuid, uuid[], uuid),
  public.upsert_contact_profile(text, public.contact_kind, text),
  public.claim_placeholder(text)
from anon;

-- And stop the same thing happening to whatever lands in `public` next. Supabase's default
-- privileges are set on the `postgres` role; this narrows them for anything created from here
-- on, so a future migration cannot accidentally hand anon a new entry point.
alter default privileges in schema public revoke execute on functions from anon;

notify pgrst, 'reload schema';
