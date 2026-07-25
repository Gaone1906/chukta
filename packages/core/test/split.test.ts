import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SplitError, computeShares, sumShares, type SplitInput } from '../src/split';

const m = (entries: [string, number][]) => new Map(entries);
const mb = (entries: [string, bigint][]) => new Map(entries);

describe('equal split', () => {
  it('divides evenly and keeps the remainder', () => {
    const shares = computeShares(10000n, { type: 'equal', participants: ['bob', 'ann', 'cy'] });
    expect(sumShares(shares)).toBe(10000n);
    expect([...shares.values()].sort()).toEqual([3333n, 3333n, 3334n]);
  });

  it('handles a single participant', () => {
    expect(computeShares(999n, { type: 'equal', participants: ['solo'] }).get('solo')).toBe(999n);
  });
});

describe('shares split', () => {
  it('weights by share count', () => {
    const shares = computeShares(30000n, { type: 'shares', shares: m([['ann', 2], ['bob', 1]]) });
    expect(shares.get('ann')).toBe(20000n);
    expect(shares.get('bob')).toBe(10000n);
  });

  it('rejects zero or fractional shares', () => {
    expect(() => computeShares(100n, { type: 'shares', shares: m([['a', 0]]) })).toThrow(SplitError);
    expect(() => computeShares(100n, { type: 'shares', shares: m([['a', 1.5]]) })).toThrow(SplitError);
  });
});

describe('percentage split', () => {
  it('allocates from the percentages jointly', () => {
    const shares = computeShares(10000n, {
      type: 'percentage',
      percentages: m([['ann', 40], ['bob', 35], ['cy', 25]]),
    });
    expect(sumShares(shares)).toBe(10000n);
    expect(shares.get('ann')).toBe(4000n);
    expect(shares.get('bob')).toBe(3500n);
    expect(shares.get('cy')).toBe(2500n);
  });

  it('still sums exactly when the percentages do not divide cleanly', () => {
    // Three-way 33.333333% each cannot sum to 100, so use a split that does but rounds badly.
    const shares = computeShares(10001n, {
      type: 'percentage',
      percentages: m([['a', 33.33], ['b', 33.33], ['c', 33.34]]),
    });
    expect(sumShares(shares)).toBe(10001n);
  });

  it('refuses percentages that do not reach 100 rather than normalising them', () => {
    expect(() =>
      computeShares(10000n, { type: 'percentage', percentages: m([['a', 50], ['b', 40]]) }),
    ).toThrow(/sum to exactly 100/);
  });

  it('rejects precision beyond six decimal places', () => {
    expect(() =>
      computeShares(100n, { type: 'percentage', percentages: m([['a', 33.3333333], ['b', 66.6666667]]) }),
    ).toThrow(/decimal places/);
  });
});

describe('exact split', () => {
  it('passes the amounts straight through', () => {
    const shares = computeShares(5000n, { type: 'exact', amounts: mb([['a', 2000n], ['b', 3000n]]) });
    expect(shares.get('a')).toBe(2000n);
    expect(shares.get('b')).toBe(3000n);
  });

  it('refuses amounts that miss the total — that is a user error to surface', () => {
    expect(() =>
      computeShares(5000n, { type: 'exact', amounts: mb([['a', 2000n], ['b', 2500n]]) }),
    ).toThrow(/sum to 4500 but the total is 5000/);
  });
});

describe('itemized split', () => {
  it('assigns lines to their eaters and spreads tax pro rata', () => {
    // Ann's lobster 6000, Bob's dal 2000, then 800 tax on top = 8800.
    const shares = computeShares(8800n, {
      type: 'itemized',
      participants: ['ann', 'bob'],
      items: [
        { id: 'lobster', amountMinor: 6000n, participants: ['ann'] },
        { id: 'dal', amountMinor: 2000n, participants: ['bob'] },
        { id: 'tax', amountMinor: 800n, kind: 'tax' },
      ],
    });
    expect(sumShares(shares)).toBe(8800n);
    // Tax splits 3:1 with the subtotals, so Ann carries 600 of it.
    expect(shares.get('ann')).toBe(6600n);
    expect(shares.get('bob')).toBe(2200n);
  });

  it('splits a shared line among only the people on it', () => {
    const shares = computeShares(3000n, {
      type: 'itemized',
      participants: ['a', 'b', 'c'],
      items: [
        { id: 'wine', amountMinor: 2000n, participants: ['a', 'b'] },
        { id: 'water', amountMinor: 1000n, participants: ['a', 'b', 'c'] },
      ],
    });
    expect(sumShares(shares)).toBe(3000n);
    expect(shares.get('c')).toBe(333n);
  });

  it('subtracts a discount', () => {
    const shares = computeShares(1800n, {
      type: 'itemized',
      participants: ['a', 'b'],
      items: [
        { id: 'meal', amountMinor: 2000n, participants: ['a', 'b'] },
        { id: 'coupon', amountMinor: 200n, kind: 'discount' },
      ],
    });
    expect(sumShares(shares)).toBe(1800n);
    expect(shares.get('a')).toBe(900n);
  });

  it('refuses items that do not reconcile to the total', () => {
    expect(() =>
      computeShares(9999n, {
        type: 'itemized',
        participants: ['a'],
        items: [{ id: 'x', amountMinor: 100n, participants: ['a'] }],
      }),
    ).toThrow(/but the total is 9999/);
  });

  it('rejects an item naming someone who is not on the expense', () => {
    expect(() =>
      computeShares(100n, {
        type: 'itemized',
        participants: ['a'],
        items: [{ id: 'x', amountMinor: 100n, participants: ['ghost'] }],
      }),
    ).toThrow(/not on the expense/);
  });
});

describe('every split type, as a property', () => {
  const people = ['ann', 'bob', 'cy', 'dee'];

  const inputs: fc.Arbitrary<{ total: bigint; split: SplitInput }> = fc
    .tuple(
      fc.bigInt({ min: 1n, max: 10n ** 10n }),
      fc.integer({ min: 1, max: 4 }),
      fc.constantFrom('equal', 'shares', 'percentage'),
    )
    .map(([total, n, kind]) => {
      const participants = people.slice(0, n);
      if (kind === 'equal') return { total, split: { type: 'equal', participants } as SplitInput };
      if (kind === 'shares') {
        return {
          total,
          split: {
            type: 'shares',
            shares: new Map(participants.map((p, i) => [p, i + 1])),
          } as SplitInput,
        };
      }
      // Percentages that always sum to exactly 100 regardless of participant count.
      const each = Math.floor((100 / n) * 1e4) / 1e4;
      const percentages = new Map(participants.map((p) => [p, each]));
      percentages.set(participants[0]!, Number((each + (100 - each * n)).toFixed(4)));
      return { total, split: { type: 'percentage', percentages } as SplitInput };
    });

  it('always sums to exactly the total and never goes negative', () => {
    fc.assert(
      fc.property(inputs, ({ total, split }) => {
        const shares = computeShares(total, split);
        expect(sumShares(shares)).toBe(total);
        for (const value of shares.values()) expect(value >= 0n).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
