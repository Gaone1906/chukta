import { Stack } from 'expo-router';

import { RippleNavProvider } from '@/design';

/**
 * A route group needs its own layout to be navigable — without this file, `(app)/index.tsx`
 * registers as `/` but renders nothing, which looks exactly like a crash.
 *
 * The Stack's own animation stays 'fade' rather than 'none': the ripple covers pushes that go
 * through `useRippleNav`, but back gestures and any plain navigation still need something, and
 * a fade under an opaque veil is invisible anyway.
 */
export default function AppLayout() {
  return (
    <RippleNavProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      />
    </RippleNavProvider>
  );
}
