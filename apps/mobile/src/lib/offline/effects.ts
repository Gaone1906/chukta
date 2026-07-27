import { resolvePairwise } from '@chukta/core';

/**
 * What a queued write does to the numbers on screen, before the server has seen it.
 *
 * Without this, adding an expense with no signal writes a row into the outbox and changes
 * nothing anyone can see — the balances stay exactly as the last cached server response left
 * them. Which reads as "it didn't save", and that is the one failure this app cannot afford,
 * because entering an expense at a restaurant table with no signal is the core use case rather
 * than an edge case.
 *
 * So each outbox row carries its own balance movement, computed once at enqueue time by the
 * code that already has the payers and splits in hand, and the screens render
 * `server figure + Σ pending effects`. When the row drains and the refetch lands, its effect
 * disappears and the server's own number takes over — so the pending delta is a *temporary
 * overlay on the truth*, never a second source of it.
 *
 * `resolvePairwise` is the same function that produces the client-side split preview and is
 * property-tested against the plpgsql allocator's fixtures, so the overlay and the eventual
 * server answer are computed by the same rules.
 *
 * ---------------------------------------------------------------- sign
 *
 * Positive means **they owe me**, which is what `get_home_summary` returns and what the balance
 * chips render in gold. Traced from `app.v_pair_ledger`, where positive means the lower profile
 * id owes the higher, through the `case when pb.lo = v_me then -pb.net_minor` that flips it into
 * the caller's frame of reference.
 */

export interface PendingEffect {
  /** `person` — my net with that profile. `group` — my net inside that group. */
  scope: 'person' | 'group';
  id: string;
  /** Minor units to add to the server's figure. Positive means they owe me more. */
  deltaMinor: bigint;
}

/** One directed debt: `from` owes `to`. The shape both expenses and settlements reduce to. */
interface DebtEdge {
  from: string;
  to: string;
  amountMinor: bigint;
}

export interface ExpenseShape {
  groupId: string | null;
  payers: { profileId: string; paidAmountMinor: bigint }[];
  splits: { profileId: string; shareAmountMinor: bigint }[];
}

function edgesForExpense(expense: ExpenseShape): DebtEdge[] {
  const paid = new Map<string, bigint>();
  for (const p of expense.payers) {
    paid.set(p.profileId, (paid.get(p.profileId) ?? 0n) + p.paidAmountMinor);
  }

  const owed = new Map<string, bigint>();
  for (const s of expense.splits) {
    owed.set(s.profileId, (owed.get(s.profileId) ?? 0n) + s.shareAmountMinor);
  }

  return resolvePairwise(paid, owed).map((t) => ({
    from: t.from,
    to: t.to,
    amountMinor: t.amountMinor,
  }));
}

/** Fold a set of debt edges into per-person and per-group deltas from `me`'s point of view. */
function foldEdges(edges: DebtEdge[], me: string, groupId: string | null): PendingEffect[] {
  const byPerson = new Map<string, bigint>();
  let groupDelta = 0n;

  for (const edge of edges) {
    if (edge.to === me) {
      // Someone owes me more.
      byPerson.set(edge.from, (byPerson.get(edge.from) ?? 0n) + edge.amountMinor);
      groupDelta += edge.amountMinor;
    } else if (edge.from === me) {
      // I owe someone more.
      byPerson.set(edge.to, (byPerson.get(edge.to) ?? 0n) - edge.amountMinor);
      groupDelta -= edge.amountMinor;
    }
    // Edges between two other people move nothing on any screen this user can see.
  }

  const effects: PendingEffect[] = [];
  for (const [id, deltaMinor] of byPerson) {
    if (deltaMinor !== 0n) effects.push({ scope: 'person', id, deltaMinor });
  }
  if (groupId && groupDelta !== 0n) {
    effects.push({ scope: 'group', id: groupId, deltaMinor: groupDelta });
  }
  return effects;
}

/** Adding an expense. */
export function effectsOfCreate(me: string, expense: ExpenseShape): PendingEffect[] {
  return foldEdges(edgesForExpense(expense), me, expense.groupId);
}

/** Removing one. The exact inverse — a soft delete takes the expense out of the ledger. */
export function effectsOfDelete(me: string, expense: ExpenseShape): PendingEffect[] {
  return negate(effectsOfCreate(me, expense));
}

/**
 * Putting one back. The inverse of the inverse, which is to say the original.
 *
 * Worth spelling out rather than reusing `effectsOfCreate` at the call site: a restore is not a
 * create, it just happens to move the balances by the same amounts. Naming it separately keeps
 * the queued row's intent readable in the outbox, where the op name is all anyone sees.
 */
export function effectsOfRestore(me: string, expense: ExpenseShape): PendingEffect[] {
  return effectsOfCreate(me, expense);
}

/**
 * Editing one: the new position minus the old.
 *
 * Not `effectsOfCreate(next)` alone — the server does not add the edit on top of the original,
 * it replaces it, so the overlay has to cancel what the cached figure already contains.
 */
export function effectsOfUpdate(
  me: string,
  before: ExpenseShape,
  after: ExpenseShape,
): PendingEffect[] {
  return merge([...negate(effectsOfCreate(me, before)), ...effectsOfCreate(me, after)]);
}

/**
 * Recording a settlement.
 *
 * A settlement is a debt edge pointing the other way: if I pay Priya ₹1,350, the ₹1,350 I owed
 * her stops existing, so my net with her moves *up* by exactly that. `app.v_pair_ledger` says
 * the same thing in SQL by giving settlement rows the opposite sign to expense debts.
 */
export function effectsOfSettlement(
  me: string,
  settlement: {
    groupId: string | null;
    fromProfileId: string;
    toProfileId: string;
    amountMinor: bigint;
  },
): PendingEffect[] {
  return foldEdges(
    [
      {
        from: settlement.toProfileId,
        to: settlement.fromProfileId,
        amountMinor: settlement.amountMinor,
      },
    ],
    me,
    settlement.groupId,
  );
}

/**
 * Marking one expense paid in full.
 *
 * Which is N settlements, not one — a single-payer expense split four ways settles three debt
 * edges — so this takes the per-person breakdown the server hands back in `outstanding_to_me`
 * rather than a total. A total could not be split back into the pairs it came from, and the
 * balance the overlay corrects is per pair.
 *
 * The edges are built pointing AWAY from me for the same reason `effectsOfSettlement` does it:
 * a payment cancels a debt, so it is the debt with its direction reversed. Each person here owes
 * me *less* afterwards, which is a negative delta against them.
 */
export function effectsOfMarkPaid(
  me: string,
  groupId: string | null,
  owed: readonly { profileId: string; amountMinor: bigint }[],
): PendingEffect[] {
  return foldEdges(
    owed.map((o) => ({ from: me, to: o.profileId, amountMinor: o.amountMinor })),
    me,
    groupId,
  );
}

/** Taking it back. The exact inverse — the debts come back. */
export function effectsOfUnmarkPaid(
  me: string,
  groupId: string | null,
  settled: readonly { profileId: string; amountMinor: bigint }[],
): PendingEffect[] {
  return negate(effectsOfMarkPaid(me, groupId, settled));
}

function negate(effects: PendingEffect[]): PendingEffect[] {
  return effects.map((e) => ({ ...e, deltaMinor: -e.deltaMinor }));
}

/** Sum effects that land on the same scope and id, dropping anything that cancels to zero. */
export function merge(effects: PendingEffect[]): PendingEffect[] {
  const totals = new Map<string, PendingEffect>();
  for (const effect of effects) {
    const key = `${effect.scope}:${effect.id}`;
    const existing = totals.get(key);
    if (existing) existing.deltaMinor += effect.deltaMinor;
    else totals.set(key, { ...effect });
  }
  return [...totals.values()].filter((e) => e.deltaMinor !== 0n);
}

/** The delta to apply to one figure. `merge` first if you are reading many rows. */
export function deltaFor(
  effects: readonly PendingEffect[],
  scope: PendingEffect['scope'],
  id: string,
): bigint {
  let total = 0n;
  for (const effect of effects) {
    if (effect.scope === scope && effect.id === id) total += effect.deltaMinor;
  }
  return total;
}
