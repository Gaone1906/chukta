import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EdgeVignette, RippleNavProvider } from '@/design';

/**
 * A route group needs its own layout to be navigable — without this file, `(app)/index.tsx`
 * registers as `/` but renders nothing, which looks exactly like a crash.
 *
 * ---------------------------------------------------------------- why there IS an animation now
 *
 * This used to be `animation: 'none'`, on the reasoning that the ripple IS the transition and a
 * native animation running underneath it would show the old screen through the gap. The first
 * half of that is right; the conclusion was wrong, and it cost the back gesture entirely.
 *
 * `gestureEnabled` and `animation` are independent in react-native-screens' native code
 * (`RNSScreenStack.mm`): the swipe recognizer fires and pops regardless. But `animation: 'none'`
 * hard-codes `transitionDuration` to 0 (`RNSScreenStackAnimator.mm`), so an interactive
 * back-swipe had a zero-second animation to interpolate against. The gesture was working the
 * whole time — it just had nothing to draw, which reads as an instant cut.
 *
 * So the push keeps its cover: it plays under an opaque veil where nobody can see it, and the
 * only requirement on it is that it FINISHES before the veil dissolves. `animationDuration` is
 * what makes that checkable — the iOS default is 500ms, which would outlast any sane hold and
 * peek out mid-dissolve (the exact stutter that motivated `'none'`). Pinned at 300 against a
 * 360ms hold, it lands with 60ms to spare. `rippleMath.test.ts` asserts that margin so the two
 * numbers cannot drift apart silently.
 *
 * `slide_from_right` rather than `default` because `animationDuration` is ignored by `default`
 * and `flip`. Going back now slides, and can be dragged.
 *
 * **Android gets the animated pop but not the swipe** — expo-router hard-codes
 * `gestureEnabled: false` there (`NativeStackView.native.js`), and `app.config.ts` already sets
 * `predictiveBackGestureEnabled: false`. The hardware back button is the affordance there.
 */
export default function AppLayout() {
  return (
    <RippleNavProvider>
      {/*
        * The vignette is mounted ONCE here rather than per screen, for the same reason the
        * ambient background is mounted once at the root: it belongs to every screen in the
        * group, and per-screen copies are a thing to forget on the next screen someone adds.
        *
        * Position in the tree is load-bearing. It is a sibling of the navigator and painted
        * after it, so it covers screen content — and it is INSIDE `RippleNavProvider`, whose
        * veil is a later sibling still, so a transition covers the vignette rather than the
        * vignette showing through the veil. See `RippleNav.tsx`.
        *
        * Sheets are unaffected: they are RN `Modal`s, which are their own window on iOS.
        */}
      <View style={styles.stack}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'slide_from_right',
            // iOS only. Kept below motion.ripple.hold — see the note above.
            animationDuration: 300,
            gestureEnabled: true,
            // The whole screen is draggable, not just the left edge. This app has no back
            // button on most screens, so an edge-only gesture would be the only way back and
            // would be undiscoverable.
            fullScreenGestureEnabled: true,
            // Maps to `customAnimationOnSwipe`: without it the drag falls back to the platform
            // default animation instead of the one configured above, so a half-completed swipe
            // and a completed one would not look like the same gesture.
            animationMatchesGesture: true,
          }}
        />
        <EdgeVignette edge="top" />
      </View>
    </RippleNavProvider>
  );
}

const styles = StyleSheet.create({ stack: { flex: 1 } });
