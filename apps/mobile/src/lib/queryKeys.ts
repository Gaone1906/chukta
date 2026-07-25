/**
 * Every query key in one place.
 *
 * Scattering key literals across screens makes invalidation guesswork: a mutation invalidates
 * what it remembers to, and a balance somewhere else goes quietly stale. Balances here are
 * derived from shared views, so the same expense affects Home, its group AND both people —
 * `afterExpenseChange` exists so no call site has to remember that.
 */
export const queryKeys = {
  home: () => ['home'] as const,
  group: (groupId: string) => ['group', groupId] as const,
  person: (profileId: string) => ['person', profileId] as const,
  expense: (expenseId: string) => ['expense', expenseId] as const,
  simplifiedDebts: (groupId: string) => ['simplified-debts', groupId] as const,
  contacts: (search: string) => ['contacts', search] as const,
  notificationPrefs: () => ['notification-prefs'] as const,
};

/**
 * Writing an expense moves balances on every screen that shows one. Rather than have each
 * mutation list its own set — and inevitably miss one — invalidate the lot.
 *
 * These are cheap: `get_home_summary` is a single round trip, and the detail screens only
 * refetch if they are currently mounted.
 */
export function afterExpenseChange(groupId: string | null | undefined): unknown[][] {
  const keys: unknown[][] = [[...queryKeys.home()], ['person'], ['expense']];
  if (groupId) {
    keys.push([...queryKeys.group(groupId)], [...queryKeys.simplifiedDebts(groupId)]);
  } else {
    // A one-off expense belongs to no group, but it still changes a pair balance, so every
    // group summary that includes those people could move.
    keys.push(['group'], ['simplified-debts']);
  }
  return keys;
}
