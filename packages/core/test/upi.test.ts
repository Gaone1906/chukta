import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_NOTE_LENGTH,
  UpiError,
  buildUpiUri,
  formatUpiAmount,
  isValidVpa,
  parseUpiUri,
  settlementNote,
} from '../src/upi';

describe('isValidVpa', () => {
  it('accepts what the profiles CHECK accepts', () => {
    expect(isValidVpa('priya@okhdfcbank')).toBe(true);
    expect(isValidVpa('priya.sharma-1@ybl')).toBe(true);
    expect(isValidVpa('9876543210@paytm')).toBe(true);
  });

  it('rejects the near misses', () => {
    expect(isValidVpa('priya')).toBe(false); // no handle
    expect(isValidVpa('@ybl')).toBe(false); // no name
    expect(isValidVpa('p@y')).toBe(false); // handle too short
    expect(isValidVpa('priya@ok bank')).toBe(false); // space
    expect(isValidVpa('priya@ok1')).toBe(false); // digits in the handle
  });
});

describe('formatUpiAmount', () => {
  it('always emits the currency exponent in full', () => {
    expect(formatUpiAmount(142000n)).toBe('1420.00');
    expect(formatUpiAmount(142050n)).toBe('1420.50');
    expect(formatUpiAmount(1n)).toBe('0.01');
    expect(formatUpiAmount(100n)).toBe('1.00');
  });

  it('honours a zero-exponent currency', () => {
    expect(formatUpiAmount(1420n, 'JPY')).toBe('1420');
  });

  it('refuses a non-positive amount rather than emitting one', () => {
    expect(() => formatUpiAmount(0n)).toThrow(UpiError);
    expect(() => formatUpiAmount(-100n)).toThrow(UpiError);
  });

  it('stays exact past 2^53', () => {
    expect(formatUpiAmount(9007199254740993n)).toBe('90071992547409.93');
  });
});

describe('buildUpiUri', () => {
  it('builds the shape the NPCI spec describes', () => {
    const uri = buildUpiUri({
      vpa: 'priya@okhdfcbank',
      name: 'Priya Sharma',
      amountMinor: 142000n,
      note: 'Goa trip',
      ref: '3f7a1b2c-0000-4000-8000-000000000001',
    });

    expect(uri.startsWith('upi://pay?')).toBe(true);
    const p = parseUpiUri(uri);
    expect(p.pa).toBe('priya@okhdfcbank');
    expect(p.pn).toBe('Priya Sharma');
    expect(p.am).toBe('1420.00');
    expect(p.cu).toBe('INR');
    expect(p.tn).toBe('Goa trip');
    // Hyphens stripped: some apps reject a `tr` that is not alphanumeric. A uuid loses its
    // four hyphens and comes to 32 characters, comfortably inside the 35 the field allows.
    expect(p.tr).toBe('3f7a1b2c000040008000000000000001');
    expect(p.tr).toHaveLength(32);
  });

  it('encodes the characters encodeURIComponent leaves behind', () => {
    const uri = buildUpiUri({
      vpa: 'priya@ybl',
      name: "O'Brien (Priya)",
      amountMinor: 100n,
    });
    expect(uri).not.toContain("'");
    expect(uri).not.toContain('(');
    expect(parseUpiUri(uri).pn).toBe("O'Brien (Priya)");
  });

  it('truncates the note rather than letting an app reject the whole intent', () => {
    const uri = buildUpiUri({
      vpa: 'priya@ybl',
      name: 'Priya',
      amountMinor: 100n,
      note: 'x'.repeat(200),
    });
    expect(parseUpiUri(uri).tn).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('omits optional params entirely when they are empty', () => {
    const uri = buildUpiUri({ vpa: 'priya@ybl', name: 'Priya', amountMinor: 100n, note: '  ' });
    expect(uri).not.toContain('tn=');
    expect(uri).not.toContain('tr=');
  });

  it('refuses to build a URI that would pay the wrong place', () => {
    expect(() => buildUpiUri({ vpa: 'nonsense', name: 'Priya', amountMinor: 100n })).toThrow(
      UpiError,
    );
    expect(() => buildUpiUri({ vpa: 'priya@ybl', name: '  ', amountMinor: 100n })).toThrow(
      UpiError,
    );
    expect(() => buildUpiUri({ vpa: 'priya@ybl', name: 'Priya', amountMinor: 0n })).toThrow(
      UpiError,
    );
  });

  it('round-trips any payee name and any positive amount', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (name, minor) => {
          const uri = buildUpiUri({ vpa: 'priya@ybl', name, amountMinor: minor });
          const p = parseUpiUri(uri);
          expect(p.pn).toBe(name.trim());
          expect(p.am).toBe(formatUpiAmount(minor));
          // The amount must survive as an exact decimal, never in scientific notation.
          expect(p.am).toMatch(/^\d+\.\d{2}$/);
        },
      ),
    );
  });

  it('never emits a bare & or = inside a value, whatever the name contains', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0), (name) => {
        const uri = buildUpiUri({ vpa: 'priya@ybl', name, amountMinor: 100n });
        // Exactly four parameters, so no injected separator has split a value.
        expect(uri.slice('upi://pay?'.length).split('&')).toHaveLength(4);
      }),
    );
  });
});

describe('settlementNote', () => {
  it('names the group when there is one', () => {
    expect(settlementNote('Dev', 'Goa, finally')).toBe('Chukta · Goa, finally · Dev');
    expect(settlementNote('Dev')).toBe('Chukta settle up · Dev');
  });

  it('drops the name rather than truncating mid-word, and never exceeds the cap', () => {
    const note = settlementNote('Somebody With A Very Long Name Indeed', 'A Group Name');
    expect(note).toBe('Chukta · A Group Name');
    expect(note.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });

  it('stays within the cap even when the group name alone is too long', () => {
    expect(settlementNote('Dev', 'x'.repeat(100)).length).toBe(MAX_NOTE_LENGTH);
  });
});
