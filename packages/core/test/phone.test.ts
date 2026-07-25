import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatPhone, isValidPhone, normalisePhone } from '../src/phone';

const CANON = '+919876543210';

describe('normalisePhone', () => {
  it('accepts every shape a person actually types, and lands them all on one string', () => {
    // This list IS the specification. Each of these is a real way someone writes their own
    // number, and every one of them has to reach the same identity or the same person ends up
    // as two profiles with half a ledger each.
    for (const written of [
      '9876543210',
      '09876543210',
      '919876543210',
      '+919876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      '+91 (98765) 43210',
      '0091 98765 43210',
      '  +91 98765 43210  ',
      '98765 43210',
      '98765-43210',
    ]) {
      expect(normalisePhone(written), written).toBe(CANON);
    }
  });

  it('rejects lengths that are not exactly a national or CC+national number', () => {
    expect(normalisePhone('987654321')).toBeNull(); // 9 digits
    expect(normalisePhone('98765432101')).toBeNull(); // 11
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('   ')).toBeNull();
  });

  /*
   * A real ambiguity, resolved deliberately: `9198765432` is ten digits that happen to begin
   * with the country code. Length wins — ten digits is a national number, full stop.
   *
   * The alternative (strip a leading `91` when present) is much worse than it looks: it would
   * mangle every genuine number in the 91xxxxxxxx range, which is a live Indian mobile series,
   * into an eight-digit fragment that then fails validation. Preferring length means the only
   * way to say "country code" is to write eleven-plus digits or a `+`, which is exactly what
   * `+919198765432` does — and that still round-trips, asserted below.
   */
  it('reads ten digits as national even when they start with the country code', () => {
    expect(normalisePhone('9198765432')).toBe('+919198765432');
    expect(normalisePhone('+919198765432')).toBe('+919198765432');
    expect(normalisePhone('919198765432')).toBe('+919198765432');
  });

  /*
   * India has no subscriber number starting 0-5. Enforcing it is what stops a mistyped or
   * truncated number becoming a *valid-looking* identity that then collides with somebody.
   */
  it('rejects national numbers that cannot start an Indian subscriber number', () => {
    for (const lead of ['0', '1', '2', '3', '4', '5']) {
      expect(normalisePhone(`${lead}876543210`), lead).toBeNull();
    }
    for (const lead of ['6', '7', '8', '9']) {
      expect(normalisePhone(`${lead}876543210`), lead).toBe(`+91${lead}876543210`);
    }
  });

  /*
   * The extension case, which is the one that would silently corrupt an identity: truncating
   * `...43210 x22` to `...43210` would file the expense against whoever really owns that
   * number. Rejecting is the only safe answer.
   */
  it('rejects letters and extensions rather than stripping them', () => {
    expect(normalisePhone('+91 98765 43210 x22')).toBeNull();
    expect(normalisePhone('+91 98765 43210 ext 22')).toBeNull();
    expect(normalisePhone('98765abc43210')).toBeNull();
    expect(normalisePhone('call me')).toBeNull();
  });

  it('only honours a + at the front, and never mid-string', () => {
    expect(normalisePhone('98765+43210')).toBeNull();
    expect(normalisePhone('+91+9876543210')).toBeNull();
    // A leading + means "already international", so the 00 access prefix is then malformed.
    expect(normalisePhone('+0091 98765 43210')).toBeNull();
  });

  it('is idempotent — normalising its own output changes nothing', () => {
    expect(normalisePhone(CANON)).toBe(CANON);
    expect(normalisePhone(normalisePhone('09876543210')!)).toBe(CANON);
  });

  it('survives arbitrary junk without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = normalisePhone(s);
        // Either a rejection, or something that is genuinely E.164: + then digits only.
        expect(out === null || /^\+[0-9]+$/.test(out)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  /*
   * The property that actually protects identity: separators are decoration. However someone
   * spaces, hyphens or brackets a valid number, it must reach the same canonical string —
   * otherwise the unique index on (kind, value_norm) is comparing presentation, not people.
   */
  it('ignores separator placement entirely', () => {
    const separators = fc.constantFrom(' ', '-', '.', '', '  ');
    fc.assert(
      fc.property(
        fc.constantFrom('6', '7', '8', '9'),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 }),
        fc.array(separators, { minLength: 9, maxLength: 9 }),
        (lead, rest, seps) => {
          const digits = lead + rest.join('');
          const decorated = digits
            .split('')
            .map((d, i) => (i === 0 ? d : seps[i - 1]! + d))
            .join('');
          expect(normalisePhone(decorated)).toBe(`+91${digits}`);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('isValidPhone', () => {
  it('agrees with normalisePhone', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('groups an Indian number the way the country writes it', () => {
    expect(formatPhone(CANON)).toBe('+91 98765 43210');
  });

  it('returns anything it does not recognise untouched, rather than mangling it', () => {
    expect(formatPhone('+14155550123')).toBe('+14155550123');
    expect(formatPhone('nonsense')).toBe('nonsense');
  });

  it('is display-only — its output is not what gets stored', () => {
    // Round-trips, so a formatted number pasted back into a field still resolves.
    expect(normalisePhone(formatPhone(CANON))).toBe(CANON);
  });
});
