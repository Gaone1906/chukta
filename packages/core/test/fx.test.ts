import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  FxError,
  RATE_SCALE,
  allocateDualCurrency,
  convert,
  convertMinor,
  isRateAcceptable,
  parseRate,
} from '../src/fx';
import { money } from '../src/money';

describe('parseRate', () => {
  it('keeps all ten decimal places exactly', () => {
    expect(parseRate('1')).toBe(RATE_SCALE);
    expect(parseRate('83.5')).toBe(835000000000n);
    expect(parseRate('83.1234567891')).toBe(831234567891n);
  });

  it('rejects rates it cannot represent exactly', () => {
    expect(() => parseRate('83.12345678911')).toThrow(/decimal places/);
    expect(() => parseRate('0')).toThrow(/greater than zero/);
    expect(() => parseRate('-5')).toThrow(FxError);
    expect(() => parseRate('abc')).toThrow(FxError);
  });
});

describe('convertMinor', () => {
  it('converts within the same exponent', () => {
    // $10.00 at 83.50 -> ₹835.00
    expect(convertMinor(1000n, 'USD', 'INR', parseRate('83.50'))).toBe(83500n);
  });

  it('handles a change of exponent, not just a multiply', () => {
    // ¥1000 (exponent 0) at 0.55 -> ₹550.00 (exponent 2), so 55000 paise.
    expect(convertMinor(1000n, 'JPY', 'INR', parseRate('0.55'))).toBe(55000n);
    // ₹550.00 back to yen at 1/0.55.
    expect(convertMinor(55000n, 'INR', 'JPY', parseRate('1.8181818182'))).toBe(1000n);
  });

  it('rounds half to even so conversions do not drift in one direction', () => {
    // 2.5 minor units exactly -> 2, not 3.
    expect(convertMinor(5n, 'USD', 'USD', parseRate('0.5'))).toBe(2n);
    // 3.5 -> 4.
    expect(convertMinor(7n, 'USD', 'USD', parseRate('0.5'))).toBe(4n);
  });

  it('is a no-op when the currency matches', () => {
    const amount = money(1234n, 'INR');
    expect(convert(amount, 'INR', '99')).toBe(amount);
  });
});

describe('allocateDualCurrency', () => {
  it('sums exactly in both currencies at once', () => {
    const keys = ['ann', 'bob', 'cy'];
    const result = allocateDualCurrency({
      total: 1000n, // $10.00
      currency: 'USD',
      baseCurrency: 'INR',
      rate: '83.3333',
      weights: [1n, 1n, 1n],
      keys,
    });

    const sum = (map: Map<string, bigint>) => [...map.values()].reduce((a, b) => a + b, 0n);
    expect(sum(result.shares)).toBe(1000n);
    expect(sum(result.baseShares)).toBe(result.baseTotal);
    expect(result.baseTotal).toBe(83333n); // ₹833.33
  });

  it('gives the spare unit to the same person in both currencies', () => {
    const keys = ['ann', 'bob', 'cy'];
    const result = allocateDualCurrency({
      total: 1000n,
      currency: 'USD',
      baseCurrency: 'INR',
      rate: '83.3333',
      weights: [1n, 1n, 1n],
      keys,
    });

    // Whoever is rounded up locally must also be the one rounded up in the base currency —
    // otherwise the two views of one expense disagree about who owes the extra unit.
    const localMax = [...result.shares.entries()].sort((a, b) => Number(b[1] - a[1]))[0]![0];
    const baseMax = [...result.baseShares.entries()].sort((a, b) => Number(b[1] - a[1]))[0]![0];
    expect(localMax).toBe(baseMax);
  });

  it('skips conversion entirely when the currencies match', () => {
    const result = allocateDualCurrency({
      total: 999n,
      currency: 'INR',
      baseCurrency: 'INR',
      rate: '1',
      weights: [1n, 2n],
      keys: ['a', 'b'],
    });
    expect(result.baseTotal).toBe(999n);
    expect(result.shares).toEqual(result.baseShares);
  });

  it('always sums exactly, for any rate and any participant count', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 2_000_000 }),
        (total, n, rateMicros) => {
          const keys = Array.from({ length: n }, (_, i) => `p${i}`);
          const weights = keys.map((_, i) => BigInt(i + 1));
          const rate = (rateMicros / 10_000).toFixed(4);

          const result = allocateDualCurrency({
            total,
            currency: 'USD',
            baseCurrency: 'INR',
            rate,
            weights,
            keys,
          });

          const sum = (map: Map<string, bigint>) => [...map.values()].reduce((a, b) => a + b, 0n);
          expect(sum(result.shares)).toBe(total);
          expect(sum(result.baseShares)).toBe(result.baseTotal);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('isRateAcceptable', () => {
  it('accepts a client rate inside the tolerance and rejects one outside', () => {
    expect(isRateAcceptable('83.00', '83.00')).toBe(true);
    expect(isRateAcceptable('84.00', '83.00')).toBe(true); // ~1.2% off
    expect(isRateAcceptable('90.00', '83.00')).toBe(false); // ~8.4% off
    expect(isRateAcceptable('70.00', '83.00')).toBe(false);
  });

  it('is symmetric about the server rate', () => {
    expect(isRateAcceptable('81.34', '83.00')).toBe(isRateAcceptable('84.66', '83.00'));
  });
});
