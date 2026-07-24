/**
 * Amount formatting, with our own digit grouping rather than `Intl.NumberFormat`.
 *
 * Why not Intl: Hermes' ICU support differs between iOS and Android and between builds, so
 * `toLocaleString('en-IN')` is not dependable on device. Lakh/crore grouping is a stated
 * design requirement — `hisaab-row.js` relies on it — so it gets an implementation we own
 * and test rather than one we hope is present at runtime.
 */

import { exponentOf, symbolOf, type Money } from './money.js';

export type GroupingStyle = 'indian' | 'western';

export interface FormatOptions {
  /** 'indian' → 1,24,80,000 · 'western' → 12,480,000. Defaults to 'indian'. */
  grouping?: GroupingStyle;
  /** 'auto' hides a zero fraction, 'always' keeps it, 'never' drops it. Defaults to 'auto'. */
  decimals?: 'auto' | 'always' | 'never';
  /** Prefix the currency symbol. Defaults to true. */
  symbol?: boolean;
  /** Render negatives as "-₹5" rather than dropping the sign. Defaults to true. */
  signed?: boolean;
}

/** Indian grouping: last three digits, then twos. 1234567 → 12,34,567 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** Western grouping: threes throughout. 1234567 → 1,234,567 */
function groupWestern(digits: string): string {
  const parts: string[] = [];
  let rest = digits;
  while (rest.length > 3) {
    parts.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  if (rest.length) parts.unshift(rest);
  return parts.join(',');
}

export function groupDigits(digits: string, style: GroupingStyle = 'indian'): string {
  return style === 'indian' ? groupIndian(digits) : groupWestern(digits);
}

export function formatAmount(amount: Money, options: FormatOptions = {}): string {
  const {
    grouping = 'indian',
    decimals = 'auto',
    symbol = true,
    signed = true,
  } = options;

  const exponent = exponentOf(amount.currency);
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;

  const divisor = 10n ** BigInt(exponent);
  const whole = exponent === 0 ? abs : abs / divisor;
  const fraction = exponent === 0 ? 0n : abs % divisor;

  let out = groupDigits(whole.toString(), grouping);

  const showFraction =
    exponent > 0 && (decimals === 'always' || (decimals === 'auto' && fraction !== 0n));
  if (showFraction) {
    out += '.' + fraction.toString().padStart(exponent, '0');
  }

  if (symbol) out = symbolOf(amount.currency) + out;
  if (negative && signed) out = '-' + out;
  return out;
}

/**
 * The caption under a balance chip. Direction is from the viewer's perspective: a positive
 * balance means the counterparty owes you.
 */
export function balanceCaption(amount: Money): 'settled' | 'you owe' | 'owes you' {
  if (amount.minor === 0n) return 'settled';
  return amount.minor < 0n ? 'you owe' : 'owes you';
}
