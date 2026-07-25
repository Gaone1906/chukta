/**
 * Integer maths with the rounding behaviour money needs.
 *
 * BigInt division in JavaScript truncates *toward zero*, which is wrong for both of the things
 * this package does with it. These helpers exist so no call site has to remember that.
 */

export function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function sign(value: bigint): bigint {
  return value < 0n ? -1n : value > 0n ? 1n : 0n;
}

/**
 * Floor division — rounds toward negative infinity, unlike the built-in `/`.
 *
 * The allocator depends on this: with truncation, a negative total (a refund, a correction)
 * would produce floors whose sum *exceeds* the total, making the remainder negative and the
 * distribution loop silently wrong.
 */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('floorDiv: division by zero');
  const q = numerator / denominator;
  // Truncation and flooring differ only when the result is negative and inexact.
  const inexact = q * denominator !== numerator;
  const negative = numerator < 0n !== denominator < 0n;
  return inexact && negative ? q - 1n : q;
}

/** The remainder that pairs with `floorDiv`; always has the sign of the denominator. */
export function floorMod(numerator: bigint, denominator: bigint): bigint {
  return numerator - floorDiv(numerator, denominator) * denominator;
}

/**
 * Round half to even ("banker's rounding") on an exact rational.
 *
 * Used for the single top-level FX conversion. Half-up would bias every currency conversion in
 * the same direction; over many expenses that drift is systematic rather than noise.
 */
export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('roundHalfEven: division by zero');

  // Normalise so the denominator is positive; the sign rides with the numerator.
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const negative = n < 0n;
  const magnitude = negative ? -n : n;

  const quotient = magnitude / d;
  const remainder = magnitude % d;
  const twice = remainder * 2n;

  let rounded: bigint;
  if (twice > d) {
    rounded = quotient + 1n;
  } else if (twice < d) {
    rounded = quotient;
  } else {
    // Exactly half: go to the even neighbour.
    rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
  }

  return negative ? -rounded : rounded;
}

/** 10^exponent as a bigint. */
export function pow10(exponent: number): bigint {
  if (exponent < 0 || !Number.isInteger(exponent)) {
    throw new Error(`pow10: exponent must be a non-negative integer, got ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}
