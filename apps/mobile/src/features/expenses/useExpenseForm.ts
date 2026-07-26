import { formatAmount, money, parseAmount, toAmountInput, type SplitType } from '@chukta/core';
import { useMemo, useState } from 'react';

import type { ExpenseDraft } from '@/lib/api';
import type { Participant, Payer } from './PayerSheet';
import { computeDraftShares, emptySplitState, weightFor, type SplitState } from './splitDraft';
import { toISODate } from './DateSheet';

export interface ExpenseFormSeed {
  description?: string;
  amountMinor?: bigint;
  spentOn?: string;
  splitType?: SplitType;
  payers?: Payer[];
  /** Existing per-person shares, used to seed the exact-amount editor when editing. */
  splits?: { profileId: string; shareAmountMinor: bigint; weight?: number | null }[];
}

/**
 * All of the expense form's state, and its reduction to an `ExpenseDraft`.
 *
 * Extracted from the screen because three entry points (Home picker, group FAB, person FAB)
 * and the edit screen all drive the same form. The screen renders; this decides.
 */
export function useExpenseForm(
  participants: Participant[],
  meId: string | null,
  seed?: ExpenseFormSeed,
) {
  const ids = useMemo(() => participants.map((p) => p.id), [participants]);

  const [description, setDescription] = useState(seed?.description ?? '');
  const [amountText, setAmountText] = useState(
    seed?.amountMinor ? toAmountInput(seed.amountMinor, 'INR') : '',
  );
  const [spentOn, setSpentOn] = useState(seed?.spentOn ?? toISODate(new Date()));
  const [groupName, setGroupName] = useState('');
  const [payers, setPayers] = useState<Payer[]>(seed?.payers ?? []);
  const [split, setSplit] = useState<SplitState>(() => {
    if (!seed?.splits) return emptySplitState();

    // Editing: anyone on the roster who has no split row was deliberately left off, so they
    // start out deselected. Safe to read `ids` here because the edit screen only mounts this
    // form once the expense and its group have both loaded — a new expense, whose roster does
    // arrive piecemeal, takes the branch above and needs no roster at all.
    const onExpense = new Set(seed.splits.map((s) => s.profileId));
    const base = emptySplitState(ids.filter((id) => !onExpense.has(id)));

    return {
      ...base,
      type: seed.splitType ?? 'equal',
      exact: Object.fromEntries(
        seed.splits.map((s) => [s.profileId, toAmountInput(s.shareAmountMinor, 'INR')]),
      ),
      percentage: Object.fromEntries(
        seed.splits.filter((s) => s.weight != null).map((s) => [s.profileId, String(s.weight)]),
      ),
      shares: Object.fromEntries(
        seed.splits.filter((s) => s.weight != null).map((s) => [s.profileId, String(s.weight)]),
      ),
    };
  });

  const amountMinor = parseAmount(amountText, 'INR') ?? 0n;
  const amountError =
    amountText.trim() !== '' && parseAmount(amountText, 'INR') === null
      ? 'That is not an amount. Rupees and paise only.'
      : null;

  const { shares, error: splitError } = computeDraftShares(amountMinor, split, ids);

  // Nobody named a payer yet: assume the person entering it paid. That is right almost every
  // time, and the row shows what was assumed rather than hiding it. Falls back to the first
  // participant only when the session profile is somehow missing.
  const defaultPayer = meId && ids.includes(meId) ? meId : ids[0];
  const effectivePayers: Payer[] =
    payers.length > 0
      ? payers
      : defaultPayer
        ? [{ profileId: defaultPayer, paidAmountMinor: amountMinor }]
        : [];

  // The payer total is pinned to the expense total. Editing the amount after choosing a single
  // payer must move their contribution with it, or the balanced-expense trigger rejects the
  // write at commit with a message about sums that the user cannot act on.
  const normalisedPayers: Payer[] =
    effectivePayers.length === 1 && effectivePayers[0]
      ? [{ ...effectivePayers[0], paidAmountMinor: amountMinor }]
      : effectivePayers;

  const paidTotal = normalisedPayers.reduce((sum, p) => sum + p.paidAmountMinor, 0n);
  const payerError =
    amountMinor > 0n && paidTotal !== amountMinor
      ? 'What the payers put in does not add up to the total.'
      : null;

  const ready =
    amountMinor > 0n &&
    description.trim().length > 0 &&
    shares !== null &&
    payerError === null &&
    amountError === null;

  /**
   * An expense where everyone's share is exactly what they put in.
   *
   * It saves, and it moves nobody's balance — which from the outside is indistinguishable from
   * a save that failed, and is what someone hit on 2026-07-25 and reported as "it didn't
   * record". Said out loud rather than blocked: "I paid for my own thing" is a real thing to
   * want in the ledger, and refusing it would be the app deciding it knows better.
   */
  const netZeroWarning = ((): string | null => {
    if (!ready || shares === null) return null;

    const net = new Map<string, bigint>();
    for (const p of normalisedPayers) {
      net.set(p.profileId, (net.get(p.profileId) ?? 0n) + p.paidAmountMinor);
    }
    for (const [id, share] of shares) net.set(id, (net.get(id) ?? 0n) - share);
    if (![...net.values()].every((v) => v === 0n)) return null;

    const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? 'They';
    const total = formatAmount(money(amountMinor, 'INR'));

    // The single-person case is the one people actually hit, and naming who makes the reason
    // obvious at a glance — a generic sentence just reads as the app being unsure.
    if (shares.size === 1 && normalisedPayers.length === 1) {
      const who = nameOf(normalisedPayers[0]!.profileId);
      return who === 'You'
        ? `You paid ${total} and are the only one splitting it, so nobody ends up owing anything.`
        : `${who} paid ${total} and is the only one splitting it, so nobody ends up owing anything.`;
    }
    return `Everyone's share matches what they put in, so this changes nobody's balance.`;
  })();

  const toDraft = (options: {
    groupId?: string | null;
    newGroupMemberIds?: string[];
    /** The id the caller has already committed to for an inline new group. */
    newGroupId?: string;
  }): ExpenseDraft => ({
    groupId: options.groupId ?? null,
    newGroup:
      groupName.trim() && options.newGroupMemberIds
        ? {
            id: options.newGroupId,
            name: groupName.trim(),
            memberProfileIds: options.newGroupMemberIds,
          }
        : null,
    description: description.trim(),
    amountMinor,
    splitType: split.type,
    spentOn,
    payers: normalisedPayers,
    splits: [...(shares ?? new Map())].map(([profileId, shareAmountMinor]) => ({
      profileId,
      shareAmountMinor,
      weight: weightFor(split, profileId),
    })),
  });

  return {
    description,
    setDescription,
    amountText,
    setAmountText,
    amountMinor,
    amountError,
    spentOn,
    setSpentOn,
    groupName,
    setGroupName,
    payers: normalisedPayers,
    setPayers,
    payerError,
    split,
    setSplit,
    shares,
    splitError,
    ready,
    netZeroWarning,
    toDraft,
  };
}
