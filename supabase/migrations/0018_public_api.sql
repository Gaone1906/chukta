-- The client-callable API surface.
--
-- Every RPC lives in `app`, which PostgREST does not expose — so until now nothing the client
-- called could actually be resolved. The first read from the running app failed with
-- "Could not find the function public.get_home_summary in the schema cache", which is exactly
-- what that looks like from the outside.
--
-- The obvious fix is to add `app` to PostgREST's exposed schemas. Rejected: that would also
-- expose `app`'s views — v_pair_ledger and friends — for direct selection, and those are
-- plain views over the money tables rather than a considered read API.
--
-- Instead, one thin `public` wrapper per RPC the client is allowed to call. The list below IS
-- the client API: anything not here cannot be reached from a phone, whatever else exists in
-- `app`. Wrappers are SECURITY INVOKER on purpose — the SECURITY DEFINER body they call still
-- reads the same request.jwt.claims, so every authorisation check inside still applies.
--
-- Deliberately NOT wrapped: allocate_minor, floor_div and next_recurrence are internal maths,
-- and rebuild_expense_debts / expense_snapshot are write-path internals.

-- ---------------------------------------------------------------- reads

create or replace function public.get_home_summary()
returns jsonb language sql stable set search_path = '' as $$
  select app.get_home_summary();
$$;

create or replace function public.get_group_detail(
  p_group_id uuid, p_limit integer default 50, p_before date default null
)
returns jsonb language sql stable set search_path = '' as $$
  select app.get_group_detail(p_group_id, p_limit, p_before);
$$;

create or replace function public.get_person_detail(p_profile_id uuid, p_limit integer default 50)
returns jsonb language sql stable set search_path = '' as $$
  select app.get_person_detail(p_profile_id, p_limit);
$$;

create or replace function public.get_expense_detail(p_expense_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select app.get_expense_detail(p_expense_id);
$$;

create or replace function public.simplify_group_debts(p_group_id uuid)
returns table (from_profile_id uuid, to_profile_id uuid, amount_minor bigint)
language sql stable set search_path = '' as $$
  select * from app.simplify_group_debts(p_group_id);
$$;

create or replace function public.sync_pull(
  p_since_event_id bigint default 0, p_limit integer default 500
)
returns jsonb language sql stable set search_path = '' as $$
  select app.sync_pull(p_since_event_id, p_limit);
$$;

-- ---------------------------------------------------------------- writes

create or replace function public.create_expense(p_payload jsonb, p_client_mutation_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.create_expense(p_payload, p_client_mutation_id);
$$;

create or replace function public.update_expense(
  p_expense_id uuid, p_payload jsonb, p_expected_revision integer, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.update_expense(p_expense_id, p_payload, p_expected_revision, p_client_mutation_id);
$$;

create or replace function public.delete_expense(
  p_expense_id uuid, p_expected_revision integer, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.delete_expense(p_expense_id, p_expected_revision, p_client_mutation_id);
$$;

create or replace function public.restore_expense(p_expense_id uuid, p_client_mutation_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.restore_expense(p_expense_id, p_client_mutation_id);
$$;

create or replace function public.add_comment(
  p_expense_id uuid, p_body text, p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.add_comment(p_expense_id, p_body, p_client_mutation_id);
$$;

create or replace function public.record_settlement(p_payload jsonb, p_client_mutation_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.record_settlement(p_payload, p_client_mutation_id);
$$;

create or replace function public.create_group(p_payload jsonb, p_client_mutation_id uuid)
returns jsonb language sql set search_path = '' as $$
  select app.create_group(p_payload, p_client_mutation_id);
$$;

create or replace function public.add_group_members(
  p_group_id uuid, p_profile_ids uuid[], p_client_mutation_id uuid
)
returns jsonb language sql set search_path = '' as $$
  select app.add_group_members(p_group_id, p_profile_ids, p_client_mutation_id);
$$;

create or replace function public.upsert_contact_profile(
  p_display_name text,
  p_kind public.contact_kind default null,
  p_value_norm text default null
)
returns uuid language sql set search_path = '' as $$
  select app.upsert_contact_profile(p_display_name, p_kind, p_value_norm);
$$;

create or replace function public.claim_placeholder(p_token text)
returns jsonb language sql set search_path = '' as $$
  select app.claim_placeholder(p_token);
$$;

-- ---------------------------------------------------------------- grants
-- Same rule as the tables: nothing is callable by default, `authenticated` gets exactly the
-- list above and nothing else.

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
from public;

grant execute on function
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
to authenticated;

notify pgrst, 'reload schema';
