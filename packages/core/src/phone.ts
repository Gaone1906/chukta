/**
 * Phone numbers, normalised to E.164.
 *
 * This lives in `packages/core` rather than in the app because of what it decides: two people
 * converge on ONE identity when their numbers normalise to the same string, and stay two
 * separate ledgers when they do not. `profile_contact_points` has a unique index on
 * `(kind, value_norm)`, so this function is what that index actually compares. A normaliser
 * that is merely "mostly right" produces duplicate people who each hold half of a shared
 * history, and there is no un-merge in the schema to undo it with.
 *
 * ---------------------------------------------------------------- deliberately narrow
 *
 * This is NOT a general-purpose phone library, and it must not grow into one by accretion.
 * libphonenumber is 300kB+ and carries a metadata table that goes stale; the scope here is
 * "the numbers Hisaab's users actually type", which is India by default plus anything already
 * written in full international form.
 *
 * What it will NOT do, on purpose:
 *
 * - **Guess a country from a bare national number.** `9876543210` is Indian because the default
 *   region says so, not because the digits imply it. Change the region and the same digits mean
 *   someone else — which is precisely why the region is an explicit argument.
 * - **Validate that a number is in service, or that its operator exists.** It checks shape.
 * - **Accept extensions.** `+91 98765 43210 x22` is rejected rather than silently truncated to
 *   a different person's number.
 */

/** A region we know the dialling rules for. Add one only with tests for its length rules. */
export type PhoneRegion = 'IN';

export interface PhoneRules {
  /** Country calling code, no `+`. */
  cc: string;
  /** Exact length of a valid national (subscriber) number. */
  nationalLength: number;
  /** A national number must start with one of these — India has no 0–5 mobile/landline range. */
  leadingDigits: readonly string[];
  /** The trunk prefix people write before a national number when dialling domestically. */
  trunkPrefix: string;
}

export const PHONE_RULES: Record<PhoneRegion, PhoneRules> = {
  IN: { cc: '91', nationalLength: 10, leadingDigits: ['6', '7', '8', '9'], trunkPrefix: '0' },
};

/**
 * Normalise to E.164 (`+` followed by digits only), or return null if it is not a plausible
 * number for `region`.
 *
 * Returning null rather than throwing is the right shape for the caller: this runs on every
 * keystroke of a validated field, and an invalid-so-far number is the normal state of a field
 * someone is still typing, not an exceptional one.
 *
 * Accepts, all normalising to `+919876543210`:
 *
 *   9876543210 · 09876543210 · +91 98765 43210 · +91-98765-43210 · 0091 98765 43210 ·
 *   (+91) 98765 43210 · 919876543210
 */
export function normalisePhone(input: string, region: PhoneRegion = 'IN'): string | null {
  if (typeof input !== 'string') return null;

  const rules = PHONE_RULES[region];

  // A `+` is only meaningful as the very first character. Anywhere else it is a typo, and
  // stripping it silently would turn `98765+43210` into a valid-looking number nobody typed.
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith('+');
  const rest = hadPlus ? trimmed.slice(1) : trimmed;
  if (rest.includes('+')) return null;

  // Everything a person might use as a separator, and nothing else. A letter anywhere is a
  // rejection rather than something to strip — that is how extensions get caught.
  if (/[^0-9\s\-().]/.test(rest)) return null;

  let digits = rest.replace(/[^0-9]/g, '');
  if (digits === '') return null;

  // `00` is the international access prefix in most of the world. Only meaningful when the
  // number was NOT already written with a `+`; `+0091…` is malformed, not doubly-international.
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!hadPlus && digits.startsWith(rules.trunkPrefix) && digits.length === rules.nationalLength + rules.trunkPrefix.length) {
    // Domestic trunk form: 0 + 10 digits. Length-checked so a national number that merely
    // happens to start with 0 (there are none in India, but the check is cheap and general)
    // cannot be silently shortened.
    digits = digits.slice(rules.trunkPrefix.length);
  }

  // Now either a bare national number or a country code followed by one.
  let national: string;
  if (digits.length === rules.nationalLength) {
    national = digits;
  } else if (digits.startsWith(rules.cc) && digits.length === rules.cc.length + rules.nationalLength) {
    national = digits.slice(rules.cc.length);
  } else {
    return null;
  }

  if (!rules.leadingDigits.includes(national[0]!)) return null;

  return `+${rules.cc}${national}`;
}

/** Whether `input` normalises at all. Convenience for a form's `validate`. */
export function isValidPhone(input: string, region: PhoneRegion = 'IN'): boolean {
  return normalisePhone(input, region) !== null;
}

/**
 * `+919876543210` → `+91 98765 43210`, for display only.
 *
 * **Never store or compare this.** The canonical value is what `normalisePhone` returns; this
 * exists so a settings row does not show an undifferentiated run of twelve digits.
 */
export function formatPhone(e164: string, region: PhoneRegion = 'IN'): string {
  const rules = PHONE_RULES[region];
  const prefix = `+${rules.cc}`;
  if (!e164.startsWith(prefix)) return e164;

  const national = e164.slice(prefix.length);
  if (national.length !== rules.nationalLength) return e164;

  return `${prefix} ${national.slice(0, 5)} ${national.slice(5)}`;
}
