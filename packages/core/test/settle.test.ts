import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  SettleError,
  netBalances,
  resolvePairwise,
  simplifyDebts,
  type Balance,
} from '../src/settle';

const mb = (entries: [string, bigint][]) => new Map(entries);

describe('resolvePairwise', () => {
  it('nets a payer who also owes, instead of making them owe themselves', () => {
    // Priya paid the whole ₹4,320 dinner, split three ways.
    const transfers = resolvePairwise(
      mb([['priya', 432000n]]),
      mb([['priya', 144000n], ['arjun', 144000n], ['meher', 144000n]]),
    );
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.to === 'priya')).toBe(true);
    expect(transfers.every((t) => t.from !== t.to)).toBe(true);
    expect(transfers.reduce((sum, t) => sum + t.amountMinor, 0n)).toBe(288000n);
  });

  it('spreads one debtor across several creditors exactly', () => {
    const transfers = resolvePairwise(
      mb([['a', 600n], ['b', 400n]]),
      mb([['c', 1000n]]),
    );
    expect(transfers.reduce((s, t) => s + t.amountMinor, 0n)).toBe(1000n);
    expect(transfers.map((t) => t.from)).toEqual(['c', 'c']);
  });

  it('returns nothing when everyone paid exactly their share', () => {
    expect(resolvePairwise(mb([['a', 500n], ['b', 500n]]), mb([['a', 500n], ['b', 500n]]))).toEqual([]);
  });

  it('refuses payers and shares that do not balance', () => {
    expect(() => resolvePairwise(mb([['a', 100n]]), mb([['b', 200n]]))).toThrow(SettleError);
  });

  it('multi-payer expenses resolve correctly', () => {
    // Two people paid; three people owe.
    const transfers = resolvePairwise(
      mb([['a', 6000n], ['b', 3000n]]),
      mb([['a', 3000n], ['b', 3000n], ['c', 3000n]]),
    );
    // b is square; c owes 3000; a is owed 3000.
    expect(transfers).toEqual([{ from: 'c', to: 'a', amountMinor: 3000n }]);
  });
});

describe('simplifyDebts', () => {
  const bal = (entries: [string, bigint][]): Balance[] =>
    entries.map(([profileId, netMinor]) => ({ profileId, netMinor }));

  it('finds the exact match first, preserving the real relationship', () => {
    // a owes 100, b is owed 100, c owes 50, d is owed 50.
    const transfers = simplifyDebts(bal([['a', -100n], ['b', 100n], ['c', -50n], ['d', 50n]]));
    expect(transfers).toHaveLength(2);
    expect(transfers).toContainEqual({ from: 'a', to: 'b', amountMinor: 100n });
    expect(transfers).toContainEqual({ from: 'c', to: 'd', amountMinor: 50n });
  });

  it('collapses a chain into one payment', () => {
    // a owes b, b owes c the same amount — a should just pay c.
    const transfers = simplifyDebts(bal([['a', -100n], ['b', 0n], ['c', 100n]]));
    expect(transfers).toEqual([{ from: 'a', to: 'c', amountMinor: 100n }]);
  });

  it('emits nothing when everything is already settled', () => {
    expect(simplifyDebts(bal([['a', 0n], ['b', 0n]]))).toEqual([]);
  });

  it('refuses balances that do not sum to zero', () => {
    expect(() => simplifyDebts(bal([['a', -100n], ['b', 50n]]))).toThrow(/sum to zero/);
  });

  describe('properties', () => {
    /** Random balances that are guaranteed to net to zero. */
    const balances = fc
      .array(fc.bigInt({ min: -100000n, max: 100000n }), { minLength: 2, maxLength: 10 })
      .map((values) => {
        const total = values.reduce((a, b) => a + b, 0n);
        const adjusted = [...values];
        adjusted[0] = adjusted[0]! - total;
        return adjusted.map((netMinor, i) => ({
          profileId: `p${String(i).padStart(2, '0')}`,
          netMinor,
        }));
      });

    it('preserves every net balance exactly', () => {
      fc.assert(
        fc.property(balances, (input) => {
          const transfers = simplifyDebts(input);
          const after = new Map(netBalances(transfers).map((b) => [b.profileId, b.netMinor]));
          for (const { profileId, netMinor } of input) {
            expect(after.get(profileId) ?? 0n).toBe(netMinor);
          }
        }),
        { numRuns: 500 },
      );
    });

    it('never emits more than n-1 transfers', () => {
      fc.assert(
        fc.property(balances, (input) => {
          const active = input.filter((b) => b.netMinor !== 0n).length;
          const transfers = simplifyDebts(input);
          if (active > 0) expect(transfers.length).toBeLessThanOrEqual(active - 1);
          else expect(transfers).toHaveLength(0);
        }),
        { numRuns: 500 },
      );
    });

    it('only ever moves money from debtors to creditors, never zero amounts', () => {
      fc.assert(
        fc.property(balances, (input) => {
          const net = new Map(input.map((b) => [b.profileId, b.netMinor]));
          for (const t of simplifyDebts(input)) {
            expect(t.amountMinor > 0n).toBe(true);
            expect(t.from).not.toBe(t.to);
            expect(net.get(t.from)! < 0n).toBe(true);
            expect(net.get(t.to)! > 0n).toBe(true);
          }
        }),
        { numRuns: 300 },
      );
    });

    it('is deterministic', () => {
      fc.assert(
        fc.property(balances, (input) => {
          expect(simplifyDebts(input)).toEqual(simplifyDebts(input));
        }),
        { numRuns: 200 },
      );
    });
  });
});
