import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  formatAmount,
  groupDigits,
  balanceCaption,
  parseAmount,
  toAmountInput,
  spokenAmount,
} from '../src/format';
import { money, exponentOf, add, sum, subtract } from '../src/money';

describe('groupDigits', () => {
  it('groups the Indian way: last three, then twos', () => {
    expect(groupDigits('1', 'indian')).toBe('1');
    expect(groupDigits('999', 'indian')).toBe('999');
    expect(groupDigits('1234', 'indian')).toBe('1,234');
    expect(groupDigits('12480', 'indian')).toBe('12,480');
    expect(groupDigits('123456', 'indian')).toBe('1,23,456');
    expect(groupDigits('1234567', 'indian')).toBe('12,34,567'); // 12 lakh
    expect(groupDigits('12345678', 'indian')).toBe('1,23,45,678'); // 1.23 crore
    expect(groupDigits('1234567890', 'indian')).toBe('1,23,45,67,890');
  });

  it('groups the western way in threes', () => {
    expect(groupDigits('1234567', 'western')).toBe('1,234,567');
    expect(groupDigits('12480', 'western')).toBe('12,480');
  });

  it('never emits a leading or doubled separator', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), (n) => {
        for (const style of ['indian', 'western'] as const) {
          const out = groupDigits(n.toString(), style);
          expect(out.startsWith(',')).toBe(false);
          expect(out.endsWith(',')).toBe(false);
          expect(out.includes(',,')).toBe(false);
          expect(out.replace(/,/g, '')).toBe(n.toString());
        }
      }),
    );
  });
});

describe('formatAmount', () => {
  it('matches the amounts shown in the design prototypes', () => {
    // From Hisaab Home.dc.html and Hisaab Group.dc.html.
    expect(formatAmount(money(1248000n, 'INR'))).toBe('₹12,480');
    expect(formatAmount(money(84000n, 'INR'))).toBe('₹840');
    expect(formatAmount(money(315000n, 'INR'))).toBe('₹3,150');
    expect(formatAmount(money(620000n, 'INR'))).toBe('₹6,200');
    expect(formatAmount(money(187500n, 'INR'))).toBe('₹1,875');
    expect(formatAmount(money(0n, 'INR'))).toBe('₹0');
  });

  it('hides a zero fraction but keeps a real one', () => {
    expect(formatAmount(money(150000n, 'INR'))).toBe('₹1,500');
    expect(formatAmount(money(150050n, 'INR'))).toBe('₹1,500.50');
    expect(formatAmount(money(150000n, 'INR'), { decimals: 'always' })).toBe('₹1,500.00');
    expect(formatAmount(money(150050n, 'INR'), { decimals: 'never' })).toBe('₹1,500');
  });

  it('pads the fraction to the currency exponent', () => {
    expect(formatAmount(money(150005n, 'INR'))).toBe('₹1,500.05');
    // Currencies without a symbol fall back to the code plus a non-breaking space, so the
    // code can never wrap away from its amount.
    expect(formatAmount(money(1500005n, 'KWD'))).toBe('KWD\u00A01,500.005');
  });

  it('honours currencies with a non-standard exponent', () => {
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('KWD')).toBe(3);
    expect(exponentOf('INR')).toBe(2);
    expect(formatAmount(money(12480n, 'JPY'), { grouping: 'western' })).toBe('¥12,480');
  });

  it('signs negatives outside the symbol', () => {
    expect(formatAmount(money(-84000n, 'INR'))).toBe('-₹840');
    expect(formatAmount(money(-84000n, 'INR'), { signed: false })).toBe('₹840');
  });

  it('round-trips: the digits in the output always reconstruct the amount', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.constantFrom('INR', 'USD', 'JPY', 'KWD'),
        (minor, currency) => {
          const out = formatAmount(money(minor, currency), { decimals: 'always', symbol: false });
          const digits = out.replace(/[^0-9]/g, '');
          const abs = minor < 0n ? -minor : minor;
          expect(BigInt(digits)).toBe(abs);
          expect(out.startsWith('-')).toBe(minor < 0n);
        },
      ),
    );
  });
});

describe('money arithmetic', () => {
  it('adds and subtracts within a currency', () => {
    expect(add(money(100n, 'INR'), money(250n, 'INR')).minor).toBe(350n);
    expect(subtract(money(100n, 'INR'), money(250n, 'INR')).minor).toBe(-150n);
    expect(sum([money(1n, 'INR'), money(2n, 'INR'), money(3n, 'INR')], 'INR').minor).toBe(6n);
  });

  it('refuses to mix currencies rather than silently converting', () => {
    expect(() => add(money(100n, 'INR'), money(100n, 'USD'))).toThrow(/INR.*USD/);
    expect(() => sum([money(1n, 'USD')], 'INR')).toThrow();
  });

  it('stays exact well beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = money(9007199254740993n, 'INR'); // 2^53 + 1
    expect(formatAmount(huge, { symbol: false, grouping: 'western' })).toBe('90,071,992,547,409.93');
  });
});

describe('balanceCaption', () => {
  it('reads from the viewer perspective', () => {
    expect(balanceCaption(money(0n, 'INR'))).toBe('settled');
    expect(balanceCaption(money(-100n, 'INR'))).toBe('you owe');
    expect(balanceCaption(money(100n, 'INR'))).toBe('owes you');
  });
});

describe('parseAmount', () => {
  it('reads plain and decimal rupee amounts', () => {
    expect(parseAmount('1420', 'INR')).toBe(142000n);
    expect(parseAmount('1420.5', 'INR')).toBe(142050n);
    expect(parseAmount('1420.55', 'INR')).toBe(142055n);
    expect(parseAmount('0.01', 'INR')).toBe(1n);
    expect(parseAmount('.5', 'INR')).toBe(50n);
    expect(parseAmount('7.', 'INR')).toBe(700n);
  });

  it('tolerates what people actually paste', () => {
    expect(parseAmount('₹1,24,000', 'INR')).toBe(12400000n);
    expect(parseAmount(' 1 420 ', 'INR')).toBe(142000n);
  });

  it('returns null rather than guessing', () => {
    expect(parseAmount('', 'INR')).toBeNull();
    expect(parseAmount('abc', 'INR')).toBeNull();
    expect(parseAmount('1.234', 'INR')).toBeNull(); // more precision than the currency has
    expect(parseAmount('1.2.3', 'INR')).toBeNull();
  });

  it('never routes through a float', () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point; Math.round rescues that one
    // but not 8.165 or 1.005, which round the wrong way. These must all be exact.
    expect(parseAmount('19.99', 'INR')).toBe(1999n);
    expect(parseAmount('8.165', 'USD')).toBeNull(); // 3dp in a 2dp currency
    expect(parseAmount('1.005', 'INR')).toBeNull();
    expect(parseAmount('90071992547409.93', 'INR')).toBe(9007199254740993n); // > 2^53
  });

  it('round-trips through toAmountInput', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (minor) => {
        const text = toAmountInput(minor, 'INR');
        expect(parseAmount(text, 'INR') ?? 0n).toBe(minor);
      }),
    );
  });
});

describe('spokenAmount', () => {
  const inr = (minor: bigint) => ({ minor, currency: 'INR' as const });

  it('spells the currency instead of leaving a glyph to the screen reader', () => {
    expect(spokenAmount(inr(142000n))).toBe('1,420 rupees');
  });

  it('keeps lakh grouping, which is what gives a long number readable pauses', () => {
    expect(spokenAmount(inr(12200000n))).toBe('1,22,000 rupees');
  });

  it('names the fraction rather than punctuating it', () => {
    expect(spokenAmount(inr(142050n))).toBe('1,420 rupees 50 paise');
  });

  it('singularises', () => {
    expect(spokenAmount(inr(100n))).toBe('1 rupee');
    expect(spokenAmount(inr(101n))).toBe('1 rupee 1 paisa');
  });

  it('keeps a zero major unit, so a small amount is not mistaken for a large one', () => {
    expect(spokenAmount(inr(50n))).toBe('0 rupees 50 paise');
  });

  it('says zero rather than nothing', () => {
    expect(spokenAmount(inr(0n))).toBe('0 rupees');
  });

  it('words the sign', () => {
    expect(spokenAmount(inr(-142000n))).toBe('minus 1,420 rupees');
  });
});
