import type { QueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { afterExpenseChange, queryKeys } from '@/lib/queryKeys';
import type { ChangeEvent } from '@/lib/api';

/**
 * One subscription. Not five.
 *
 * Supabase's Postgres Changes re-checks RLS per subscriber per row, so subscribing to
 * `expenses`, `expense_splits`, `settlements`, `expense_comments` and `group_members` across
 * every group you are in would be expensive *and* would leave the client reconstructing what
 * happened from five streams of row deltas. Instead the server broadcasts one event per change
 * onto `sync:<my profile id>` — see migration 0023 — and this listens to that.
 *
 * The channel is private, which means the Realtime server authorises the subscribe against the
 * RLS policy on `realtime.messages`: the only topic that policy admits is your own. So there is
 * no filter to get wrong here; the authorisation is the filter.
 */

export interface ChangeSubscription {
  unsubscribe: () => void;
}

export function subscribeToChanges(
  profileId: string,
  onEvent: (event: ChangeEvent) => void,
  onStatus?: (status: string, error?: Error) => void,
): ChangeSubscription {
  const channel = supabase
    .channel(`sync:${profileId}`, { config: { private: true } })
    .on('broadcast', { event: 'change' }, (message) => {
      const raw = message.payload as Record<string, unknown> | undefined;
      if (!raw) return;
      onEvent({
        event_id: Number(raw.event_id ?? 0),
        entity_type: raw.entity_type as ChangeEvent['entity_type'],
        entity_id: String(raw.entity_id),
        op: raw.op as ChangeEvent['op'],
        group_id: (raw.group_id as string | null) ?? null,
        actor_profile_id: (raw.actor_profile_id as string | null) ?? null,
        payload: (raw.payload as Record<string, unknown>) ?? {},
      });
    })
    .subscribe((status, error) => onStatus?.(status, error));

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}

/**
 * What an event does to the cache.
 *
 * **Invalidate, never patch.** The plan says so and it is worth restating why: an expense
 * touches six tables and moves balances on Home, its group, and both people in every pair it
 * creates. Hand-patching a cached figure means reimplementing that fan-out in TypeScript and
 * being wrong about it eventually — and being wrong here means displaying a balance that does
 * not exist. Invalidating costs one round trip and cannot be wrong.
 *
 * Which is also why the events carry no data. A tick tells you to go and ask.
 *
 * Self-echoes are expected, not filtered. Since 0023 the actor is a recipient of their own
 * events, which is what lets a second device on the same account catch up — so the phone that
 * made the change hears about it too. Invalidating twice is a deduplicated refetch; suppressing
 * it would mean tracking which of your own writes you have already applied, and getting that
 * wrong loses an update rather than repeating one.
 */
export function applyChangeEvent(client: QueryClient, event: ChangeEvent): void {
  const invalidate = (key: unknown[]) => {
    void client.invalidateQueries({ queryKey: key });
  };

  switch (event.entity_type) {
    case 'expense':
    case 'settlement':
    // A withdrawn settlement moves exactly the same balances as a recorded one, in the other
    // direction. It is only a distinct type so the server can stay silent about it — see the
    // comment on ChangeEvent in lib/api.ts — and dropping it here would leave the other person
    // looking at a debt that has quietly come back.
    case 'settlement_void':
      for (const key of afterExpenseChange(event.group_id)) invalidate(key);
      break;

    case 'comment': {
      // The only event with a payload worth reading: which expense it belongs to. Comments
      // move no money, so nothing but that one screen needs to change.
      const expenseId = event.payload.expense_id;
      if (typeof expenseId === 'string') invalidate([...queryKeys.expense(expenseId)]);
      break;
    }

    case 'group':
    case 'member':
      invalidate([...queryKeys.home()]);
      if (event.group_id) invalidate([...queryKeys.group(event.group_id)]);
      break;

    case 'profile':
      // A merge repointed somebody's history onto a different profile id. Every screen that
      // names a person can be showing the old one.
      void client.invalidateQueries();
      break;
  }
}
