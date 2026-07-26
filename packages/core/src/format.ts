/**
 * Amount formatting, with our own digit grouping rather than `Intl.NumberFormat`.
 *
 * Why not Intl: Hermes' ICU support differs between iOS and Android and between builds, so
 * `toLocaleString('en-IN')` is not dependable on device. Lakh/crore grouping is a stated
 * design requirement — `hisaab-row.js` relies on it — so it gets an implementation we own
 * and test rather than one we hope is present at runtime.
 */

import { exponentOf, symbolOf, type CurrencyCode, type Money } from './money';

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
 * Parse what a user typed into exact minor units.
 *
 * Deliberately NOT `Math.round(parseFloat(text) * 100)`: 19.99 is not representable in binary
 * floating point and that expression is one of the classic ways a finance app loses a paisa.
 * The decimal string is split on the point and the two halves are converted as integers, so
 * nothing ever becomes a float.
 *
 * Returns null for anything unparseable, so a form can show a field error instead of guessing.
 * Grouping separators and the currency symbol are tolerated — people paste "₹1,24,000".
 */
export function parseAmount(text: string, currency: CurrencyCode): bigint | null {
  const exponent = exponentOf(currency);
  const cleaned = text.replace(/[,\s ]/g, '').replace(/^[^\d.-]+/, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, wholeText = '', fractionText = ''] = match;
  if (fractionText.length > exponent) return null;

  const whole = BigInt(wholeText === '' ? '0' : wholeText);
  const fraction = BigInt(fractionText.padEnd(exponent, '0') || '0');
  const magnitude = whole * 10n ** BigInt(exponent) + fraction;
  return sign === '-' ? -magnitude : magnitude;
}

/** Minor units back into a plain editable string — "125000" → "1250" (no symbol, no grouping). */
export function toAmountInput(minor: bigint, currency: CurrencyCode): string {
  if (minor === 0n) return '';
  const exponent = exponentOf(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = 10n ** BigInt(exponent);
  const whole = abs / divisor;
  const fraction = abs % divisor;
  const body =
    fraction === 0n
      ? whole.toString()
      : `${whole}.${fraction.toString().padStart(exponent, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * The caption under a balance chip. Direction is from the viewer's perspective: a positive
 * balance means the counterparty owes you.
 */
export function balanceCaption(amount: Money): 'settled' | 'you owe' | 'owes you' {
  if (amount.minor === 0n) return 'settled';
  return amount.minor < 0n ? 'you owe' : 'owes you';
}

/**
 * The same amount, worded for a screen reader.
 *
 * `formatAmount` returns "₹1,22,000.50", and what a screen reader does with that is not ours to
 * control: the ₹ glyph, the lakh grouping and the bare decimal point are each read differently
 * across VoiceOver, TalkBack and their language settings. On the screen where somebody is
 * deciding who owes what, "one twenty-two thousand point five" is not good enough.
 *
 * So the units are spelled out and the fraction is named rather than punctuated. Grouping is
 * kept — "1,22,000" gives a reader the natural pauses that make a long number followable — but
 * everything else is words.
 *
 * Deliberately NOT localised beyond English: v1 is INR-only by CHECK constraint, and inventing
 * a translation layer for one currency would be scaffolding around a decision already made.
 */
export function spokenAmount(amount: Money): string {
  const exponent = exponentOf(amount.currency);
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;

  const divisor = 10n ** BigInt(exponent);
  const whole = exponent === 0 ? abs : abs / divisor;
  const fraction = exponent === 0 ? 0n : abs % divisor;

  const major = amount.currency === 'INR' ? ['rupee', 'rupees'] : ['unit', 'units'];
  const minor = amount.currency === 'INR' ? ['paisa', 'paise'] : ['cent', 'cents'];
  const plural = (n: bigint, words: string[]) => (n === 1n ? words[0]! : words[1]!);

  const parts: string[] = [];

  // "0 rupees 50 paise" rather than "50 paise" alone: dropping the zero major unit reads as a
  // different magnitude when the amount is spoken in a list of larger ones. Always present,
  // therefore — the first version of this had a condition that did the opposite of what this
  // comment promised, and the test caught it.
  parts.push(`${groupDigits(whole.toString(), 'indian')} ${plural(whole, major)}`);
  if (fraction !== 0n) {
    parts.push(`${fraction.toString()} ${plural(fraction, minor)}`);
  }

  return (negative ? 'minus ' : '') + parts.join(' ');
}
