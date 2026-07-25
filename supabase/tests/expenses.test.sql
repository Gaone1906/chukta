-- The write path: one RPC, six tables, one transaction, one idempotency key.

begin;
select plan(16);

-- NOTE: on_auth_user_created auto-creates a profile for every auth.users row. These fixtures
-- want specific, readable profile ids, so the auto-created rows are swapped out below. The
-- trigger's own behaviour is covered properly in identity.test.sql.

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d1');   -- Mallory: a real account, no tie to Ann

delete from public.profiles where user_id in (
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1');

insert into public.profiles (id, user_id, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Ann'),
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'Mallory');
-- Placeholders Ann added herself. In production these arrive through upsert_contact_profile,
-- which stamps created_by_profile_id — the column app.assert_known_profiles reads to decide the
-- caller is allowed to name them. A fixture that left it null would not resemble any real row.
insert into public.profiles (id, display_name, created_by_profile_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Priya', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000001', 'Arjun', 'aaaaaaaa-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ---------------------------------------------------------------- create

select lives_ok(
  $$ select app.create_expense(
       jsonb_build_object(
         'id', 'eeee1111-0000-0000-0000-000000000001',
         'description', 'Beach shack dinner',
         'amount_minor', 432000,
         'split_type', 'equal',
         'spent_on', current_date,
         'new_group', jsonb_build_object(
            'name', 'Goa, finally',
            'member_profile_ids', jsonb_build_array(
              'bbbbbbbb-0000-0000-0000-000000000001',
              'cccccccc-0000-0000-0000-000000000001')),
         'payers', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',432000)),
         'splits', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',144000),
            jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',144000),
            jsonb_build_object('profile_id','cccccccc-0000-0000-0000-000000000001','share_amount_minor',144000))
       ),
       '99999999-0000-0000-0000-000000000001'
     ) $$,
  'create_expense writes an expense, a group and its members in one call'
);

select is(
  (select count(*) from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
  1::bigint,
  'the expense exists'
);

select is(
  (select name from public.groups g
   join public.expenses e on e.group_id = g.id
   where e.id = 'eeee1111-0000-0000-0000-000000000001'),
  'Goa, finally',
  'naming the group promoted the participant set into a real group'
);

select is(
  (select count(*) from public.group_members gm
   join public.expenses e on e.group_id = gm.group_id
   where e.id = 'eeee1111-0000-0000-0000-000000000001'),
  3::bigint,
  'the creator and both named members are in the group'
);

select is(
  (select count(*) from public.expense_participants where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  3::bigint,
  'participants were derived from payers and splits'
);

-- ---------------------------------------------------------------- derived debts

select is(
  (select count(*) from public.expense_debts where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  2::bigint,
  'the payer who also owes is netted, so only two debt edges exist - not three'
);

select is(
  (select count(*) from public.expense_debts
   where expense_id = 'eeee1111-0000-0000-0000-000000000001'
     and from_profile_id = to_profile_id),
  0::bigint,
  'no self-edge: Ann does not owe herself'
);

select is(
  (select sum(amount_minor)::bigint from public.expense_debts where expense_id = 'eeee1111-0000-0000-0000-000000000001'),
  288000::bigint,
  'debts sum to exactly what the other two owe'
);

-- ---------------------------------------------------------------- audit + fan-out

select is(
  (select count(*) from public.expense_revisions
   where expense_id = 'eeee1111-0000-0000-0000-000000000001' and action = 'created'),
  1::bigint,
  'a revision snapshot was recorded'
);

-- Three, not two. Phase 8 removed the actor filter from `internal.emit_change`: excluding the
-- person who made the change is a *notification* rule, and having it in the *sync* spine meant
-- a second device on the same account could never learn about the first one's writes — not
-- live, and not through sync_pull either, since both read this table. See 0023 and
-- tests/sync.test.sql. The push drain in Phase 9 is where the actor gets dropped now.
select is(
  (select count(*) from internal.change_events where entity_id = 'eeee1111-0000-0000-0000-000000000001'),
  3::bigint,
  'change events fan out to every participant, the actor included'
);

-- ---------------------------------------------------------------- idempotency

select lives_ok(
  $$ select app.create_expense(
       jsonb_build_object(
         'id', 'eeee1111-0000-0000-0000-000000000001',
         'description', 'Beach shack dinner',
         'amount_minor', 432000,
         'split_type', 'equal',
         'spent_on', current_date,
         'new_group', jsonb_build_object(
            'name', 'Goa, finally',
            'member_profile_ids', jsonb_build_array(
              'bbbbbbbb-0000-0000-0000-000000000001',
              'cccccccc-0000-0000-0000-000000000001')),
         'payers', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','paid_amount_minor',432000)),
         'splits', jsonb_build_array(
            jsonb_build_object('profile_id','aaaaaaaa-0000-0000-0000-000000000001','share_amount_minor',144000),
            jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',144000),
            jsonb_build_object('profile_id','cccccccc-0000-0000-0000-000000000001','share_amount_minor',144000))
       ),
       '99999999-0000-0000-0000-000000000001'
     ) $$,
  'replaying the same mutation id is accepted rather than erroring'
);

-- Scoped to this test's own expense id rather than counting the whole table: the dev seed in
-- supabase/seed.sql also populates this database, and a global count would make every test
-- here fail the moment the seed grew a row.
select is(
  (select count(*) from public.expenses where id = 'eeee1111-0000-0000-0000-000000000001'),
  1::bigint,
  'THE RETRY CASE: server committed, response lost, client retried - still one expense'
);

-- ---------------------------------------------------------------- the guardrail

select throws_ok(
  $$
    insert into public.expenses (id, group_id, description, amount_minor, split_type, spent_on, created_by_profile_id)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'unbalanced', 1000, 'equal', current_date,
            'aaaaaaaa-0000-0000-0000-000000000001');
    insert into public.expense_payers (expense_id, group_id, profile_id, paid_amount_minor)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 1000);
    insert into public.expense_splits (expense_id, group_id, profile_id, share_amount_minor)
    values ('eeee3333-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000001', 999);
    set constraints all immediate;
  $$,
  '23514',
  null,
  'splits that do not sum to the total are rejected at commit'
);

-- ---------------------------------------------------------------- the takeover this closes
--
-- Ann's placeholder Priya (bbbb…) belongs to Ann. Mallory (dddd…) is a stranger — no shared
-- group, no shared expense, did not create her. Before 0025, Mallory could name Priya in a
-- one-off expense with no group_id to gate on, which minted a shared expense_participants row,
-- which made shares_context_with(Priya) true, which let create_invite_link ->
-- claim_placeholder -> merge_profiles fold Priya (and Ann's ledger against her) into Mallory.
-- The whole chain starts here, so this is where it has to be stopped.

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

select throws_ok(
  $$ select app.create_expense(
       jsonb_build_object(
         'description', 'manufactured context',
         'amount_minor', 2,
         'split_type', 'equal',
         'payers', jsonb_build_array(
            jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','paid_amount_minor',2)),
         'splits', jsonb_build_array(
            jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','share_amount_minor',1),
            jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',1))
       ),
       'a1a1a1a1-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  'cannot include a profile you have no shared context with',
  'a stranger cannot name a placeholder they do not know in a one-off expense'
);

-- The same defence on the edit path: Mallory owns a solo expense, then tries to graft Priya
-- onto its splits. update_expense replaces the split set wholesale, so without the gate this is
-- a second door to the same manufactured-context row.
select app.create_expense(
  jsonb_build_object(
    'id', 'eeee4444-0000-0000-0000-000000000001',
    'description', 'just me', 'amount_minor', 100, 'split_type', 'equal',
    'payers', jsonb_build_array(
       jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','paid_amount_minor',100)),
    'splits', jsonb_build_array(
       jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','share_amount_minor',100))
  ),
  'a2a2a2a2-0000-0000-0000-000000000001'
);

select throws_ok(
  $$ select app.update_expense(
       'eeee4444-0000-0000-0000-000000000001',
       jsonb_build_object(
         'amount_minor', 100,
         'payers', jsonb_build_array(
            jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','paid_amount_minor',100)),
         'splits', jsonb_build_array(
            jsonb_build_object('profile_id','dddddddd-0000-0000-0000-000000000001','share_amount_minor',50),
            jsonb_build_object('profile_id','bbbbbbbb-0000-0000-0000-000000000001','share_amount_minor',50))
       ),
       1,
       'a3a3a3a3-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  'cannot include a profile you have no shared context with',
  'nor can they graft a stranger onto an expense they can already edit'
);

/*
 * The third door, which 0025 left open and 0027 closed.
 *
 * `shares_context_with` is derived from group_members AND expense_participants, so gating the
 * two expense writers only closed half the class: an attacker could make their own group and
 * add the victim's placeholder to it, forging exactly the same context. Found by an adversarial
 * review of the claim-code work and reproduced end to end before the fix.
 */
select app.create_group(
  jsonb_build_object('id', '99999999-0000-0000-0000-000000000001', 'name', 'Mallory''s own group'),
  'a4a4a4a4-0000-0000-0000-000000000001'
);

select throws_ok(
  $$ select app.add_group_members(
       '99999999-0000-0000-0000-000000000001',
       array['bbbbbbbb-0000-0000-0000-000000000001']::uuid[],
       'a5a5a5a5-0000-0000-0000-000000000001'
     ) $$,
  '42501',
  'cannot include a profile you have no shared context with',
  'and cannot smuggle a stranger into a group they own to manufacture context'
);

select * from finish();
rollback;
