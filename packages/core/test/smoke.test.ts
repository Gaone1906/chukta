import { describe, expect, it } from 'vitest';
import { CORE_PLACEHOLDER } from '../src/index.js';

// Placeholder so CI is green before Phase 2 lands. Delete once split.test.ts exists.
describe('@hisaab/core', () => {
  it('is wired into the workspace', () => {
    expect(CORE_PLACEHOLDER).toBe(true);
  });
});
