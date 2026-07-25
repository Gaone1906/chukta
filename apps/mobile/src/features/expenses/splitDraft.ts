import {
  computeShares,
  parseAmount,
  SplitError,
  type LineItem,
  type SplitInput,
  type SplitType,
} from '@hisaab/core';

/**
 * The editable shape of a split, and its reduction to the pure `SplitInput` that
 * `@hisaab/core` — and therefore the server — understands.
 *
 * Everything the user types stays as TEXT here. "50." and "" are both legitimate mid-typing
 * states, and coercing them to numbers on every keystroke either fights the keyboard or
 * silently invents a zero. Parsing happens exactly once, in `toSplitInput`.
 *
 * Every split type keeps its own map, so switching tabs to look at another one and switching
 * back does not wipe what was already entered.
 */

export interface DraftItem {
  id: string;
  description: string;
  /** Text, parsed at the edge. */
  amount: string;
  participants: string[];
  kind: 'line' | 'tax' | 'tip' | 'discount';
}

export interface SplitState {
  type: SplitType;
  /** Who the expense is split between. Everyone in this list is a participant. */
  included: string[];
  exact: Record<string, string>;
  percentage: Record<string, string>;
  shares: Record<string, string>;
  items: DraftItem[];
}

export function emptySplitState(participantIds: string[]): SplitState {
  return {
    type: 'equal',
    included: [...participantIds],
    exact: {},
    percentage: {},
    shares: {},
    items: [],
  };
}

export interface SplitResult {
  shares: Map<string, bigint> | null;
  /** User-facing, and phrased as what to do about it rather than what went wrong. */
  error: string | null;
}

/**
 * Reduce the draft to exact per-person minor units, or explain why it cannot be.
 *
 * Errors are returned rather than thrown: an incomplete split is the normal state of this
 * screen for as long as someone is typing, not an exceptional one.
 */
export function computeDraftShares(totalMinor: bigint, state: SplitState): SplitResult {
  if (totalMinor <= 0n) return { shares: null, error: null };
  if (state.included.length === 0) {
    return { shares: null, error: 'Pick at least one person to split this between.' };
  }

  let input: SplitInput;

  switch (state.type) {
    case 'equal':
      input = { type: 'equal', participants: state.included };
      break;

    case 'exact': {
      const amounts = new Map<string, bigint>();
      let sum = 0n;
      for (const id of state.included) {
        const parsed = parseAmount(state.exact[id] ?? '', 'INR');
        if (parsed === null || parsed < 0n) {
          return { shares: null, error: 'Every person needs an amount.' };
        }
        amounts.set(id, parsed);
        sum += parsed;
      }
      if (sum !== totalMinor) {
        const off = totalMinor - sum;
        return {
          shares: null,
          error:
            off > 0n
              ? `${rupees(off)} left to assign.`
              : `${rupees(-off)} more than the total.`,
        };
      }
      input = { type: 'exact', amounts };
      break;
    }

    case 'percentage': {
      const percentages = new Map<string, number>();
      let sum = 0;
      for (const id of state.included) {
        const raw = (state.percentage[id] ?? '').trim();
        const value = raw === '' ? NaN : Number(raw);
        if (!Number.isFinite(value) || value < 0) {
          return { shares: null, error: 'Every person needs a percentage.' };
        }
        percentages.set(id, value);
        sum += value;
      }
      // Compared with a tolerance because these are decimal percentages typed by hand;
      // computeShares does the exact check once the values are scaled to integers.
      if (Math.abs(sum - 100) > 1e-6) {
        return {
          shares: null,
          error:
            sum < 100
              ? `${trim(100 - sum)}% still to allocate.`
              : `${trim(sum - 100)}% over 100.`,
        };
      }
      input = { type: 'percentage', percentages };
      break;
    }

    case 'shares': {
      const shares = new Map<string, number>();
      for (const id of state.included) {
        const raw = (state.shares[id] ?? '').trim();
        const value = raw === '' ? 1 : Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          return { shares: null, error: 'Shares must be whole numbers, at least 1 each.' };
        }
        shares.set(id, value);
      }
      input = { type: 'shares', shares };
      break;
    }

    case 'itemized': {
      const items: LineItem[] = [];
      for (const item of state.items) {
        const parsed = parseAmount(item.amount, 'INR');
        if (parsed === null || parsed < 0n) {
          return { shares: null, error: 'Every line needs an amount.' };
        }
        if (parsed === 0n) continue;
        if (item.kind === 'line' && item.participants.length === 0) {
          return {
            shares: null,
            error: `"${item.description || 'A line'}" has nobody sharing it.`,
          };
        }
        items.push({
          id: item.id,
          amountMinor: parsed,
          kind: item.kind,
          participants: item.kind === 'line' ? item.participants : undefined,
        });
      }
      if (items.length === 0) {
        return { shares: null, error: 'Add at least one line.' };
      }
      input = { type: 'itemized', items, participants: state.included };
      break;
    }
  }

  try {
    return { shares: computeShares(totalMinor, input), error: null };
  } catch (e) {
    // A SplitError here is a real reconciliation failure the checks above did not catch —
    // itemised totals, mostly. Anything else is a bug and should not be dressed up as advice.
    if (e instanceof SplitError) return { shares: null, error: e.message };
    throw e;
  }
}

/** The weight to record alongside each split row, so an edit can reconstruct the input. */
export function weightFor(state: SplitState, profileId: string): number | null {
  switch (state.type) {
    case 'percentage': {
      const value = Number((state.percentage[profileId] ?? '').trim());
      return Number.isFinite(value) ? value : null;
    }
    case 'shares': {
      const raw = (state.shares[profileId] ?? '').trim();
      return raw === '' ? 1 : Number(raw);
    }
    default:
      return null;
  }
}

const rupees = (minor: bigint): string => {
  const whole = minor / 100n;
  const paise = minor % 100n;
  return paise === 0n ? `₹${whole}` : `₹${whole}.${paise.toString().padStart(2, '0')}`;
};

const trim = (value: number): string => String(Math.round(value * 1e6) / 1e6);
