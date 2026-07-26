import { Linking } from 'react-native';

/**
 * "Rate Chukta" — the same three-step ladder the tip jar uses for its RevenueCat seam, so this
 * lights up at launch with no code change.
 *
 * 1. **The in-app review sheet**, if the OS will show one. This is the good outcome: the user
 *    never leaves the app.
 * 2. **The store listing**, if `EXPO_PUBLIC_STORE_URL` is set. Needed on Android below the
 *    Play In-App Review threshold, and whenever the OS declines (see below).
 * 3. **An honest message**, which is where we are today: there is no listing to rate yet.
 *
 * ---------------------------------------------------------------- the thing to know about (1)
 *
 * **`requestReview()` resolving does NOT mean a prompt appeared.** Both stores ration these —
 * Apple allows roughly three per app per year per device and silently ignores the rest, and
 * Play does the same with its own undisclosed quota. There is no API that reports whether the
 * sheet was shown, by design: knowing would let an app retry until it got through, which is the
 * behaviour the quota exists to stop.
 *
 * So this function can never truthfully say "thanks for rating". It must not show a success
 * toast, and it must not be wired to a button that promises one. Anything that reads as
 * confirmation would be a lie on most taps.
 *
 * `isAvailableAsync()` is the only honest gate available: it reports whether the API exists on
 * this platform and build, not whether a prompt will appear.
 *
 * ---------------------------------------------------------------- and about WHERE it is called
 *
 * Apple's guidelines say not to ask in response to the user pressing a "rate us" button — the
 * prompt is meant to be offered at a natural moment, not on demand. That is a real tension with
 * a button the design asks for, and it resolves in our favour: a user who taps "Rate Chukta" in
 * the tip jar has gone looking for it, which is about as close to intent as this gets. What we
 * must not do is call this on a timer or after N expenses.
 */
export type RateOutcome = 'requested' | 'store' | 'unavailable';

export function storeUrl(): string | null {
  return process.env.EXPO_PUBLIC_STORE_URL || null;
}

/**
 * `expo-store-review`, or null when this build has no such native module.
 *
 * **Required at call time, not imported at module scope, and that is not stylistic.** A
 * top-level `import * as StoreReview from 'expo-store-review'` throws
 * `Cannot find native module 'ExpoStoreReview'` the moment the module is evaluated — and
 * expo-router evaluates every route file eagerly to build its route tree. So on any build
 * without the module compiled in (Expo Go, a dev client from before it was added, a teammate
 * who pulled the branch without rebuilding), that one throw takes down **the entire `(app)`
 * group** and the user gets a blank screen with no route rendered at all.
 *
 * Observed, not theorised: the app blanked exactly this way on a stale dev client. A rating
 * button is the least important thing in the app and must never be able to do that, so the cost
 * of a missing module is capped at "fall through to the store URL".
 */
function storeReview(): typeof import('expo-store-review') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-store-review') as typeof import('expo-store-review');
  } catch {
    return null;
  }
}

export async function rateApp(): Promise<RateOutcome> {
  const review = storeReview();

  if (review !== null) {
    try {
      if (await review.isAvailableAsync()) {
        await review.requestReview();
        return 'requested';
      }
    } catch {
      // The sheet failed to present. Fall through to the listing rather than dead-ending —
      // this is exactly the case the store URL is a fallback for.
    }
  }

  const url = storeUrl();
  if (url) {
    await Linking.openURL(url);
    return 'store';
  }

  return 'unavailable';
}
