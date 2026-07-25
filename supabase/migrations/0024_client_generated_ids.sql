-- Phase 8, part two: let the client name the things it creates.
--
-- An offline write cannot ask the server for an id. If the id only exists after the response
-- comes back, then everything downstream of the id has to wait for the network — which is
-- precisely the thing the outbox exists to avoid.
--
-- Most of the write surface was already ready for this. `create_expense` coalesces a payload
-- `id`, `create_group` coalesces one, and `record_settlement` does too — all three have
-- accepted a client-chosen uuid since Phase 3 and simply were never given one. Two did not:
--
--   * `create_expense`'s inline `new_group` branch generated the group id server-side with no
--     coalesce, which is the awkward one because that is the PRIMARY way groups get made in
--     this app. Fixed in 0023 along with its missing fan-out.
--   * `upsert_contact_profile`, below.
--
-- `add_comment` deliberately keeps its server-generated id. A queued comment does not need a
-- stable identity: nothing links to it, nothing else references it, and the optimistic row is
-- rendered from the outbox itself and replaced wholesale when the refetch lands. Freezing the
-- mutation key at enqueue time is enough to stop it double-posting, and that is a client-side
-- fix, not a schema one.

-- ---------------------------------------------------------------- upsert_contact_profile

/*
 * Create (or find) a profile for someone who has not signed up.
 *
 * Two additions, both required before "add someone by name" can work without a network.
 *
 * **`p_profile_id`** — the caller may name the profile it is creating. That id then flows
 * straight into the picker's selection, the route params, the expense's payers and splits, and
 * a group's member list, all before the server has heard of the person. Without it, naming a
 * friend offline produces someone you cannot put on an expense, which is the entire reason for
 * naming them.
 *
 * A supplied id that already belongs to somebody else is refused rather than returned. Handing
 * back a profile the caller merely guessed the id of would turn this into an oracle for "does
 * this uuid exist", and the whole point of dropping the `pg_trgm` directory search in Phase 7
 * was to not have one of those. Returning it when the caller created it themselves is not a
 * disclosure — they already knew.
 *
 * **`p_client_mutation_id`** — optional, and the honest fix for the duplicate-person bug. This
 * RPC deduped only on an exact contact point, so a retried add-person with no email address
 * created a second stranger with the same name every single time. That could not happen before
 * because nothing retried; an outbox retries by design.
 *
 * Both parameters default to null, so the online path is unchanged.
 */
drop function if exists public.upsert_contact_profile(text, public.contact_kind, text);
drop function if exists app.upsert_contact_profile(text, public.contact_kind, text);

create or replace function app.upsert_contact_profile(
  p_display_name       text,
  p_kind               public.contact_kind default null,
  p_value_norm         text default null,
  p_profile_id         uuid default null,
  p_client_mutation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth_ext.assert_signed_in();
  v_cached  jsonb;
  v_profile uuid;
  v_owner   uuid;
begin
  if p_client_mutation_id is not null then
    v_cached := internal.claim_mutation(
      p_client_mutation_id, v_me, 'upsert_contact_profile',
      jsonb_build_object(
        'display_name', p_display_name,
        'kind', p_kind,
        'value_norm', p_value_norm,
        'profile_id', p_profile_id
      ));
    if v_cached is not null then
      return (v_cached->>'profile_id')::uuid;
    end if;
  end if;

  -- A retry of our own create. Answering this before the contact-point lookup matters: the
  -- first attempt may have committed the profile AND its contact point, and we want the same
  -- id back rather than a second row.
  --
  -- The test is EXISTENCE first, then ownership — not "is there an owner". Real accounts have
  -- `created_by_profile_id` null (the signup trigger makes them, nobody does), so a check that
  -- only looked at the owner column fell straight through for every signed-up user and let the
  -- insert fail with a raw primary-key violation instead of a refusal. Same outcome for an
  -- attacker, but the wrong one for us: an unhandled 23505 is a bug, not a decision.
  if p_profile_id is not null
     and exists (select 1 from public.profiles where id = p_profile_id) then

    select created_by_profile_id into v_owner from public.profiles where id = p_profile_id;

    if v_owner is distinct from v_me then
      raise exception 'that profile id is not yours to create' using errcode = '42501';
    end if;

    -- Ours. Note this stays right even after they sign up and claim the placeholder in place:
    -- it is still the same person, and "find or create" should still find them.
    if p_client_mutation_id is not null then
      perform internal.finish_mutation(
        p_client_mutation_id, jsonb_build_object('profile_id', p_profile_id));
    end if;
    return p_profile_id;
  end if;

  if p_value_norm is not null and p_kind is not null then
    select profile_id into v_profile
    from public.profile_contact_points
    where kind = p_kind and value_norm = p_value_norm and retired_at is null
    limit 1;

    if v_profile is not null then
      v_profile := auth_ext.resolve_profile_id(v_profile);
      if p_client_mutation_id is not null then
        perform internal.finish_mutation(
          p_client_mutation_id, jsonb_build_object('profile_id', v_profile));
      end if;
      return v_profile;
    end if;
  end if;

  insert into public.profiles (id, display_name, created_by_profile_id)
  values (coalesce(p_profile_id, extensions.gen_random_uuid()), p_display_name, v_me)
  returning id into v_profile;

  if p_value_norm is not null and p_kind is not null then
    insert into public.profile_contact_points (profile_id, kind, value_norm, source)
    values (v_profile, p_kind, p_value_norm, 'invite');
  end if;

  if p_client_mutation_id is not null then
    perform internal.finish_mutation(
      p_client_mutation_id, jsonb_build_object('profile_id', v_profile));
  end if;

  return v_profile;
end;
$$;

create or replace function public.upsert_contact_profile(
  p_display_name       text,
  p_kind               public.contact_kind default null,
  p_value_norm         text default null,
  p_profile_id         uuid default null,
  p_client_mutation_id uuid default null
)
returns uuid language sql set search_path = '' as $$
  select app.upsert_contact_profile(p_display_name, p_kind, p_value_norm, p_profile_id, p_client_mutation_id);
$$;

-- `revoke ... from public, anon` rather than from anon alone. Postgres grants EXECUTE to
-- PUBLIC on every newly created function and `anon` is a member of PUBLIC, so revoking from
-- anon by name leaves the inherited grant in place and the function stays reachable without a
-- session. supabase/tests/guardrails.test.sql asserts this by asking what anon can reach.
revoke all on function
  app.upsert_contact_profile(text, public.contact_kind, text, uuid, uuid),
  public.upsert_contact_profile(text, public.contact_kind, text, uuid, uuid)
from public, anon;

grant execute on function
  app.upsert_contact_profile(text, public.contact_kind, text, uuid, uuid),
  public.upsert_contact_profile(text, public.contact_kind, text, uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
