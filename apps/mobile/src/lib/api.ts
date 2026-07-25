import * as Crypto from 'expo-crypto';

import { translateError } from './errors';
import { supabase } from './supabase';

/**
 * The only place the app talks to the database.
 *
 * No screen imports `supabase` directly. Everything goes through these wrappers so the RPC
 * names, the payload shapes and the error translation live in one file rather than being
 * spread across a dozen components.
 *
 * Money crosses this boundary as a STRING, not a number. `amount_minor` is a Postgres bigint
 * and the app holds it as a JS `bigint`; JSON has neither, and routing it through `number`
 * would silently lose precision above 2^53. Every conversion is explicit here.
 */

// ---------------------------------------------------------------- shapes

export interface HomeGroup {
  id: string;
  name: string;
  member_count: number;
  net_minor: bigint;
  currency: string;
}

export interface HomePerson {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_placeholder: boolean;
  shared_group_count: number;
  net_minor: bigint;
}

export interface HomeSummary {
  profile_id: string;
  groups: HomeGroup[];
  people: HomePerson[];
}

export interface GroupMember {
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  is_placeholder: boolean;
  net_minor: bigint;
}

export interface ExpenseListItem {
  id: string;
  description: string;
  amount_minor: bigint;
  spent_on: string;
  revision: number;
  my_share_minor: bigint;
  split_count: number;
  payers: { profile_id: string; paid_amount_minor: bigint }[];
}

export interface GroupDetail {
  group: { id: string; name: string; currency: string; simplify_debts: boolean };
  members: GroupMember[];
  expenses: ExpenseListItem[];
}

export interface PersonExpenseItem {
  id: string;
  description: string;
  amount_minor: bigint;
  spent_on: string;
  group_id: string | null;
  group_name: string | null;
  my_share_minor: bigint;
  their_share_minor: bigint;
}

export interface PersonDetail {
  person: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    upi_vpa: string | null;
    is_placeholder: boolean;
  };
  net_minor: bigint;
  by_group: { group_id: string | null; group_name: string | null; net_minor: bigint }[];
  expenses: PersonExpenseItem[];
}

export interface Transfer {
  from_profile_id: string;
  to_profile_id: string;
  amount_minor: bigint;
}

// ---------------------------------------------------------------- helpers

/** Postgres returns bigint as a string over the wire, precisely so precision survives. */
const big = (value: unknown): bigint => BigInt(String(value ?? 0));

/**
 * Idempotency key for a mutation. The RPCs record it in `internal.mutation_log` and return
 * the original result on replay — which is what makes a retry after a lost response safe,
 * and the seam Phase 8's outbox plugs into.
 */
export const newMutationId = (): string => Crypto.randomUUID();

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw translateError(error);
  return data as T;
}

// ---------------------------------------------------------------- reads

export async function getHomeSummary(): Promise<HomeSummary> {
  const raw = await rpc<{
    profile_id: string;
    groups: Record<string, unknown>[];
    people: Record<string, unknown>[];
  }>('get_home_summary', {});

  return {
    profile_id: raw.profile_id,
    groups: (raw.groups ?? []).map((g) => ({
      id: String(g.id),
      name: String(g.name),
      member_count: Number(g.member_count ?? 0),
      net_minor: big(g.net_minor),
      currency: String(g.currency ?? 'INR'),
    })),
    people: (raw.people ?? []).map((p) => ({
      id: String(p.id),
      display_name: String(p.display_name),
      avatar_url: (p.avatar_url as string | null) ?? null,
      is_placeholder: Boolean(p.is_placeholder),
      shared_group_count: Number(p.shared_group_count ?? 0),
      net_minor: big(p.net_minor),
    })),
  };
}

export async function getGroupDetail(groupId: string, before?: string): Promise<GroupDetail> {
  const raw = await rpc<{
    group: Record<string, unknown>;
    members: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
  }>('get_group_detail', { p_group_id: groupId, p_limit: 50, p_before: before ?? null });

  return {
    group: {
      id: String(raw.group.id),
      name: String(raw.group.name),
      currency: String(raw.group.currency ?? 'INR'),
      simplify_debts: Boolean(raw.group.simplify_debts),
    },
    members: (raw.members ?? []).map((m) => ({
      profile_id: String(m.profile_id),
      display_name: String(m.display_name),
      avatar_url: (m.avatar_url as string | null) ?? null,
      is_placeholder: Boolean(m.is_placeholder),
      net_minor: big(m.net_minor),
    })),
    expenses: (raw.expenses ?? []).map(toExpenseListItem),
  };
}

function toExpenseListItem(e: Record<string, unknown>): ExpenseListItem {
  return {
    id: String(e.id),
    description: String(e.description),
    amount_minor: big(e.amount_minor),
    spent_on: String(e.spent_on),
    revision: Number(e.revision ?? 1),
    my_share_minor: big(e.my_share_minor),
    split_count: Number(e.split_count ?? 0),
    payers: ((e.payers as Record<string, unknown>[] | null) ?? []).map((p) => ({
      profile_id: String(p.profile_id),
      paid_amount_minor: big(p.paid_amount_minor),
    })),
  };
}

export async function getPersonDetail(profileId: string): Promise<PersonDetail> {
  const raw = await rpc<{
    person: Record<string, unknown>;
    net_minor: unknown;
    by_group: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
  }>('get_person_detail', { p_profile_id: profileId, p_limit: 50 });

  return {
    person: {
      id: String(raw.person.id),
      display_name: String(raw.person.display_name),
      avatar_url: (raw.person.avatar_url as string | null) ?? null,
      upi_vpa: (raw.person.upi_vpa as string | null) ?? null,
      is_placeholder: Boolean(raw.person.is_placeholder),
    },
    net_minor: big(raw.net_minor),
    by_group: (raw.by_group ?? []).map((g) => ({
      group_id: (g.group_id as string | null) ?? null,
      group_name: (g.group_name as string | null) ?? null,
      net_minor: big(g.net_minor),
    })),
    expenses: (raw.expenses ?? []).map((e) => ({
      id: String(e.id),
      description: String(e.description),
      amount_minor: big(e.amount_minor),
      spent_on: String(e.spent_on),
      group_id: (e.group_id as string | null) ?? null,
      group_name: (e.group_name as string | null) ?? null,
      my_share_minor: big(e.my_share_minor),
      their_share_minor: big(e.their_share_minor),
    })),
  };
}

export async function getSimplifiedDebts(groupId: string): Promise<Transfer[]> {
  const { data, error } = await supabase.rpc('simplify_group_debts' as never, {
    p_group_id: groupId,
  } as never);
  if (error) throw translateError(error);
  return ((data as Record<string, unknown>[]) ?? []).map((t) => ({
    from_profile_id: String(t.from_profile_id),
    to_profile_id: String(t.to_profile_id),
    amount_minor: big(t.amount_minor),
  }));
}

// ---------------------------------------------------------------- writes

export interface ExpenseDraft {
  id?: string;
  groupId?: string | null;
  /** Set to create the group inline — naming it promotes the participant set into a group. */
  newGroup?: { name: string; memberProfileIds: string[] } | null;
  description: string;
  amountMinor: bigint;
  splitType: 'equal' | 'exact' | 'percentage' | 'shares' | 'itemized';
  spentOn: string;
  payers: { profileId: string; paidAmountMinor: bigint }[];
  splits: { profileId: string; shareAmountMinor: bigint; weight?: number | null }[];
}

function draftToPayload(draft: ExpenseDraft, id: string) {
  return {
    id,
    group_id: draft.groupId ?? null,
    new_group: draft.newGroup
      ? { name: draft.newGroup.name, member_profile_ids: draft.newGroup.memberProfileIds }
      : null,
    description: draft.description,
    // bigint has no JSON representation; send the decimal string and let Postgres parse it.
    amount_minor: draft.amountMinor.toString(),
    split_type: draft.splitType,
    spent_on: draft.spentOn,
    payers: draft.payers.map((p) => ({
      profile_id: p.profileId,
      paid_amount_minor: p.paidAmountMinor.toString(),
    })),
    splits: draft.splits.map((s) => ({
      profile_id: s.profileId,
      share_amount_minor: s.shareAmountMinor.toString(),
      weight: s.weight ?? null,
    })),
  };
}

export async function createExpense(
  draft: ExpenseDraft,
  mutationId: string,
): Promise<{ expense_id: string; group_id: string | null; revision: number }> {
  const id = draft.id ?? Crypto.randomUUID();
  return rpc('create_expense', {
    p_payload: draftToPayload(draft, id),
    p_client_mutation_id: mutationId,
  });
}

export async function updateExpense(
  expenseId: string,
  draft: ExpenseDraft,
  expectedRevision: number,
  mutationId: string,
): Promise<{ expense_id: string; revision: number }> {
  return rpc('update_expense', {
    p_expense_id: expenseId,
    p_payload: draftToPayload(draft, expenseId),
    p_expected_revision: expectedRevision,
    p_client_mutation_id: mutationId,
  });
}

export async function deleteExpense(
  expenseId: string,
  expectedRevision: number,
  mutationId: string,
): Promise<{ expense_id: string; revision: number }> {
  return rpc('delete_expense', {
    p_expense_id: expenseId,
    p_expected_revision: expectedRevision,
    p_client_mutation_id: mutationId,
  });
}

export async function addComment(
  expenseId: string,
  body: string,
  mutationId: string,
): Promise<{ comment_id: string }> {
  return rpc('add_comment', {
    p_expense_id: expenseId,
    p_body: body,
    p_client_mutation_id: mutationId,
  });
}

export async function recordSettlement(
  input: {
    groupId?: string | null;
    fromProfileId: string;
    toProfileId: string;
    amountMinor: bigint;
    method?: 'upi' | 'cash' | 'bank' | 'other';
    note?: string | null;
    settledOn: string;
  },
  mutationId: string,
): Promise<{ settlement_id: string }> {
  return rpc('record_settlement', {
    p_payload: {
      group_id: input.groupId ?? null,
      from_profile_id: input.fromProfileId,
      to_profile_id: input.toProfileId,
      amount_minor: input.amountMinor.toString(),
      method: input.method ?? 'upi',
      note: input.note ?? null,
      settled_on: input.settledOn,
    },
    p_client_mutation_id: mutationId,
  });
}

/** Create (or find) a profile for someone who has not signed up. */
export async function upsertContactProfile(
  displayName: string,
  contact?: { kind: 'phone' | 'email'; value: string },
): Promise<string> {
  return rpc<string>('upsert_contact_profile', {
    p_display_name: displayName,
    p_kind: contact?.kind ?? null,
    p_value_norm: contact?.value ?? null,
  });
}

/** People the caller already shares a group or an expense with. Used by the picker. */
export async function searchKnownPeople(search: string): Promise<HomePerson[]> {
  const home = await getHomeSummary();
  const term = search.trim().toLowerCase();
  if (!term) return home.people;
  return home.people.filter((p) => p.display_name.toLowerCase().includes(term));
}
