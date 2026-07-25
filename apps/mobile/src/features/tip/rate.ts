import * as StoreReview from 'expo-store-review';
import { Linking } from 'react-native';

/**
 * "Rate Hisaab" — the same three-step ladder the tip jar uses for its RevenueCat seam, so this
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
 * a button the design asks for, and it resolves in our favour: a user who taps "Rate Hisaab" in
 * the tip jar has gone looking for it, which is about as close to intent as this gets. What we
 * must not do is call this on a timer or after N expenses.
 */
export type RateOutcome = 'requested' | 'store' | 'unavailable';

export function storeUrl(): string | null {
  return process.env.EXPO_PUBLIC_STORE_URL || null;
}

export async function rateApp(): Promise<RateOutcome> {
  // `hasAction()` folds in "is there anywhere at all to send them" — on iOS it is true when the
  // review API is usable, on Android when either that or a store URL exists.
  if (await StoreReview.isAvailableAsync()) {
    try {
      await StoreReview.requestReview();
      return 'requested';
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
