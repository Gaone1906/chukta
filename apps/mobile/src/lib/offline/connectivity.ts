import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';

/**
 * Whether there is a network, and telling TanStack Query about it.
 *
 * Without this the app believes it is always online. React Query's default `onlineManager` on
 * React Native never fires, so queries keep retrying into a void and mutations fail at the tap
 * instead of pausing — which is the opposite of what an app used in restaurants and on trains
 * should do.
 *
 * **Connectivity here is a hint, never a gate.** The drainer attempts a send whenever it has
 * work, regardless of what this reports, and treats a failure as a retry. That is deliberate:
 * `isInternetReachable` means different things on the two platforms — on iOS it is simply a
 * copy of `isConnected`, while Android derives it from `NET_CAPABILITY_VALIDATED` — and
 * "connected to a wifi network" was never the same question as "the server answers". A captive
 * portal reports a perfectly good connection. So this drives the indicator and schedules a
 * drain attempt; it does not decide whether a write is allowed to be tried.
 */

export interface Connectivity {
  /** The radio says there is a network. */
  isConnected: boolean;
  /** The OS believes that network reaches the internet. iOS just mirrors `isConnected`. */
  isReachable: boolean;
}

const OPTIMISTIC: Connectivity = { isConnected: true, isReachable: true };

let current: Connectivity = OPTIMISTIC;
const listeners = new Set<(state: Connectivity) => void>();

function toConnectivity(state: Network.NetworkState): Connectivity {
  // Both fields are optional in the type and can arrive undefined on the first event. Assuming
  // online when we do not know is the right default — the cost of being wrong is one failed
  // request that retries, whereas assuming offline would show an "offline" banner to someone
  // who is not.
  const isConnected = state.isConnected ?? true;
  return {
    isConnected,
    isReachable: isConnected && (state.isInternetReachable ?? true),
  };
}

function publish(next: Connectivity): void {
  if (next.isConnected === current.isConnected && next.isReachable === current.isReachable) {
    return;
  }
  current = next;
  onlineManager.setOnline(next.isConnected);
  for (const listener of listeners) listener(next);
}

export function getConnectivity(): Connectivity {
  return current;
}

export function subscribeToConnectivity(listener: (state: Connectivity) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start watching. Called once, from the offline provider.
 *
 * `onlineManager.setEventListener` wants a subscribe function returning an unsubscribe, which
 * is exactly the shape `addNetworkStateListener` already has.
 */
export function startConnectivityWatch(): () => void {
  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) => {
      const next = toConnectivity(state);
      current = next;
      setOnline(next.isConnected);
      for (const listener of listeners) listener(next);
    });
    return () => subscription.remove();
  });

  // The listener only fires on *change*, so ask once for where we are starting from.
  void Network.getNetworkStateAsync()
    .then((state) => publish(toConnectivity(state)))
    .catch(() => {
      // Never seen a state: stay optimistic rather than claiming to be offline.
    });

  return () => {
    listeners.clear();
  };
}
