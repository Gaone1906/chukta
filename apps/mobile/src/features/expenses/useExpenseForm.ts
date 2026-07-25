import { parseAmount, toAmountInput, type SplitType } from '@hisaab/core';
import { useEffect, useMemo, useRef, useState } from 'react';

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
    const base = emptySplitState(seed?.splits?.map((s) => s.profileId) ?? ids);
    if (!seed?.splits) return base;
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

  // Participants arrive from a query, so the first render has none and the initial state above
  // starts empty. Seed the included set exactly once, when they land — after that the list is
  // the user's, and re-seeding would undo every person they deselected.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || ids.length === 0) return;
    seeded.current = true;
    setSplit((prev) => (prev.included.length > 0 ? prev : { ...prev, included: ids }));
  }, [ids]);

  const amountMinor = parseAmount(amountText, 'INR') ?? 0n;
  const amountError =
    amountText.trim() !== '' && parseAmount(amountText, 'INR') === null
      ? 'That is not an amount. Rupees and paise only.'
      : null;

  const { shares, error: splitError } = computeDraftShares(amountMinor, split);

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

  const toDraft = (options: { groupId?: string | null; newGroupMemberIds?: string[] }): ExpenseDraft => ({
    groupId: options.groupId ?? null,
    newGroup:
      groupName.trim() && options.newGroupMemberIds
        ? { name: groupName.trim(), memberProfileIds: options.newGroupMemberIds }
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
    toDraft,
  };
}
