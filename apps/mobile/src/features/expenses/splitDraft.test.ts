import { describe, expect, it } from 'vitest';

import { computeDraftShares, emptySplitState, includedIds, type SplitState } from './splitDraft';

/**
 * The rule these tests exist to protect: **who is on an expense is derived from who is on the
 * screen**, never from a snapshot taken at some earlier moment.
 *
 * The bug that motivated them shipped and was seen in the wild — an expense saved with the
 * signed-in person missing from their own split, because the participant list was captured
 * before their profile had resolved. It netted to zero, moved nobody's balance, and looked
 * exactly like a save that had failed.
 */

const A = 'aaaaaaaa-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';
const C = 'cccccccc-0000-0000-0000-000000000000';

describe('includedIds', () => {
  it('includes everyone who has not been explicitly removed', () => {
    expect(includedIds([A, B, C], emptySplitState())).toEqual([A, B, C]);
  });

  it('picks up a participant who arrives after the split state was created', () => {
    const state = emptySplitState();
    // The roster the form was constructed with…
    expect(includedIds([B], state)).toEqual([B]);
    // …and the same state once the signed-in profile lands a beat later.
    expect(includedIds([A, B], state)).toEqual([A, B]);
  });

  it('keeps a deselection across a roster change', () => {
    const state: SplitState = { ...emptySplitState([B]), type: 'equal' };
    expect(includedIds([A, B], state)).toEqual([A]);
    expect(includedIds([A, B, C], state)).toEqual([A, C]);
  });

  it('ignores a deselection for someone no longer on the roster', () => {
    expect(includedIds([A], emptySplitState([B, C]))).toEqual([A]);
  });
});

describe('computeDraftShares', () => {
  it('splits across a late-arriving participant rather than leaving them out', () => {
    const state = emptySplitState();

    const early = computeDraftShares(10000n, state, [B]);
    expect(early.shares && [...early.shares]).toEqual([[B, 10000n]]);

    const late = computeDraftShares(10000n, state, [A, B]);
    expect(late.shares && [...late.shares]).toEqual([
      [A, 5000n],
      [B, 5000n],
    ]);
  });

  it('allocates the remainder rather than losing it — the prototype rounding bug', () => {
    const { shares } = computeDraftShares(10000n, emptySplitState(), [A, B, C]);
    expect(shares && [...shares.values()]).toEqual([3334n, 3333n, 3333n]);
    expect([...shares!.values()].reduce((a, b) => a + b, 0n)).toBe(10000n);
  });

  it('refuses a split with nobody in it', () => {
    const { shares, error } = computeDraftShares(10000n, emptySplitState([A, B]), [A, B]);
    expect(shares).toBeNull();
    expect(error).toMatch(/at least one person/i);
  });

  it('leaves a deselected person out of an exact split', () => {
    const state: SplitState = {
      ...emptySplitState([C]),
      type: 'exact',
      exact: { [A]: '60', [B]: '40', [C]: '999' },
    };
    const { shares } = computeDraftShares(10000n, state, [A, B, C]);
    expect(shares && [...shares]).toEqual([
      [A, 6000n],
      [B, 4000n],
    ]);
  });

  it('says nothing at all before an amount is entered', () => {
    expect(computeDraftShares(0n, emptySplitState(), [A, B])).toEqual({
      shares: null,
      error: null,
    });
  });
});
