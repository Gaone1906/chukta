import type { HomePerson } from '@/lib/api';

import { deltaFor, type PendingEffect } from './effects';
import type { PendingPerson } from './OfflineProvider';

/**
 * The people the app knows about, including the ones only this device knows about yet.
 *
 * `get_home_summary` is the server's answer to "who are my people", and every screen that
 * lists a person reads it — Home's People tab, the expense picker, the new-group roster. Which
 * means somebody named while offline is invisible in all three, because the server has not
 * been told they exist.
 *
 * That is the same failure migration 0022 fixed for the online case, where naming a friend
 * made a row nothing could see. It is worth restating the lesson it came with, because the
 * offline layer reintroduces exactly the same shape: **a person you have created who does not
 * appear anywhere is not a person you can split anything with.**
 *
 * Balances are folded in at the same time, for the same reason — a person's figure has to
 * include the expense you just put on them, or the row says ₹0 next to an expense you can see.
 */
export function withPendingPeople(
  known: readonly HomePerson[],
  pending: readonly PendingPerson[],
  effects: readonly PendingEffect[],
): HomePerson[] {
  const merged: HomePerson[] = known.map((person) => ({
    ...person,
    net_minor: person.net_minor + deltaFor(effects, 'person', person.id),
  }));

  // The queued person may already be in the summary — the drain landed and a refetch brought
  // them back before the outbox row was cleared, or two devices added them. Server first.
  const seen = new Set(merged.map((p) => p.id));

  for (const person of pending) {
    if (seen.has(person.id)) continue;
    merged.push({
      id: person.id,
      display_name: person.displayName,
      avatar_url: null,
      is_placeholder: true,
      shared_group_count: 0,
      net_minor: deltaFor(effects, 'person', person.id),
    });
  }

  return merged.sort((a, b) => a.display_name.localeCompare(b.display_name));
}
