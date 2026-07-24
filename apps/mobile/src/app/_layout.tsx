import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Placeholder root layout. Phase 1 replaces this with the AmbientBackground + the ripple
// transition navigator; Phase 4 adds the (auth) / (app) route groups.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0405' } }} />
    </>
  );
}
