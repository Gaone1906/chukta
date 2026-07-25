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

export interface ExpenseDetail {
  expense: {
    id: string;
    group_id: string | null;
    group_name: string | null;
    description: string;
    amount_minor: bigint;
    currency: string;
    split_type: 'equal' | 'exact' | 'percentage' | 'shares' | 'itemized';
    spent_on: string;
    revision: number;
    deleted_at: string | null;
    created_by_profile_id: string;
    created_at: string;
  };
  my_share_minor: bigint;
  my_paid_minor: bigint;
  payers: {
    profile_id: string;
    display_name: string;
    avatar_url: string | null;
    paid_amount_minor: bigint;
  }[];
  splits: {
    profile_id: string;
    display_name: string;
    avatar_url: string | null;
    share_amount_minor: bigint;
    weight: number | null;
  }[];
  items: {
    id: string;
    name: string;
    amount_minor: bigint;
    kind: 'line' | 'tax' | 'tip' | 'discount';
    participants: string[];
  }[];
  comments: {
    id: string;
    author_profile_id: string;
    display_name: string;
    avatar_url: string | null;
    body: string;
    created_at: string;
  }[];
  history: {
    revision: number;
    action: string;
    actor_profile_id: string | null;
    display_name: string | null;
    created_at: string;
  }[];
  receipts: { id: string; storage_path: string; mime_type: string }[];
}

export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetail> {
  const raw = await rpc<Record<string, any>>('get_expense_detail', { p_expense_id: expenseId });
  const e = raw.expense as Record<string, unknown>;

  return {
    expense: {
      id: String(e.id),
      group_id: (e.group_id as string | null) ?? null,
      group_name: (e.group_name as string | null) ?? null,
      description: String(e.description),
      amount_minor: big(e.amount_minor),
      currency: String(e.currency ?? 'INR'),
      split_type: e.split_type as ExpenseDetail['expense']['split_type'],
      spent_on: String(e.spent_on),
      revision: Number(e.revision ?? 1),
      deleted_at: (e.deleted_at as string | null) ?? null,
      created_by_profile_id: String(e.created_by_profile_id),
      created_at: String(e.created_at),
    },
    my_share_minor: big(raw.my_share_minor),
    my_paid_minor: big(raw.my_paid_minor),
    payers: (raw.payers ?? []).map((p: Record<string, unknown>) => ({
      profile_id: String(p.profile_id),
      display_name: String(p.display_name),
      avatar_url: (p.avatar_url as string | null) ?? null,
      paid_amount_minor: big(p.paid_amount_minor),
    })),
    splits: (raw.splits ?? []).map((s: Record<string, unknown>) => ({
      profile_id: String(s.profile_id),
      display_name: String(s.display_name),
      avatar_url: (s.avatar_url as string | null) ?? null,
      share_amount_minor: big(s.share_amount_minor),
      weight: s.weight == null ? null : Number(s.weight),
    })),
    items: (raw.items ?? []).map((i: Record<string, unknown>) => ({
      id: String(i.id),
      name: String(i.name),
      amount_minor: big(i.amount_minor),
      kind: i.kind as ExpenseDetail['items'][number]['kind'],
      participants: ((i.participants as string[] | null) ?? []).map(String),
    })),
    comments: (raw.comments ?? []).map((c: Record<string, unknown>) => ({
      id: String(c.id),
      author_profile_id: String(c.author_profile_id),
      display_name: String(c.display_name),
      avatar_url: (c.avatar_url as string | null) ?? null,
      body: String(c.body),
      created_at: String(c.created_at),
    })),
    history: (raw.history ?? []).map((h: Record<string, unknown>) => ({
      revision: Number(h.revision),
      action: String(h.action),
      actor_profile_id: (h.actor_profile_id as string | null) ?? null,
      display_name: (h.display_name as string | null) ?? null,
      created_at: String(h.created_at),
    })),
    receipts: (raw.receipts ?? []).map((a: Record<string, unknown>) => ({
      id: String(a.id),
      storage_path: String(a.storage_path),
      mime_type: String(a.mime_type),
    })),
  };
}

/** One change, as it arrives live or comes back from a catch-up pull. */
export interface ChangeEvent {
  event_id: number;
  entity_type: 'expense' | 'settlement' | 'comment' | 'group' | 'member' | 'profile';
  entity_id: string;
  op: 'insert' | 'update' | 'delete';
  group_id: string | null;
  actor_profile_id: string | null;
  payload: Record<string, unknown>;
}

export interface SyncPull {
  /** The cursor fell outside the retention window — start over rather than miss a month. */
  full_resync: boolean;
  events: ChangeEvent[];
  cursor: number;
}

/**
 * Everything that happened to me since event N.
 *
 * The catch-up half of the live path: a broadcast covers the app being open, this covers it
 * having been closed. Both read the same table and speak the same cursor, so a client that
 * misses a broadcast is not missing anything permanently — the next pull has it.
 */
export async function syncPull(sinceEventId: number, limit = 500): Promise<SyncPull> {
  const raw = await rpc<{
    full_resync: boolean;
    events: Record<string, unknown>[] | null;
    cursor: number | string;
  }>('sync_pull', { p_since_event_id: sinceEventId, p_limit: limit });

  return {
    full_resync: Boolean(raw.full_resync),
    events: (raw.events ?? []).map((e) => ({
      event_id: Number(e.id ?? e.event_id ?? 0),
      entity_type: e.entity_type as ChangeEvent['entity_type'],
      entity_id: String(e.entity_id),
      op: e.op as ChangeEvent['op'],
      group_id: (e.group_id as string | null) ?? null,
      actor_profile_id: (e.actor_profile_id as string | null) ?? null,
      payload: (e.payload as Record<string, unknown>) ?? {},
    })),
    cursor: Number(raw.cursor ?? sinceEventId),
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
  /**
   * Set to create the group inline — naming it promotes the participant set into a group.
   *
   * `id` is supplied by the client so a queued expense can name the group it belongs to before
   * either has reached the server. Optional only for callers that are definitely online; the
   * offline path always sets it.
   */
  newGroup?: { id?: string; name: string; memberProfileIds: string[] } | null;
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
      ? {
          id: draft.newGroup.id ?? null,
          name: draft.newGroup.name,
          member_profile_ids: draft.newGroup.memberProfileIds,
        }
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

/**
 * Create a group with no expenses in it yet — the "+ New group" escape hatch in the picker.
 *
 * The main path never needs this: naming the group field on the expense form promotes the
 * participant set into a group in the same call. This is for the user who wants the group to
 * exist first.
 */
export async function createGroup(
  input: { id?: string; name: string; memberProfileIds: string[] },
  mutationId: string,
): Promise<{ group_id: string; name: string }> {
  return rpc('create_group', {
    p_payload: {
      id: input.id ?? Crypto.randomUUID(),
      name: input.name,
      member_profile_ids: input.memberProfileIds,
    },
    p_client_mutation_id: mutationId,
  });
}

export async function addGroupMembers(
  groupId: string,
  profileIds: string[],
  mutationId: string,
): Promise<{ group_id: string; added: number }> {
  return rpc('add_group_members', {
    p_group_id: groupId,
    p_profile_ids: profileIds,
    p_client_mutation_id: mutationId,
  });
}

/**
 * Create (or find) a profile for someone who has not signed up.
 *
 * `profileId` is the id the caller has already started using — an offline "add someone by
 * name" has to be able to put them on an expense before the server has heard of either. The
 * server honours it when it is free and refuses it when it belongs to somebody else.
 *
 * **The returned id may not be the one you asked for.** If the contact point matches a person
 * who already exists, you get theirs — that is the dedupe working, and it is why the outbox
 * drainer remaps the id across everything still queued behind this row.
 */
export async function upsertContactProfile(
  displayName: string,
  contact?: { kind: 'phone' | 'email'; value: string },
  profileId?: string,
  mutationId?: string,
): Promise<string> {
  return rpc<string>('upsert_contact_profile', {
    p_display_name: displayName,
    p_kind: contact?.kind ?? null,
    p_value_norm: contact?.value ?? null,
    p_profile_id: profileId ?? null,
    p_client_mutation_id: mutationId ?? null,
  });
}

/** People the caller already shares a group or an expense with. Used by the picker. */
export async function searchKnownPeople(search: string): Promise<HomePerson[]> {
  const home = await getHomeSummary();
  const term = search.trim().toLowerCase();
  if (!term) return home.people;
  return home.people.filter((p) => p.display_name.toLowerCase().includes(term));
}

// ---------------------------------------------------------------- sidebar surfaces

export interface NotificationPrefs {
  new_expenses: boolean;
  expense_edits: boolean;
  comments: boolean;
  settlements: boolean;
  reminders: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  new_expenses: true,
  expense_edits: true,
  comments: true,
  settlements: true,
  reminders: true,
};

/**
 * Notification preferences, defaulted rather than required to exist.
 *
 * The row is created lazily on the first change, so a user who never opens Settings has no row
 * at all — and "no row" has to mean the defaults, not "everything off". Phase 9 reads the same
 * table server-side and applies the same defaults there.
 */
export async function getNotificationPrefs(profileId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('new_expenses, expense_edits, comments, settlements, reminders')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) throw translateError(error);
  return { ...DEFAULT_PREFS, ...(data ?? {}) };
}

export async function setNotificationPrefs(
  profileId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  // Upsert rather than update: the row may genuinely not exist yet.
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ profile_id: profileId, ...prefs }, { onConflict: 'profile_id' });

  if (error) throw translateError(error);
}

export async function updateMyProfile(
  profileId: string,
  patch: { display_name?: string; upi_vpa?: string | null; avatar_url?: string | null },
): Promise<void> {
  // A plain table write, not an RPC: 0010 grants UPDATE on exactly these columns and the
  // profiles_update_self policy scopes it to your own row. Nothing here crosses to anyone else.
  const { error } = await supabase.from('profiles').update(patch).eq('id', profileId);
  if (error) throw translateError(error);
}

export async function submitFeedback(
  profileId: string,
  body: string,
  meta: { appVersion?: string; platform?: string } = {},
): Promise<void> {
  const { error } = await supabase.from('feedback').insert({
    profile_id: profileId,
    body: body.trim(),
    app_version: meta.appVersion ?? null,
    platform: meta.platform ?? null,
  });
  if (error) throw translateError(error);
}

export interface InviteLink {
  token: string;
  profile_id: string;
  display_name: string;
  expires_at: string;
}

/** Mint a claim token for a placeholder. Only works for someone who has not signed up. */
export async function createInviteLink(profileId: string): Promise<InviteLink> {
  return rpc<InviteLink>('create_invite_link', { p_profile_id: profileId });
}

export async function claimPlaceholder(token: string): Promise<{ profile_id: string; merged: boolean }> {
  return rpc('claim_placeholder', { p_token: token });
}

/**
 * Delete the account. Anonymises the profile and removes the login — see 0020 for why a hard
 * delete is impossible when your splits are half of somebody else's balance.
 */
export async function deleteAccount(): Promise<void> {
  await rpc('delete_account', {});
}
