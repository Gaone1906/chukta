import { describe, expect, it } from 'vitest';

import {
  deltaFor,
  effectsOfCreate,
  effectsOfDelete,
  effectsOfSettlement,
  effectsOfUpdate,
  merge,
  type ExpenseShape,
} from './effects';
import { parse, stringify } from './serialize';

/**
 * The two pure pieces of the offline layer, which are also the two that would fail silently.
 *
 * A serializer that drops a bigint does not crash — TanStack swallows the throw and the cache
 * simply never writes. And a balance overlay with an inverted sign does not crash either; it
 * shows somebody owing you money they do not owe. Both need to be pinned by tests rather than
 * by looking at them.
 */

const ME = 'me';
const OTHER = 'other';
const THIRD = 'third';

/** I paid the whole ₹1,000 and we split it evenly, so they owe me ₹500. */
const iPaid: ExpenseShape = {
  groupId: 'group-1',
  payers: [{ profileId: ME, paidAmountMinor: 100000n }],
  splits: [
    { profileId: ME, shareAmountMinor: 50000n },
    { profileId: OTHER, shareAmountMinor: 50000n },
  ],
};

describe('pending balance effects', () => {
  it('moves a person and their group by the same amount when I paid', () => {
    const effects = effectsOfCreate(ME, iPaid);

    // Positive means they owe me — the sign get_home_summary returns and the chips render gold.
    expect(deltaFor(effects, 'person', OTHER)).toBe(50000n);
    expect(deltaFor(effects, 'group', 'group-1')).toBe(50000n);
  });

  it('is negative when somebody else paid', () => {
    const theyPaid: ExpenseShape = {
      groupId: 'group-1',
      payers: [{ profileId: OTHER, paidAmountMinor: 100000n }],
      splits: [
        { profileId: ME, shareAmountMinor: 50000n },
        { profileId: OTHER, shareAmountMinor: 50000n },
      ],
    };

    expect(deltaFor(effectsOfCreate(ME, theyPaid), 'person', OTHER)).toBe(-50000n);
  });

  it('ignores debts between two other people', () => {
    const notMine: ExpenseShape = {
      groupId: 'group-1',
      payers: [{ profileId: OTHER, paidAmountMinor: 100000n }],
      splits: [
        { profileId: OTHER, shareAmountMinor: 50000n },
        { profileId: THIRD, shareAmountMinor: 50000n },
      ],
    };

    expect(effectsOfCreate(ME, notMine)).toEqual([]);
  });

  it('records nothing for an expense that moves no balance', () => {
    // The net-zero case the expense form warns about: I paid for my own thing.
    const soloed: ExpenseShape = {
      groupId: null,
      payers: [{ profileId: ME, paidAmountMinor: 50000n }],
      splits: [{ profileId: ME, shareAmountMinor: 50000n }],
    };

    expect(effectsOfCreate(ME, soloed)).toEqual([]);
  });

  it('deleting is the exact inverse of creating', () => {
    const created = effectsOfCreate(ME, iPaid);
    const deleted = effectsOfDelete(ME, iPaid);

    expect(merge([...created, ...deleted])).toEqual([]);
  });

  it('editing applies the difference, not the whole new amount', () => {
    const after: ExpenseShape = {
      ...iPaid,
      payers: [{ profileId: ME, paidAmountMinor: 120000n }],
      splits: [
        { profileId: ME, shareAmountMinor: 60000n },
        { profileId: OTHER, shareAmountMinor: 60000n },
      ],
    };

    // ₹600 owed instead of ₹500 — the overlay carries ₹100, because the cached figure already
    // contains the original ₹500.
    expect(deltaFor(effectsOfUpdate(ME, iPaid, after), 'person', OTHER)).toBe(10000n);
  });

  it('an edit that changes nothing produces no overlay', () => {
    expect(effectsOfUpdate(ME, iPaid, iPaid)).toEqual([]);
  });

  it('paying somebody reduces what I owe them', () => {
    const effects = effectsOfSettlement(ME, {
      groupId: 'group-1',
      fromProfileId: ME,
      toProfileId: OTHER,
      amountMinor: 135000n,
    });

    // I handed over ₹1,350, so my position with them improves by exactly that.
    expect(deltaFor(effects, 'person', OTHER)).toBe(135000n);
  });

  it('being paid moves the other way', () => {
    const effects = effectsOfSettlement(ME, {
      groupId: null,
      fromProfileId: OTHER,
      toProfileId: ME,
      amountMinor: 135000n,
    });

    expect(deltaFor(effects, 'person', OTHER)).toBe(-135000n);
  });

  it('sums several queued writes and drops the ones that cancel', () => {
    const merged = merge([
      { scope: 'person', id: OTHER, deltaMinor: 50000n },
      { scope: 'person', id: OTHER, deltaMinor: -20000n },
      { scope: 'person', id: THIRD, deltaMinor: 30000n },
      { scope: 'person', id: THIRD, deltaMinor: -30000n },
    ]);

    expect(merged).toEqual([{ scope: 'person', id: OTHER, deltaMinor: 30000n }]);
  });
});

describe('bigint-safe JSON', () => {
  it('round-trips a bigint as a bigint, not a string', () => {
    const back = parse<{ amount: bigint }>(stringify({ amount: 432000n }));

    expect(back.amount).toBe(432000n);
    expect(typeof back.amount).toBe('bigint');
  });

  it('survives past 2^53, which is the entire reason money is a bigint here', () => {
    const huge = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    expect(parse<{ v: bigint }>(stringify({ v: huge })).v).toBe(huge);
  });

  it('reaches bigints nested in arrays and objects', () => {
    const draft = {
      amountMinor: 100000n,
      payers: [{ profileId: 'a', paidAmountMinor: 100000n }],
      splits: [
        { profileId: 'a', shareAmountMinor: 50000n },
        { profileId: 'b', shareAmountMinor: 50000n },
      ],
    };

    expect(parse<typeof draft>(stringify(draft))).toEqual(draft);
  });

  it('leaves everything else alone', () => {
    const value = { name: 'Beach shack', when: '2026-07-25', count: 3, ok: true, note: null };
    expect(parse<typeof value>(stringify(value))).toEqual(value);
  });

  it('is what plain JSON cannot do', () => {
    // The failure this file exists to prevent. In the persister TanStack catches this and the
    // cache silently never writes; there is no crash and nothing in the log.
    expect(() => JSON.stringify({ amount: 1n })).toThrow(TypeError);
  });
});
