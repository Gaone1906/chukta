import { Stack } from 'expo-router';

/**
 * A route group needs its own layout to be navigable — without this file, `(app)/index.tsx`
 * registers as `/` but renders nothing, which looks exactly like a crash.
 *
 * Phase 5 replaces the plain Stack here with the ripple transition navigator.
 */
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
        animation: 'fade',
      }}
    />
  );
}
