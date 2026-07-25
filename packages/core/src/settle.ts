/**
 * Turning an expense into who-owes-whom, and turning a pile of balances into the fewest
 * payments that clear them.
 */

import { allocate } from './allocate';

export interface Transfer {
  from: string;
  to: string;
  amountMinor: bigint;
}

export class SettleError extends Error {}

/**
 * Net each participant to a residual, then resolve the residuals into pairwise debts.
 *
 * Netting first is what stops a person who both paid and owes from producing a self-edge: if
 * Priya paid ₹4,320 and owes ₹1,080 of it, she is simply owed ₹3,240 — she does not owe
 * herself anything.
 *
 * Each debtor's residual is then spread across the creditors in proportion to *their*
 * residuals, through the same allocator, so the pairwise amounts sum exactly to the netted
 * total with no leftover paisa.
 */
export function resolvePairwise(
  paid: ReadonlyMap<string, bigint>,
  owed: ReadonlyMap<string, bigint>,
): Transfer[] {
  const people = new Set<string>([...paid.keys(), ...owed.keys()]);
  const residual = new Map<string, bigint>();

  for (const person of people) {
    const net = (paid.get(person) ?? 0n) - (owed.get(person) ?? 0n);
    if (net !== 0n) residual.set(person, net);
  }

  const creditors = [...residual.entries()].filter(([, v]) => v > 0n).sort(byKey);
  const debtors = [...residual.entries()].filter(([, v]) => v < 0n).sort(byKey);

  if (creditors.length === 0 || debtors.length === 0) return [];

  const creditTotal = creditors.reduce((sum, [, v]) => sum + v, 0n);
  const debtTotal = debtors.reduce((sum, [, v]) => sum - v, 0n);
  if (creditTotal !== debtTotal) {
    throw new SettleError(
      `payers and shares do not balance: credits ${creditTotal}, debts ${debtTotal}`,
    );
  }

  const transfers: Transfer[] = [];
  const creditorKeys = creditors.map(([k]) => k);
  const creditorWeights = creditors.map(([, v]) => v);

  for (const [debtor, negative] of debtors) {
    const amount = -negative;
    const portions = allocate({ total: amount, weights: creditorWeights, keys: creditorKeys });
    creditorKeys.forEach((creditor, i) => {
      const value = portions[i]!;
      if (value > 0n) transfers.push({ from: debtor, to: creditor, amountMinor: value });
    });
  }

  return transfers;
}

export interface Balance {
  profileId: string;
  /** Positive means they are owed money; negative means they owe. Must sum to zero overall. */
  netMinor: bigint;
}

/**
 * Simplified debts: the fewest payments that clear a set of balances.
 *
 *   Pass 1 — exact cancellations. Match any debtor whose debt exactly equals some creditor's
 *            credit. These are free wins and they preserve real relationships: if you owe
 *            Arjun exactly what he is owed, you pay Arjun.
 *   Pass 2 — greedy max cash flow on whatever is left: repeatedly match the largest debtor
 *            with the largest creditor.
 *
 * Yields at most n−1 transfers. Finding the true minimum is NP-hard (it reduces to
 * subset-sum), so greedy is the correct engineering answer here — Splitwise does the same.
 *
 * This is a VIEW, never a mutation. A recorded settlement always names the pair who actually
 * exchanged money, not a simplified edge.
 */
export function simplifyDebts(balances: readonly Balance[]): Transfer[] {
  const net = new Map<string, bigint>();
  for (const { profileId, netMinor } of balances) {
    net.set(profileId, (net.get(profileId) ?? 0n) + netMinor);
  }

  let sum = 0n;
  for (const value of net.values()) sum += value;
  if (sum !== 0n) throw new SettleError(`balances must sum to zero, got ${sum}`);

  let creditors = [...net.entries()].filter(([, v]) => v > 0n).map(([k, v]) => ({ id: k, amount: v }));
  let debtors = [...net.entries()].filter(([, v]) => v < 0n).map(([k, v]) => ({ id: k, amount: -v }));

  const transfers: Transfer[] = [];

  // Pass 1: exact matches, smallest id first so the choice is deterministic.
  creditors.sort((a, b) => cmpId(a.id, b.id));
  debtors.sort((a, b) => cmpId(a.id, b.id));

  for (const debtor of debtors) {
    if (debtor.amount === 0n) continue;
    const match = creditors.find((c) => c.amount === debtor.amount);
    if (match) {
      transfers.push({ from: debtor.id, to: match.id, amountMinor: debtor.amount });
      debtor.amount = 0n;
      match.amount = 0n;
    }
  }

  creditors = creditors.filter((c) => c.amount > 0n);
  debtors = debtors.filter((d) => d.amount > 0n);

  // Pass 2: greedy — largest against largest, ties broken by id.
  const byAmountDesc = (a: { id: string; amount: bigint }, b: { id: string; amount: bigint }) =>
    a.amount !== b.amount ? (a.amount > b.amount ? -1 : 1) : cmpId(a.id, b.id);

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);

    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = creditor.amount < debtor.amount ? creditor.amount : debtor.amount;

    transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount === 0n) creditors.shift();
    if (debtor.amount === 0n) debtors.shift();
  }

  return transfers;
}

/** Net balances per person from a list of pairwise edges — the inverse of the above. */
export function netBalances(transfers: readonly Transfer[]): Balance[] {
  const net = new Map<string, bigint>();
  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0n) - t.amountMinor);
    net.set(t.to, (net.get(t.to) ?? 0n) + t.amountMinor);
  }
  return [...net.entries()]
    .filter(([, v]) => v !== 0n)
    .map(([profileId, netMinor]) => ({ profileId, netMinor }))
    .sort((a, b) => cmpId(a.profileId, b.profileId));
}

function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byKey(a: readonly [string, bigint], b: readonly [string, bigint]): number {
  return cmpId(a[0], b[0]);
}
