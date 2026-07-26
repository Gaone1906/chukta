/**
 * The UPI payment URI, per NPCI's UPI Intent and Deep Link specification.
 *
 * Pure string construction, deliberately kept out of the app: this is the one place a wrong
 * character means a payment goes to the wrong person or for the wrong amount, so it is
 * property-tested rather than eyeballed on a device.
 *
 *   upi://pay?pa=<vpa>&pn=<payee name>&am=<1420.00>&cu=INR&tn=<note>&tr=<ref>
 *
 * `pa` is the COUNTERPARTY's VPA — you are paying them — which is why profile setup collects
 * a UPI ID at all. Nothing here initiates or verifies a payment; it hands the details to the
 * user's own UPI app and the settlement stays self-reported.
 */

import { exponentOf, type CurrencyCode } from './money';

/** What a VPA is allowed to look like. Mirrors the CHECK on `profiles.upi_vpa` exactly. */
export const VPA_PATTERN = /^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_PATTERN.test(vpa.trim());
}

/**
 * Several UPI apps silently truncate the note, and at least one rejects the whole intent when
 * it is too long. 50 is the length everyone agrees on.
 */
export const MAX_NOTE_LENGTH = 50;

export interface UpiPaymentRequest {
  /** Payee VPA — the person being paid. */
  vpa: string;
  /** Payee name, shown in the UPI app for confirmation. */
  name: string;
  /** Minor units. Converted to the plain decimal string the spec requires. */
  amountMinor: bigint;
  currency?: CurrencyCode;
  /** Transaction note. Truncated to MAX_NOTE_LENGTH. */
  note?: string;
  /**
   * Transaction reference. Ours is the settlement's client mutation id, so a payment can be
   * traced back to the row that recorded it.
   */
  ref?: string;
}

export class UpiError extends Error {}

/**
 * `am` must be a plain decimal string with the currency's own number of places — "1420.00",
 * never "1,420" and never "1420.0". Built from the bigint rather than from a float, for the
 * same reason as everything else that touches money here.
 */
export function formatUpiAmount(amountMinor: bigint, currency: CurrencyCode = 'INR'): string {
  if (amountMinor <= 0n) throw new UpiError('a UPI amount must be positive');

  const exponent = exponentOf(currency);
  if (exponent === 0) return amountMinor.toString();

  const divisor = 10n ** BigInt(exponent);
  const whole = amountMinor / divisor;
  const fraction = amountMinor % divisor;
  return `${whole}.${fraction.toString().padStart(exponent, '0')}`;
}

/**
 * Percent-encode a query parameter value.
 *
 * `encodeURIComponent` leaves `!'()*` alone, and those have been observed to confuse at least
 * one bank app's parser. Encoding them costs nothing and removes a class of "works on GPay,
 * fails on the bank app" bug that is miserable to reproduce.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildUpiUri(request: UpiPaymentRequest): string {
  const vpa = request.vpa.trim();
  if (!isValidVpa(vpa)) throw new UpiError(`"${vpa}" is not a valid UPI ID`);

  const name = request.name.trim();
  if (name === '') throw new UpiError('a UPI request needs a payee name');

  const currency = request.currency ?? 'INR';

  // Order follows the spec's examples. Some apps parse positionally rather than by key, which
  // is not something the spec permits but is something that happens.
  const params: [string, string][] = [
    ['pa', vpa],
    ['pn', name],
    ['am', formatUpiAmount(request.amountMinor, currency)],
    ['cu', currency],
  ];

  const note = request.note?.trim();
  if (note) params.push(['tn', note.slice(0, MAX_NOTE_LENGTH)]);

  const ref = request.ref?.trim();
  // `tr` is alphanumeric-only in practice; a uuid's hyphens are stripped rather than encoded,
  // because some apps reject the transaction ref outright rather than ignoring it.
  if (ref) params.push(['tr', ref.replace(/[^a-zA-Z0-9]/g, '').slice(0, 35)]);

  return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeParam(v)}`).join('&');
}

/** Parse a upi://pay URI back into its parameters. Used by the tests and the QR round-trip. */
export function parseUpiUri(uri: string): Record<string, string> {
  const match = /^upi:\/\/pay\?(.*)$/.exec(uri);
  if (!match) throw new UpiError('not a upi://pay URI');

  const out: Record<string, string> = {};
  for (const pair of match[1]!.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    out[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return out;
}

/**
 * The note we put on a settlement, kept short enough to survive every app's truncation.
 *
 * Deliberately does not include the amount — it is already the `am` parameter, and repeating
 * it in free text is how a note ends up disagreeing with the payment after an edit.
 */
export function settlementNote(payerName: string, groupName?: string | null): string {
  const base = groupName ? `Chukta · ${groupName}` : 'Chukta settle up';
  const withWho = `${base} · ${payerName}`;
  return (withWho.length <= MAX_NOTE_LENGTH ? withWho : base).slice(0, MAX_NOTE_LENGTH);
}
