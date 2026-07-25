/**
 * The five split types from the design doc, all reduced to one allocator call.
 *
 * They differ only in how the weight vector is built. Whatever the user picked, the result is
 * always a flat map of participant → minor units that sums exactly to the expense total —
 * nothing downstream (balances, debts, settlement) ever needs to know which type was used.
 */

import { allocate } from './allocate';
import { pow10 } from './bigintMath';

export type SplitType = 'equal' | 'exact' | 'percentage' | 'shares' | 'itemized';

/** Percentages and shares are accepted as decimals and scaled to exact integers internally. */
const PERCENT_SCALE_DP = 6;
const PERCENT_SCALE = pow10(PERCENT_SCALE_DP);
const HUNDRED_SCALED = 100n * PERCENT_SCALE;

export interface EqualSplit {
  type: 'equal';
  participants: readonly string[];
}

export interface SharesSplit {
  type: 'shares';
  /** Whole share counts, e.g. { alice: 2, bob: 1 } — Alice pays twice as much. */
  shares: ReadonlyMap<string, number>;
}

export interface PercentageSplit {
  type: 'percentage';
  /** Must sum to exactly 100. Up to six decimal places are honoured. */
  percentages: ReadonlyMap<string, number>;
}

export interface ExactSplit {
  type: 'exact';
  /** Minor units per participant. Must sum to the expense total. */
  amounts: ReadonlyMap<string, bigint>;
}

export interface LineItem {
  id: string;
  /** Minor units. Positive for lines/tax/tip; positive for discounts too (it is subtracted). */
  amountMinor: bigint;
  /** Who shares this line. Ignored for tax/tip/discount, which spread across everyone. */
  participants?: readonly string[];
  kind?: 'line' | 'tax' | 'tip' | 'discount';
}

export interface ItemizedSplit {
  type: 'itemized';
  items: readonly LineItem[];
  /** Everyone on the expense, so tax and tip can be spread even over non-line participants. */
  participants: readonly string[];
}

export type SplitInput = EqualSplit | SharesSplit | PercentageSplit | ExactSplit | ItemizedSplit;

export class SplitError extends Error {}

function sortedKeys(keys: Iterable<string>): string[] {
  return [...keys].sort();
}

/** Scale a decimal to an exact integer, rejecting anything beyond the supported precision. */
function scaleDecimal(value: number, label: string): bigint {
  if (!Number.isFinite(value)) throw new SplitError(`${label} must be a finite number`);
  if (value < 0) throw new SplitError(`${label} must not be negative`);
  const scaled = Math.round(value * Number(PERCENT_SCALE));
  if (Math.abs(value * Number(PERCENT_SCALE) - scaled) > 1e-6) {
    throw new SplitError(`${label} has more than ${PERCENT_SCALE_DP} decimal places`);
  }
  return BigInt(scaled);
}

/**
 * Reduce any split type to exact per-participant minor units.
 *
 * Throws rather than silently normalising: percentages that don't reach 100, exact amounts
 * that don't reach the total, and itemised lines that don't reconcile are all user-visible
 * mistakes the form must surface, not something to paper over here.
 */
export function computeShares(total: bigint, split: SplitInput): Map<string, bigint> {
  switch (split.type) {
    case 'equal': {
      const keys = sortedKeys(split.participants);
      if (keys.length === 0) throw new SplitError('equal split needs at least one participant');
      return toMap(keys, allocate({ total, weights: keys.map(() => 1n), keys }));
    }

    case 'shares': {
      const keys = sortedKeys(split.shares.keys());
      if (keys.length === 0) throw new SplitError('shares split needs at least one participant');
      const weights = keys.map((k) => {
        const raw = split.shares.get(k)!;
        if (!Number.isInteger(raw) || raw <= 0) {
          throw new SplitError(`share for ${k} must be a positive whole number`);
        }
        return BigInt(raw);
      });
      return toMap(keys, allocate({ total, weights, keys }));
    }

    case 'percentage': {
      const keys = sortedKeys(split.percentages.keys());
      if (keys.length === 0) throw new SplitError('percentage split needs at least one participant');
      const weights = keys.map((k) => scaleDecimal(split.percentages.get(k)!, `percentage for ${k}`));
      const sum = weights.reduce((a, b) => a + b, 0n);
      if (sum !== HUNDRED_SCALED) {
        throw new SplitError(`percentages must sum to exactly 100, got ${Number(sum) / Number(PERCENT_SCALE)}`);
      }
      // Allocate from the weights rather than computing each share from its own percentage —
      // the latter is the same independent-rounding bug in a different costume.
      return toMap(keys, allocate({ total, weights, keys }));
    }

    case 'exact': {
      const keys = sortedKeys(split.amounts.keys());
      if (keys.length === 0) throw new SplitError('exact split needs at least one participant');
      const out = new Map<string, bigint>();
      let sum = 0n;
      for (const k of keys) {
        const amount = split.amounts.get(k)!;
        out.set(k, amount);
        sum += amount;
      }
      if (sum !== total) {
        throw new SplitError(`exact amounts sum to ${sum} but the total is ${total}`);
      }
      return out;
    }

    case 'itemized':
      return computeItemizedShares(total, split);
  }
}

/**
 * Itemised is a two-stage flatten:
 *   1. each line is allocated equally among the people who shared it
 *   2. tax, tip and discount are allocated across everyone in proportion to their pre-tax
 *      subtotal — so the person who ordered the lobster carries more of the service charge
 *   3. the two are summed per person
 *
 * A rounding pass runs at the end because stages 1 and 2 each round independently; without it
 * the per-person totals can miss the expense total by a unit or two.
 */
function computeItemizedShares(total: bigint, split: ItemizedSplit): Map<string, bigint> {
  const everyone = sortedKeys(split.participants);
  if (everyone.length === 0) throw new SplitError('itemized split needs at least one participant');

  const subtotals = new Map<string, bigint>(everyone.map((k) => [k, 0n]));
  let lineTotal = 0n;
  let adjustmentTotal = 0n;

  for (const item of split.items) {
    const kind = item.kind ?? 'line';
    if (item.amountMinor < 0n) {
      throw new SplitError(`item ${item.id} must not be negative; use kind 'discount' instead`);
    }

    if (kind === 'line') {
      const members = sortedKeys(item.participants ?? everyone);
      if (members.length === 0) throw new SplitError(`item ${item.id} has no participants`);
      const shares = allocate({ total: item.amountMinor, weights: members.map(() => 1n), keys: members });
      members.forEach((k, i) => {
        if (!subtotals.has(k)) throw new SplitError(`item ${item.id} names ${k}, who is not on the expense`);
        subtotals.set(k, subtotals.get(k)! + shares[i]!);
      });
      lineTotal += item.amountMinor;
    } else {
      adjustmentTotal += kind === 'discount' ? -item.amountMinor : item.amountMinor;
    }
  }

  if (lineTotal + adjustmentTotal !== total) {
    throw new SplitError(
      `itemized lines (${lineTotal}) plus adjustments (${adjustmentTotal}) come to ` +
        `${lineTotal + adjustmentTotal}, but the total is ${total}`,
    );
  }

  const out = new Map(subtotals);

  if (adjustmentTotal !== 0n) {
    // Weight by pre-tax subtotal. If every subtotal is zero (all lines were free), fall back
    // to an even spread rather than throwing.
    const weights = everyone.map((k) => subtotals.get(k)!);
    const anyWeight = weights.some((w) => w > 0n);
    const spread = allocate({
      total: adjustmentTotal,
      weights: anyWeight ? weights : everyone.map(() => 1n),
      keys: everyone,
    });
    everyone.forEach((k, i) => out.set(k, out.get(k)! + spread[i]!));
  }

  return out;
}

function toMap(keys: readonly string[], amounts: readonly bigint[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  keys.forEach((k, i) => out.set(k, amounts[i]!));
  return out;
}

/** Sum a share map — handy in assertions and tests. */
export function sumShares(shares: ReadonlyMap<string, bigint>): bigint {
  let total = 0n;
  for (const value of shares.values()) total += value;
  return total;
}
