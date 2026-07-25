-- Structural guardrails.
--
-- Every write RPC is SECURITY DEFINER and therefore bypasses RLS entirely. That is the whole
-- design — but it means a function that forgets its authorisation check is an open door with
-- no second line of defence. These tests inspect the catalogue rather than trusting review.

begin;
select plan(6);

-- Every SECURITY DEFINER function in `app` must pin its search_path. Without it, an
-- unqualified reference inside the body can be resolved against a schema the caller controls.
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','auth_ext','internal')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
       where c like 'search_path=%'
     )),
  0,
  'every SECURITY DEFINER function pins search_path'
);

-- Every mutating RPC must open with an authorisation assert. Checked by looking for the call
-- in the body rather than by reading the code and hoping.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.prosecdef
     and p.proname in (
       'create_expense','update_expense','delete_expense','restore_expense',
       'record_settlement','add_comment','upsert_contact_profile','claim_placeholder',
       'create_group','add_group_members')
     and p.prosrc not like '%auth_ext.assert_signed_in()%'),
  '',
  'every write RPC calls auth_ext.assert_signed_in()'
);

-- Clients must not hold write privileges on any money table; the RPCs are the only path in.
select is(
  (select coalesce(string_agg(distinct table_name, ', '), '')
   from information_schema.role_table_grants
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type in ('INSERT','UPDATE','DELETE')
     and table_name in (
       'expenses','expense_payers','expense_splits','expense_debts','expense_participants',
       'expense_items','expense_item_shares','expense_comments','expense_revisions',
       'settlements','groups','group_members','profile_claims')),
  '',
  'authenticated has no INSERT/UPDATE/DELETE on any money table'
);

-- RLS on with NO policy denies everyone, which surfaces as a mysteriously empty screen rather
-- than an error. That is intentional for a couple of tables that only RPCs ever touch, so
-- those are listed explicitly here — anything new showing up is a mistake.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and c.relname not in ('profile_claims')   -- deny-all on purpose: invite tokens are RPC-only
     and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)),
  '',
  'every RLS-enabled table has a policy, apart from the documented deny-all ones'
);

-- And the converse: a public table with RLS switched off is readable by anyone.
select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity),
  '',
  'every public table has RLS enabled'
);

-- The recursion breaker has to stay SECURITY DEFINER; downgrading it would make every
-- group_members policy recurse.
select is(
  (select p.prosecdef
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'auth_ext' and p.proname = 'my_group_ids'),
  true,
  'auth_ext.my_group_ids is SECURITY DEFINER, or group_members RLS recurses'
);

select * from finish();
rollback;
