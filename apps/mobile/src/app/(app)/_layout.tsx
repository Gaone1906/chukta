import { Stack } from 'expo-router';

import { RippleNavProvider } from '@/design';

/**
 * A route group needs its own layout to be navigable — without this file, `(app)/index.tsx`
 * registers as `/` but renders nothing, which looks exactly like a crash.
 *
 * `animation: 'none'` is deliberate: the ripple IS the transition. With the Stack's own fade
 * left on, the two run at once — the veil starts dissolving while the native fade is still
 * cross-fading the outgoing screen, so the old screen shows through the gap for a frame or
 * two. Swapping instantly under an opaque veil is the whole point of covering the screen
 * first.
 *
 * Back navigation is therefore instant too. That is the right trade: a back gesture is a
 * retreat to somewhere the user has already seen, and the ripple is reserved for going
 * forward into something new.
 */
export default function AppLayout() {
  return (
    <RippleNavProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'none',
        }}
      />
    </RippleNavProvider>
  );
}
