import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { motion } from '@/design/tokens';
import { syncPull } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useSession } from '@/features/auth/session';

import {
  getConnectivity,
  startConnectivityWatch,
  subscribeToConnectivity,
  type Connectivity,
} from './connectivity';
import { clearLocalDatabase } from './database';
import { drainOutbox, retryDelayMs } from './drain';
import type { PendingEffect } from './effects';
import { clearQueryCache } from './persister';
import { applyChangeEvent, subscribeToChanges, type ChangeSubscription } from './realtime';
import {
  counts,
  listUnresolved,
  nextPending,
  pendingByOp,
  pendingEffects,
  type OutboxRow,
} from './outbox';
import { advanceCursor, getCursor, getOwner, resetCursor, setOwner } from './syncState';

/**
 * Everything offline, wired together and pointed at the rest of the app.
 *
 * ---------------------------------------------------------------- the reconnect order
 *
 * **Drain the outbox → pull deltas → resubscribe.** Fixed, and each step is in that position
 * for a reason rather than by habit:
 *
 *   - Pulling first would overwrite local optimistic state with server rows that do not yet
 *     know about the writes sitting in the queue — the expense you added on the plane would
 *     visibly vanish, then reappear a second later.
 *   - Subscribing first would race the drain: the broadcast for your own write could land
 *     while the queue still holds it, and the invalidation it triggers would refetch a server
 *     that has only some of your writes.
 *
 * ---------------------------------------------------------------- the queue belongs to a person
 *
 * Its idempotency keys, its balance overlays and its cursor into a per-recipient event stream
 * are all one account's. So the owner is checked on every session change, and a different one
 * means wiping both the queue and the cached reads — not merging them.
 */

export interface PendingPerson {
  id: string;
  displayName: string;
}

interface OfflineState {
  connectivity: Connectivity;
  /** Queued writes, by how they are stuck. */
  counts: { pending: number; conflict: number; failed: number };
  /** Balance movement from everything not yet acknowledged, summed per person and group. */
  effects: PendingEffect[];
  /** People named locally whom the server has not seen yet. */
  pendingPeople: PendingPerson[];
  /** Rows needing a decision — the conflict inbox reads this. */
  unresolved: OutboxRow[];
  /** Re-read the queue. Call after enqueueing so the badges move in the same frame. */
  refresh: () => void;
  /** Try the queue now. Safe to call whenever; re-entrant calls join the run in progress. */
  sync: () => void;
}

const OfflineContext = createContext<OfflineState | null>(null);

/**
 * How long a screen-initiated sync waits before it starts work.
 *
 * The ripple's own length, so a drain never competes with the transition the same tap began.
 */
const SYNC_AFTER_TRANSITION_MS = motion.ripple.duration;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { session, profile, loading } = useSession();

  const [connectivity, setConnectivity] = useState<Connectivity>(getConnectivity);
  const [version, setVersion] = useState(0);

  const channelRef = useRef<ChangeSubscription | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The sequence reschedules itself when the network is down, and a `useCallback` cannot name
   * itself inside its own body. The ref is always the current one, which also means a pending
   * timer fires the latest version rather than a closure captured an hour ago.
   */
  const runSyncRef = useRef<(() => Promise<void>) | null>(null);

  /*
   * Coalesced, because the alternative lands on the ripple's first frame.
   *
   * `refresh` re-runs FOUR synchronous SQLite reads — counts(), pendingEffects(),
   * pendingByOp() and listUnresolved() — and re-renders every screen holding `useOffline()`.
   * That is the heaviest JS frame in the app.
   *
   * And it used to fire in bursts. Saving an expense calls `refresh()` then `sync()` in the
   * same handler as the navigation, and the drainer then reports progress again after marking
   * a row sending, after completing it, and once per terminal branch — each in its own
   * post-await task, so React could not batch any of them. N queued writes produced 2N of
   * these renders, landing squarely inside the transition the same tap had just started.
   *
   * One bump per 16ms collapses the whole burst into a single render. A timeout rather than
   * requestAnimationFrame on purpose: rAF does not fire while the app is backgrounded, and a
   * bump scheduled just before backgrounding would leave the flag set and the counts frozen.
   */
  const bumpScheduled = useRef(false);

  const refresh = useCallback(() => {
    if (bumpScheduled.current) return;
    bumpScheduled.current = true;
    setTimeout(() => {
      bumpScheduled.current = false;
      setVersion((n) => n + 1);
    }, 16);
  }, []);

  // ------------------------------------------------------------ connectivity

  useEffect(() => {
    const stop = startConnectivityWatch();
    const unsubscribe = subscribeToConnectivity(setConnectivity);
    return () => {
      unsubscribe();
      stop();
    };
  }, []);

  // ------------------------------------------------------------ the sequence

  const runSync = useCallback(async () => {
    if (!profile) return;

    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    // 1. Drain. Nothing else may run until the server has been told what we already decided.
    const outcome = await drainOutbox(refresh);
    refresh();

    /*
     * Refetch what the drain made true, now that it IS true.
     *
     * Most writes need nothing here: they emit change events, so step 2's pull carries them and
     * `applyChangeEvent` invalidates precisely. `upsert_contact_profile` emits none — creating a
     * placeholder is not news to anybody else — and that gap produced a real bug.
     *
     * The screen that names somebody used to invalidate the roster in the same handler that
     * enqueued the write. But `sync` is deliberately deferred a full `motion.ripple.duration` so
     * the drain does not land on the transition's opening frames, so the refetch beat the write
     * to the server by ~850ms EVERY time, and cached a roster that predated the person for the
     * full 60-second `staleTime`. When the outbox row was then deleted, they were in neither
     * source and the expense form showed "Someone" — a nameless stranger on the screen where
     * money is decided.
     *
     * Invalidating here instead is the fix, and it is the general one: the roster is refetched
     * when the person exists, not when we hoped they would.
     */
    if (outcome.sentOps.includes('upsert_contact_profile')) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.home() });
    }

    if (outcome.blockedBy === 'offline') {
      // No network. Pulling would fail the same way, so schedule and stop — a reconnect or a
      // foreground will also come back through here.
      //
      // The delay comes from how many times THIS row has been tried, not from how many rows
      // are waiting. Passing the queue length was a real bug: with one stuck write it is
      // always 1, so the backoff never grew and the app retried every two seconds
      // indefinitely. Caught by watching `attempts` reach 23 inside ninety seconds.
      const head = nextPending();
      retryTimer.current = setTimeout(
        () => void runSyncRef.current?.(),
        retryDelayMs(head?.attempts ?? 1),
      );
      return;
    }

    // 2. Catch up on everything that happened while we were away.
    try {
      const pull = await syncPull(getCursor());

      if (pull.full_resync) {
        // The cursor fell outside retention — a phone that has been in a drawer for a month.
        // Throwing the whole cache away is cheaper and safer than trying to work out what was
        // missed, and every screen refetches on its next render anyway.
        resetCursor();
        await queryClient.invalidateQueries();
      } else {
        for (const event of pull.events) applyChangeEvent(queryClient, event);
      }
      advanceCursor(pull.cursor);
    } catch {
      // A failed pull is not fatal: the cursor does not move, so the next attempt asks for the
      // same window again. Nothing is lost, it is just not fresh yet.
      return;
    }

    // 3. Only now start listening, with the local state already reconciled.
    if (!channelRef.current) {
      channelRef.current = subscribeToChanges(profile.id, (event) => {
        applyChangeEvent(queryClient, event);
        advanceCursor(event.event_id);
      });
    }
  }, [profile, queryClient, refresh]);

  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  /**
   * Start the sequence after this render, never during it.
   *
   * The drainer reports progress by bumping `version` — including synchronously, before its
   * first await, when it marks the head row as sending. Calling it straight from an effect
   * body would therefore set state mid-effect and re-render inside the same pass. A zero
   * timeout is the whole fix, and it also makes cancellation trivial: the cleanup drops a
   * pending kick when the profile changes underneath it.
   */
  const kickSync = useCallback((delayMs = 0) => {
    const timer = setTimeout(() => void runSyncRef.current?.(), delayMs);
    return () => clearTimeout(timer);
  }, []);

  // ------------------------------------------------------------ lifecycle

  useEffect(() => {
    /*
     * **Wait for the session to be read before concluding anything.**
     *
     * `session` is null for the first render of every cold start, while the persisted session
     * is still being pulled out of storage. Without this guard that read as "signed out", and
     * the branch below wiped the outbox — so every single launch destroyed whatever writes
     * were queued, silently, before the user saw a frame. An expense entered on a plane would
     * simply not exist the next time the app opened.
     *
     * The root navigator already waits on exactly this flag, with a comment about bouncing to
     * login and back. Same trap, much worse consequence: that one costs a flicker, this one
     * costs somebody's money. It cannot be found by reading the code — the wipe is correct in
     * isolation, and so is the loading state.
     */
    if (loading) return;

    if (!session) {
      // Genuinely signed out. Drop the channel, and the local state with it — see the note at
      // the top about the queue belonging to a person.
      channelRef.current?.unsubscribe();
      channelRef.current = null;
      clearLocalDatabase();
      clearQueryCache();
      // Deferred out of the effect body: the counts are read from SQLite on each bump, and
      // bumping synchronously here would re-render mid-effect for a one-shot cleanup.
      queueMicrotask(refresh);
      return;
    }

    // Signed in but the profile has not resolved yet — mid-onboarding, or a launch where the
    // profile request has not come back. Nothing to do, and emphatically nothing to delete.
    if (!profile) return;

    const owner = getOwner();
    if (owner && owner !== profile.id) {
      clearLocalDatabase();
      clearQueryCache();
      void queryClient.invalidateQueries();
    }
    setOwner(profile.id);

    const cancelKick = kickSync();

    return () => {
      cancelKick();
      channelRef.current?.unsubscribe();
      channelRef.current = null;
    };
  }, [loading, session, profile, queryClient, refresh, kickSync]);

  // Reconnecting is the single most likely moment for the queue to have work to do.
  useEffect(() => {
    if (!connectivity.isConnected) return;
    return kickSync();
  }, [connectivity.isConnected, kickSync]);

  // Coming back to the app is the other one — a websocket dropped while backgrounded leaves no
  // trace until something asks.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSyncRef.current?.();
    });
    return () => subscription.remove();
  }, []);

  // ------------------------------------------------------------ what screens read

  const value = useMemo<OfflineState>(() => {
    // Read straight from SQLite on each bump rather than mirroring the queue into React state.
    // These are indexed reads of a table that holds single digits of rows in normal use, and
    // one source of truth beats two that can disagree.
    void version;
    return {
      connectivity,
      counts: counts(),
      effects: pendingEffects(),
      pendingPeople: pendingByOp('upsert_contact_profile').map((row) => {
        const payload = row.payload as { displayName: string; profileId: string };
        return { id: payload.profileId, displayName: payload.displayName };
      }),
      unresolved: listUnresolved(),
      refresh,
      /*
       * Deferred past the transition.
       *
       * Screens call this from the same handler that navigates, so running it immediately puts
       * a drain — SQLite writes, a network request, and the re-renders its progress reports
       * cause — directly on top of the ripple's opening frames. Nothing is waiting on it: the
       * write is already durable in the outbox by the time this is called, and flushing it a
       * third of a second later is invisible.
       *
       * The lifecycle triggers (sign-in, reconnect, foreground) still kick immediately; only
       * the ones a person's tap can cause are held back.
       */
      sync: () => kickSync(SYNC_AFTER_TRANSITION_MS),
    };
  }, [connectivity, version, refresh, kickSync]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/**
 * Falls back to an empty, always-online state outside a provider, so a screen rendered in
 * isolation — a test, the kitchen sink — still works instead of throwing.
 */
export function useOffline(): OfflineState {
  return (
    useContext(OfflineContext) ?? {
      connectivity: { isConnected: true, isReachable: true },
      counts: { pending: 0, conflict: 0, failed: 0 },
      effects: [],
      pendingPeople: [],
      unresolved: [],
      refresh: () => {},
      sync: () => {},
    }
  );
}
