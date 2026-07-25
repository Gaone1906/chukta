/**
 * The allocator: divide an exact integer total across weighted participants so the parts sum
 * to the total exactly, always.
 *
 * This is the single most important function in the codebase. Every split type, both
 * currencies of every expense, and every pairwise debt goes through it.
 *
 * The bug it exists to prevent is in the design prototype itself —
 * `design-reference/screens/Hisaab Expense Form.dc.html:214` rounds each share independently:
 *
 *     Math.round(amount * w[i] / total)
 *
 * A ₹100 three-way split becomes ₹33 + ₹33 + ₹33 and a rupee vanishes. Rounding each share on
 * its own *cannot* be made to sum correctly; the shares have to be decided jointly.
 */

import { floorDiv } from './bigintMath';

export interface AllocationInput {
  /** Exact amount to distribute, in minor units. May be negative (refunds, corrections). */
  total: bigint;
  /** Relative weights, one per participant. Must be non-negative and not all zero. */
  weights: readonly bigint[];
  /**
   * Stable identifiers, one per participant. Used only to break ties, which is what makes the
   * result reproducible — the client's offline preview, a retried outbox write and the
   * server's plpgsql implementation must all produce identical numbers.
   */
  keys: readonly string[];
}

/**
 * Largest-remainder (Hamilton) allocation.
 *
 *   1. exact_i  = total × weight_i / W          (kept as an exact rational, never a float)
 *   2. base_i   = floor(exact_i)
 *   3. R        = total − Σ base_i              (0 ≤ R < participant count)
 *   4. order by fractional remainder desc, then weight desc, then key asc
 *   5. give one extra minor unit to the first R participants
 *
 * Step 4's final key tiebreak is the whole reason this is deterministic. Without it, two
 * participants with identical weights would be ordered by array position, and the "same"
 * expense entered from two devices could allocate the leftover paisa differently.
 */
export function allocate({ total, weights, keys }: AllocationInput): bigint[] {
  const n = weights.length;

  if (n === 0) throw new Error('allocate: no participants');
  if (keys.length !== n) {
    throw new Error(`allocate: ${n} weights but ${keys.length} keys`);
  }

  let W = 0n;
  for (const w of weights) {
    if (w < 0n) throw new Error('allocate: weights must be non-negative');
    W += w;
  }
  if (W === 0n) throw new Error('allocate: weights sum to zero');

  const base: bigint[] = new Array(n);
  // Numerator of the fractional part, over the common denominator W — so remainders are
  // compared exactly, with no floating point anywhere in the ordering.
  const remainder: bigint[] = new Array(n);

  let distributed = 0n;
  for (let i = 0; i < n; i++) {
    const numerator = total * weights[i]!;
    const q = floorDiv(numerator, W);
    base[i] = q;
    remainder[i] = numerator - q * W;
    distributed += q;
  }

  // floorDiv guarantees Σ base ≤ total, so this is in [0, n).
  let leftover = total - distributed;

  if (leftover > 0n) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      if (remainder[a]! !== remainder[b]!) return remainder[a]! > remainder[b]! ? -1 : 1;
      if (weights[a]! !== weights[b]!) return weights[a]! > weights[b]! ? -1 : 1;
      return keys[a]! < keys[b]! ? -1 : keys[a]! > keys[b]! ? 1 : 0;
    });

    for (const index of order) {
      if (leftover === 0n) break;
      base[index] = base[index]! + 1n;
      leftover -= 1n;
    }
  }

  return base;
}

/** Convenience wrapper returning a map keyed by participant. */
export function allocateByKey(input: AllocationInput): Map<string, bigint> {
  const amounts = allocate(input);
  const out = new Map<string, bigint>();
  input.keys.forEach((key, i) => out.set(key, amounts[i]!));
  return out;
}
