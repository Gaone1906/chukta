/**
 * Money is always an integer count of minor units plus a currency code. Never a float, and
 * never a plain `number` for amounts — JS numbers lose precision above 2^53 and, worse,
 * invite `0.1 + 0.2` arithmetic into a ledger.
 *
 * The exponent (how many minor units make one major unit) is looked up here for display, but
 * the database snapshots it onto each expense row: a correction to this table must never
 * retroactively move the decimal point on historical data.
 */

export type CurrencyCode = string;

export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

/** Currencies whose exponent is not the usual 2. Everything else defaults to 2. */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  BHD: 3, BIF: 0, CLP: 0, DJF: 0, GNF: 0, IQD: 3, ISK: 0, JOD: 3, JPY: 0,
  KMF: 0, KRW: 0, KWD: 3, LYD: 3, OMR: 3, PYG: 0, RWF: 0, TND: 3, UGX: 0,
  UYW: 4, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

const SYMBOLS: Readonly<Record<string, string>> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', AED: 'د.إ', LKR: 'Rs', NPR: 'Rs', PKR: 'Rs', BDT: '৳',
};

export function exponentOf(currency: CurrencyCode): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

/**
 * A symbol where we have one ("₹12,480"), otherwise the code followed by a NON-BREAKING space
 * ("KWD\u00A01,500.005"). The nbsp is deliberate: a currency code must never wrap onto a
 * different line from the amount it qualifies.
 */
export function symbolOf(currency: CurrencyCode): string {
  const code = currency.toUpperCase();
  return SYMBOLS[code] ?? code + "\u00A0";
}

export function money(minor: bigint | number, currency: CurrencyCode): Money {
  return { minor: typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor)), currency };
}

export const isZero = (m: Money): boolean => m.minor === 0n;
export const isNegative = (m: Money): boolean => m.minor < 0n;
export const absolute = (m: Money): Money => ({ ...m, minor: m.minor < 0n ? -m.minor : m.minor });

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    // Balances are always tracked per (counterparty, currency); silently mixing them is how
    // "my balance changed and nobody added an expense" bugs happen.
    throw new Error(`Cannot combine ${a.currency} with ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n;
  for (const m of items) {
    if (m.currency !== currency) throw new Error(`Cannot sum ${m.currency} into ${currency}`);
    total += m.minor;
  }
  return { minor: total, currency };
}
