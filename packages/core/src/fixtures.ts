/**
 * Canonical allocation fixtures — the contract between this package and the plpgsql
 * implementation in `supabase/migrations/0006_money_functions.sql`.
 *
 * Phase 3 loads these into pgTAP and asserts `app.allocate_minor` produces byte-identical
 * output. They must agree exactly: the client computes a live split preview offline, and if
 * the server then allocates the leftover paisa to a different person, the same expense shows
 * different numbers on two devices.
 *
 * Cases are chosen to exercise the parts where two implementations most easily diverge:
 * remainders, tiebreak order, negatives, and zero weights.
 */

export interface AllocationFixture {
  name: string;
  total: bigint;
  weights: bigint[];
  keys: string[];
  expected: bigint[];
}

export const ALLOCATION_FIXTURES: readonly AllocationFixture[] = [
  {
    name: 'equal three ways, one paisa left over',
    total: 10000n,
    weights: [1n, 1n, 1n],
    keys: ['a', 'b', 'c'],
    expected: [3334n, 3333n, 3333n],
  },
  {
    name: 'equal three ways, keys out of order — tiebreak must still pick a and b',
    total: 10001n,
    weights: [1n, 1n, 1n],
    keys: ['c', 'a', 'b'],
    expected: [3333n, 3334n, 3334n],
  },
  {
    name: 'clean two-to-one split',
    total: 30000n,
    weights: [2n, 1n],
    keys: ['a', 'b'],
    expected: [20000n, 10000n],
  },
  {
    name: 'weights that do not divide evenly',
    total: 100n,
    weights: [1n, 1n, 1n, 1n, 1n, 1n, 1n],
    keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    expected: [15n, 15n, 14n, 14n, 14n, 14n, 14n],
  },
  {
    name: 'zero-weight participant gets nothing',
    total: 100n,
    weights: [1n, 0n, 1n],
    keys: ['a', 'b', 'c'],
    expected: [50n, 0n, 50n],
  },
  {
    name: 'negative total (a refund) still sums exactly',
    total: -10000n,
    weights: [1n, 1n, 1n],
    keys: ['a', 'b', 'c'],
    expected: [-3333n, -3333n, -3334n],
  },
  {
    name: 'single participant takes everything',
    total: 99999n,
    weights: [1n],
    keys: ['solo'],
    expected: [99999n],
  },
  {
    name: 'large weights, remainder decided by weight before key',
    total: 1000n,
    weights: [333333n, 333333n, 333334n],
    keys: ['a', 'b', 'c'],
    expected: [333n, 333n, 334n],
  },
  {
    name: 'percentage-style weights scaled to six decimal places',
    total: 10001n,
    weights: [33_330_000n, 33_330_000n, 33_340_000n],
    keys: ['a', 'b', 'c'],
    expected: [3333n, 3333n, 3335n],
  },
  {
    name: 'amount beyond Number.MAX_SAFE_INTEGER',
    total: 9007199254740993n,
    weights: [1n, 1n],
    keys: ['a', 'b'],
    expected: [4503599627370497n, 4503599627370496n],
  },
];

/** Serialisable form for the SQL side, which has no BigInt literal syntax. */
export function fixturesAsJson(): string {
  return JSON.stringify(
    ALLOCATION_FIXTURES.map((f) => ({
      name: f.name,
      total: f.total.toString(),
      weights: f.weights.map(String),
      keys: f.keys,
      expected: f.expected.map(String),
    })),
    null,
    2,
  );
}
