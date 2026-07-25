import { describe, expect, it } from 'vitest';

import { allocate } from '../src/allocate';
import { ALLOCATION_FIXTURES, fixturesAsJson } from '../src/fixtures';

/**
 * These fixtures are the contract with the plpgsql allocator. If a change here makes a case
 * fail, the SQL side has to move with it — do not "fix" the fixture to match new behaviour
 * without also updating supabase/migrations and its pgTAP test.
 */
describe('allocation fixtures', () => {
  for (const fixture of ALLOCATION_FIXTURES) {
    it(fixture.name, () => {
      const actual = allocate({
        total: fixture.total,
        weights: fixture.weights,
        keys: fixture.keys,
      });
      expect(actual).toEqual(fixture.expected);
      expect(actual.reduce((a, b) => a + b, 0n)).toBe(fixture.total);
    });
  }

  it('serialises to JSON the SQL side can read', () => {
    const parsed = JSON.parse(fixturesAsJson()) as { total: string; expected: string[] }[];
    expect(parsed).toHaveLength(ALLOCATION_FIXTURES.length);
    expect(parsed[0]!.total).toBe('10000');
    // Everything must survive as a decimal string — no scientific notation, no precision loss.
    for (const row of parsed) {
      expect(row.total).toMatch(/^-?\d+$/);
      for (const value of row.expected) expect(value).toMatch(/^-?\d+$/);
    }
  });
});
