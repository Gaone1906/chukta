import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { createMMKV } from 'react-native-mmkv';

import { parse, stringify } from './serialize';

/**
 * The read cache that survives a cold start.
 *
 * Every screen here is fed by one RPC returning the whole screen with its balances already
 * computed — so persisting those responses verbatim *is* the offline read story. Open the app
 * on a plane and Home, every group, every person and every expense you had looked at are all
 * there, showing the last thing the server said, which is the correct thing to show.
 *
 * MMKV rather than SQLite for this one: it is memory-mapped and synchronous underneath, so the
 * restore happens in a frame instead of showing empty screens while a read resolves. Same
 * argument as the Supabase session in `lib/supabase.ts` — and a different instance id, because
 * a cache wipe must never take the auth session with it.
 *
 * The outbox stays in SQLite. These are genuinely different problems: the cache is one blob
 * rewritten wholesale on a throttle and is disposable, while the queue needs ordering,
 * per-row updates and a transaction, and losing it loses somebody's money.
 */

const storage = createMMKV({ id: 'hisaab-query-cache' });

const mmkvAsyncStorage = {
  getItem: async (key: string) => storage.getString(key) ?? null,
  setItem: async (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: async (key: string) => {
    storage.remove(key);
  },
};

/**
 * Bump when the on-disk shape changes.
 *
 * A cache written by an older serializer would be handed to a newer deserializer and come back
 * subtly wrong rather than failing — tagged bigints reading back as plain objects, say, which
 * would render as `[object Object]` where a balance should be. `buster` makes that a discard
 * instead of a corruption.
 */
export const CACHE_BUSTER = 'v1-bigint-tagged';

/**
 * Fourteen days. Long enough that a phone left alone for a fortnight still opens with
 * something to look at, short enough that genuinely ancient balances are not presented as if
 * they were current. Anything restored is refetched the moment there is a network anyway.
 */
export const CACHE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;

export const queryPersister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: 'hisaab-query-cache',
  // The default is 1s. Writes here are a full re-serialisation of every cached screen, and
  // they happen on every query settle, so throttling matters more than freshness — nothing
  // reads this file until the next cold start.
  throttleTime: 2000,
  // The whole reason this file exists. `JSON.stringify` throws on the bigints that every
  // balance in this app is made of, and TanStack swallows that throw — the cache would simply
  // never be written, with no crash and nothing in the log to explain it.
  serialize: (client: PersistedClient) => stringify(client),
  deserialize: (cached: string) => parse<PersistedClient>(cached),
});

/** Drop the cached reads. Sign-out, and switching accounts. */
export function clearQueryCache(): void {
  storage.clearAll();
}
