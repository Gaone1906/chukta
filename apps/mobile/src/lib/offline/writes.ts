import * as Crypto from 'expo-crypto';

import type { ExpenseDetail, ExpenseDraft } from '@/lib/api';

import {
  effectsOfCreate,
  effectsOfDelete,
  effectsOfMarkPaid,
  effectsOfRestore,
  effectsOfSettlement,
  effectsOfUnmarkPaid,
  effectsOfUpdate,
  merge,
  type ExpenseShape,
} from './effects';
import { enqueue } from './outbox';

/**
 * How a screen makes a change.
 *
 * Every one of these returns synchronously, having written a row to SQLite and computed what
 * it does to the balances. Nothing here awaits the network — the drainer does that, later,
 * possibly much later.
 *
 * That is the actual shift in this phase. Before, a screen called an RPC and lived inside the
 * response: `onSuccess` invalidated the right keys and navigated, `onError` toasted. Now the
 * write is a local fact the instant the button is pressed, and the network is a background
 * detail that either confirms it or, rarely, hands it back for a decision.
 *
 * **Ids are minted here, not by the server.** The screen needs them immediately — to navigate
 * to the group it just created, to tick the person it just named — and a queued write has no
 * response to read one out of. The RPCs have accepted client-supplied ids since Phase 3
 * (`create_expense`, `create_group`, `record_settlement`) and now do for the two that did not
 * (`upsert_contact_profile`, and `create_expense`'s inline `new_group`).
 *
 * **Mutation keys are minted here too, and frozen.** They used to live in a `useRef` on the
 * screen, which is the right *shape* — stable across retries — but the wrong *lifetime*: the
 * ref dies with the screen, and the queue outlives it by hours. `add_comment` was worse: it
 * generated a fresh key on every call, so it was not idempotent at all, and every retry would
 * have posted a second comment. Freezing the key in the row fixes that by construction.
 */

export const newId = (): string => Crypto.randomUUID();

function shapeOf(draft: ExpenseDraft): ExpenseShape {
  return {
    groupId: draft.groupId ?? draft.newGroup?.id ?? null,
    payers: draft.payers.map((p) => ({
      profileId: p.profileId,
      paidAmountMinor: p.paidAmountMinor,
    })),
    splits: draft.splits.map((s) => ({
      profileId: s.profileId,
      shareAmountMinor: s.shareAmountMinor,
    })),
  };
}

/**
 * The expense as it stands on the server, for an edit or a delete to measure against.
 *
 * An edit's overlay is the difference between two positions, so the *old* one has to come from
 * somewhere — and the only honest source is the detail the screen is already displaying, which
 * is what the user is looking at when they change it.
 */
export function shapeFromDetail(detail: ExpenseDetail): ExpenseShape {
  return {
    groupId: detail.expense.group_id,
    payers: detail.payers.map((p) => ({
      profileId: p.profile_id,
      paidAmountMinor: p.paid_amount_minor,
    })),
    splits: detail.splits.map((s) => ({
      profileId: s.profile_id,
      shareAmountMinor: s.share_amount_minor,
    })),
  };
}

export interface QueuedExpense {
  expenseId: string;
  /** Null for a one-off. Set — and already usable — when the form named a new group. */
  groupId: string | null;
}

export function queueCreateExpense(me: string, draft: ExpenseDraft): QueuedExpense {
  const expenseId = draft.id ?? newId();
  const groupId = draft.groupId ?? draft.newGroup?.id ?? null;
  const complete: ExpenseDraft = { ...draft, id: expenseId };

  enqueue({
    clientMutationId: newId(),
    op: 'create_expense',
    payload: complete,
    effects: effectsOfCreate(me, shapeOf(complete)),
    entityId: expenseId,
    groupId,
  });

  return { expenseId, groupId };
}

export function queueUpdateExpense(
  me: string,
  expenseId: string,
  before: ExpenseShape,
  draft: ExpenseDraft,
  expectedRevision: number,
): void {
  enqueue({
    clientMutationId: newId(),
    op: 'update_expense',
    payload: { ...draft, id: expenseId },
    effects: effectsOfUpdate(me, before, shapeOf(draft)),
    entityId: expenseId,
    groupId: draft.groupId ?? null,
    baseRevision: expectedRevision,
  });
}

/**
 * @param settledToMe What has been settled against this expense and paid to you, per person —
 *   `ExpenseDetail.settled_to_me`. Deleting an expense also **voids its linked settlements**
 *   (migration 0039), so the overlay has to undo those alongside the debts. Without it, deleting
 *   a stamped expense briefly shows the payer in the red for money that was both owed to them
 *   and repaid: the debt is removed and the repayment is not.
 */
export function queueDeleteExpense(
  me: string,
  expenseId: string,
  before: ExpenseShape,
  expectedRevision: number,
  settledToMe: readonly { profileId: string; amountMinor: bigint }[] = [],
): void {
  enqueue({
    clientMutationId: newId(),
    op: 'delete_expense',
    payload: { expenseId },
    effects: merge([
      ...effectsOfDelete(me, before),
      ...effectsOfUnmarkPaid(me, before.groupId, settledToMe),
    ]),
    entityId: expenseId,
    groupId: before.groupId,
    baseRevision: expectedRevision,
  });
}

/**
 * Put a deleted expense back.
 *
 * No `baseRevision`, deliberately: the server's precondition is "this expense is deleted", not
 * "this expense is at revision N". Sending one would invent a conflict that cannot happen and
 * push the row into the pending inbox for a reason the user could not act on.
 *
 * @param settledToMe The mirror of the delete's argument. On a deleted expense
 *   `ExpenseDetail.settled_to_me` reports the settlements the delete voided, which are exactly
 *   the ones `restore_expense` brings back — so the two overlays are inverses and a
 *   delete-then-restore leaves the balance where it started.
 */
export function queueRestoreExpense(
  me: string,
  expenseId: string,
  before: ExpenseShape,
  settledToMe: readonly { profileId: string; amountMinor: bigint }[] = [],
): void {
  enqueue({
    clientMutationId: newId(),
    op: 'restore_expense',
    payload: { expenseId },
    effects: merge([
      ...effectsOfRestore(me, before),
      ...effectsOfMarkPaid(me, before.groupId, settledToMe),
    ]),
    entityId: expenseId,
    groupId: before.groupId,
  });
}

export function queueComment(expenseId: string, body: string): void {
  enqueue({
    clientMutationId: newId(),
    op: 'add_comment',
    payload: { body },
    entityId: expenseId,
  });
}

export function queueSettlement(
  me: string,
  input: {
    groupId?: string | null;
    fromProfileId: string;
    toProfileId: string;
    amountMinor: bigint;
    method?: 'upi' | 'cash' | 'bank' | 'other';
    note?: string | null;
    settledOn: string;
  },
  /**
   * The settle screen mints this before the write, because it goes out inside the UPI deep
   * link as the transaction reference — by the time we get here the id has already left the
   * device on somebody else's payment screen, so it cannot be re-keyed.
   */
  mutationId: string,
): void {
  enqueue({
    clientMutationId: mutationId,
    op: 'record_settlement',
    payload: input,
    effects: effectsOfSettlement(me, {
      groupId: input.groupId ?? null,
      fromProfileId: input.fromProfileId,
      toProfileId: input.toProfileId,
      amountMinor: input.amountMinor,
    }),
    groupId: input.groupId ?? null,
  });
}

/**
 * Confirm that everything owed to you on one expense has come back.
 *
 * Queued like every other money write, so it works at a restaurant table with no signal — and
 * carries its own balance movement, so the amount drops the instant the sheet is confirmed
 * rather than whenever the network next appears.
 *
 * No `baseRevision`: the server's precondition is "something is still outstanding to me", not
 * "this expense is at revision N". Sending one would invent a conflict the user could not act
 * on. Same reasoning as `queueRestoreExpense`.
 */
export function queueMarkExpensePaid(
  me: string,
  expenseId: string,
  groupId: string | null,
  owed: readonly { profileId: string; amountMinor: bigint }[],
): void {
  enqueue({
    clientMutationId: newId(),
    op: 'mark_expense_paid',
    payload: { expenseId },
    effects: effectsOfMarkPaid(me, groupId, owed),
    entityId: expenseId,
    groupId,
  });
}

export function queueUnmarkExpensePaid(
  me: string,
  expenseId: string,
  groupId: string | null,
  settled: readonly { profileId: string; amountMinor: bigint }[],
): void {
  enqueue({
    clientMutationId: newId(),
    op: 'unmark_expense_paid',
    payload: { expenseId },
    effects: effectsOfUnmarkPaid(me, groupId, settled),
    entityId: expenseId,
    groupId,
  });
}

export function queueCreateGroup(input: { name: string; memberProfileIds: string[] }): string {
  const groupId = newId();
  enqueue({
    clientMutationId: newId(),
    op: 'create_group',
    payload: { id: groupId, name: input.name, memberProfileIds: input.memberProfileIds },
    entityId: groupId,
    groupId,
  });
  return groupId;
}

export function queueContactProfile(
  displayName: string,
  contact?: { kind: 'phone' | 'email'; value: string },
): string {
  const profileId = newId();
  enqueue({
    clientMutationId: newId(),
    op: 'upsert_contact_profile',
    payload: { displayName, contact, profileId },
    entityId: profileId,
  });
  return profileId;
}
