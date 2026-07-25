import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocate } from '../src/allocate';
import { floorDiv, roundHalfEven } from '../src/bigintMath';

const keysFor = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);

describe('floorDiv', () => {
  it('rounds toward negative infinity, unlike bigint division', () => {
    expect(-7n / 2n).toBe(-3n); // the built-in truncates
    expect(floorDiv(-7n, 2n)).toBe(-4n); // we floor
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-6n, 2n)).toBe(-3n); // exact division is unaffected
    expect(floorDiv(7n, -2n)).toBe(-4n);
  });
});

describe('roundHalfEven', () => {
  it('sends exact halves to the even neighbour', () => {
    expect(roundHalfEven(5n, 2n)).toBe(2n); // 2.5 -> 2
    expect(roundHalfEven(7n, 2n)).toBe(4n); // 3.5 -> 4
    expect(roundHalfEven(-5n, 2n)).toBe(-2n);
    expect(roundHalfEven(-7n, 2n)).toBe(-4n);
  });

  it('rounds normally away from halves', () => {
    expect(roundHalfEven(11n, 4n)).toBe(3n); // 2.75
    expect(roundHalfEven(9n, 4n)).toBe(2n); // 2.25
  });
});

describe('allocate', () => {
  it('fixes the bug in the design prototype: ₹100 three ways loses nothing', () => {
    const shares = allocate({ total: 10000n, weights: [1n, 1n, 1n], keys: keysFor(3) });
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(10000n);
    // 3333.33 each: someone has to take the extra paisa, and it must be exactly one of them.
    expect(shares.filter((s) => s === 3334n)).toHaveLength(1);
    expect(shares.filter((s) => s === 3333n)).toHaveLength(2);
  });

  it('honours weights', () => {
    expect(allocate({ total: 300n, weights: [2n, 1n], keys: keysFor(2) })).toEqual([200n, 100n]);
  });

  it('gives the leftover to the largest remainder', () => {
    // 10 across weights 1:1:1 -> floor 3 each, so exactly one unit is left over and the
    // remainders are all equal. The key tiebreak decides who gets it.
    const shares = allocate({ total: 10n, weights: [1n, 1n, 1n], keys: ['c', 'a', 'b'] });
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(10n);
    // 'a' sorts first, and sits at index 1.
    expect(shares).toEqual([3n, 4n, 3n]);
  });

  it('is deterministic regardless of input order', () => {
    const a = allocate({ total: 100n, weights: [1n, 1n, 1n], keys: ['x', 'y', 'z'] });
    const b = allocate({ total: 100n, weights: [1n, 1n, 1n], keys: ['z', 'y', 'x'] });
    // Same participants, same money: reversing the array must not move the spare unit to a
    // different person.
    expect(new Map([['x', a[0]], ['y', a[1]], ['z', a[2]]])).toEqual(
      new Map([['z', b[0]], ['y', b[1]], ['x', b[2]]]),
    );
  });

  it('handles negative totals (refunds) without losing a unit', () => {
    const shares = allocate({ total: -10000n, weights: [1n, 1n, 1n], keys: keysFor(3) });
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(-10000n);
  });

  it('tolerates zero-weight participants', () => {
    const shares = allocate({ total: 100n, weights: [1n, 0n, 1n], keys: keysFor(3) });
    expect(shares).toEqual([50n, 0n, 50n]);
  });

  it('rejects inputs that cannot produce a valid split', () => {
    expect(() => allocate({ total: 100n, weights: [], keys: [] })).toThrow(/no participants/);
    expect(() => allocate({ total: 100n, weights: [0n, 0n], keys: keysFor(2) })).toThrow(/sum to zero/);
    expect(() => allocate({ total: 100n, weights: [-1n, 2n], keys: keysFor(2) })).toThrow(/non-negative/);
    expect(() => allocate({ total: 100n, weights: [1n], keys: keysFor(2) })).toThrow(/keys/);
  });

  describe('properties', () => {
    const scenario = fc
      .integer({ min: 1, max: 12 })
      .chain((n) =>
        fc.record({
          total: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
          weights: fc.array(fc.bigInt({ min: 0n, max: 10n ** 6n }), { minLength: n, maxLength: n }),
          keys: fc.constant(keysFor(n)),
        }),
      )
      .filter(({ weights }) => weights.some((w) => w > 0n));

    it('always sums to exactly the total', () => {
      fc.assert(
        fc.property(scenario, ({ total, weights, keys }) => {
          const shares = allocate({ total, weights, keys });
          expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
        }),
        { numRuns: 500 },
      );
    });

    it('never differs from the ideal share by a whole unit or more', () => {
      fc.assert(
        fc.property(scenario, ({ total, weights, keys }) => {
          const shares = allocate({ total, weights, keys });
          const W = weights.reduce((a, b) => a + b, 0n);
          shares.forEach((share, i) => {
            const floor = floorDiv(total * weights[i]!, W);
            // Largest-remainder gives each participant either their floor or floor + 1.
            expect(share === floor || share === floor + 1n).toBe(true);
          });
        }),
        { numRuns: 500 },
      );
    });

    it('gives a non-negative share to everyone when the total is non-negative', () => {
      fc.assert(
        fc.property(
          scenario.filter(({ total }) => total >= 0n),
          ({ total, weights, keys }) => {
            for (const share of allocate({ total, weights, keys })) {
              expect(share >= 0n).toBe(true);
            }
          },
        ),
        { numRuns: 300 },
      );
    });

    it('is stable: the same input always produces the same output', () => {
      fc.assert(
        fc.property(scenario, (input) => {
          expect(allocate(input)).toEqual(allocate(input));
        }),
        { numRuns: 200 },
      );
    });

    it('never gives a bigger share to a smaller weight', () => {
      fc.assert(
        fc.property(
          scenario.filter(({ total }) => total >= 0n),
          ({ total, weights, keys }) => {
            const shares = allocate({ total, weights, keys });
            for (let i = 0; i < weights.length; i++) {
              for (let j = 0; j < weights.length; j++) {
                if (weights[i]! > weights[j]!) {
                  // Monotonic up to the single unit largest-remainder may hand out.
                  expect(shares[i]! >= shares[j]! - 1n).toBe(true);
                }
              }
            }
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
