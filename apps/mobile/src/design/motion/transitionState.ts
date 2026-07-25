import { makeMutable, type SharedValue } from 'react-native-reanimated';

/**
 * Whether a screen transition is playing right now, as a shared value.
 *
 * A module-level mutable rather than context, because the two things that need to agree about
 * it sit on opposite sides of the navigator: `AmbientBackground` is mounted once in the root
 * layout, ABOVE the router, and `RippleNavProvider` lives inside the `(app)` group below it.
 * There is no provider that could contain both without moving the ambience into the navigator,
 * which would restart its drift on every navigation — the one thing its comment says not to do.
 *
 * It is a shared value rather than React state for the more important reason: reading it must
 * never cause a render. The whole point of the rewrite was that a navigation stopped
 * re-rendering the tree, and a `useState` flag here would put that straight back.
 */
export const isTransitioning: SharedValue<boolean> = makeMutable(false);
