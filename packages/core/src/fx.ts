/**
 * Currency conversion for expenses entered in a currency other than the group's default.
 *
 * The rule that matters: convert ONCE, at the total level, then allocate independently in each
 * currency. Converting each person's share individually reintroduces the sum≠total bug in the
 * base currency — which is the currency balances are actually computed in, so it would be the
 * worst possible place for it.
 */

import { allocate } from './allocate';
import { pow10, roundHalfEven } from './bigintMath';
import { exponentOf, type CurrencyCode, type Money } from './money';

/** Rates are stored as numeric(20,10) server-side; ten decimal places is the contract. */
export const RATE_DP = 10;
export const RATE_SCALE = pow10(RATE_DP);

export class FxError extends Error {}

/**
 * Parse a rate into an exact scaled integer.
 *
 * Accepts a string (preferred — what comes out of Postgres) or a number. Strings are parsed
 * digit by digit rather than through `Number`, so a rate like "83.1234567891" keeps every
 * place instead of being rounded to float precision on the way in.
 */
export function parseRate(rate: string | number): bigint {
  const text = typeof rate === 'number' ? String(rate) : rate.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new FxError(`invalid FX rate: ${rate}`);

  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > RATE_DP) {
    throw new FxError(`FX rate has more than ${RATE_DP} decimal places: ${rate}`);
  }

  const scaled = BigInt(whole!) * RATE_SCALE + BigInt((fraction + '0'.repeat(RATE_DP)).slice(0, RATE_DP));
  if (scaled <= 0n) throw new FxError('FX rate must be greater than zero');
  return scaled;
}

/**
 * Convert an amount from one currency to another at an exact rate.
 *
 * Handles the exponent change too — ¥1000 (exponent 0) into ₹ (exponent 2) is not just a
 * multiply. Rounds half to even, once, on the total.
 */
export function convertMinor(
  minor: bigint,
  from: CurrencyCode,
  to: CurrencyCode,
  rateScaled: bigint,
): bigint {
  const fromExp = exponentOf(from);
  const toExp = exponentOf(to);
  const shift = toExp - fromExp;

  let numerator = minor * rateScaled;
  let denominator = RATE_SCALE;

  if (shift > 0) numerator *= pow10(shift);
  else if (shift < 0) denominator *= pow10(-shift);

  return roundHalfEven(numerator, denominator);
}

export function convert(amount: Money, to: CurrencyCode, rate: string | number): Money {
  if (amount.currency === to) return amount;
  return { minor: convertMinor(amount.minor, amount.currency, to, parseRate(rate)), currency: to };
}

export interface DualCurrencyShares {
  /** Per-participant shares in the currency the expense was entered in. */
  shares: Map<string, bigint>;
  /** The same split expressed in the group's base currency. */
  baseShares: Map<string, bigint>;
  /** The converted total, for storing alongside the expense. */
  baseTotal: bigint;
}

/**
 * Allocate a split in both the expense currency and the base currency.
 *
 * Both allocations use the SAME weights and the SAME tiebreak order, so each vector sums
 * exactly to its own total *and* the person who gets the spare paisa gets the spare cent too —
 * which keeps the two views of one expense consistent with each other.
 */
export function allocateDualCurrency(params: {
  total: bigint;
  currency: CurrencyCode;
  baseCurrency: CurrencyCode;
  rate: string | number;
  weights: readonly bigint[];
  keys: readonly string[];
}): DualCurrencyShares {
  const { total, currency, baseCurrency, rate, weights, keys } = params;

  const rateScaled = currency === baseCurrency ? RATE_SCALE : parseRate(rate);
  const baseTotal =
    currency === baseCurrency ? total : convertMinor(total, currency, baseCurrency, rateScaled);

  const shares = allocate({ total, weights, keys });
  const baseShares = allocate({ total: baseTotal, weights, keys });

  return {
    shares: new Map(keys.map((k, i) => [k, shares[i]!])),
    baseShares: new Map(keys.map((k, i) => [k, baseShares[i]!])),
    baseTotal,
  };
}

/**
 * Whether a client-proposed rate is close enough to the server's to be honoured.
 *
 * The client shows a live conversion while the user types, and must keep working offline — so
 * it proposes the rate it displayed. Accepting it within a tolerance keeps the receipt honest;
 * the bound caps any abuse at noise level. Mirrors the server-side check.
 */
export function isRateAcceptable(
  proposed: string | number,
  serverRate: string | number,
  tolerance = 0.02,
): boolean {
  const p = parseRate(proposed);
  const s = parseRate(serverRate);
  const diff = p > s ? p - s : s - p;
  // diff / s <= tolerance, done in integers.
  const toleranceScaled = BigInt(Math.round(tolerance * 1e6));
  return diff * 1_000_000n <= s * toleranceScaled;
}
