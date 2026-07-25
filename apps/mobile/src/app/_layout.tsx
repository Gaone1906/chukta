import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AmbientBackground, color } from '@/design';
import { BlurTargetProvider } from '@/design/blurTarget';
import { useAppFonts } from '@/design/fonts';
import { SessionProvider, useSession } from '@/features/auth/session';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden; nothing to do.
});

export default function RootLayout() {
  const fontsReady = useAppFonts();

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bgBase }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Everything glass can sample lives inside the blur target: the ambient background
            AND the screen content, so a panel over a scrolling list blurs the list too. */}
        <BlurTargetProvider>
          {/* Mounted once, above the navigator: the glass has nothing to refract without it,
              and per-screen mounting would restart the drift on every navigation. */}
          <AmbientBackground />
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </BlurTargetProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading, needsProfileSetup } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Wait until the persisted session has been read, or we bounce to login and back on every
    // cold start.
    if (loading) return;

    const group = segments[0];
    if (group === '_dev') return; // the kitchen sink is reachable regardless of auth

    const inAuthFlow = group === '(auth)';

    if (!session && !inAuthFlow) {
      router.replace('/sign-in');
    } else if (session && needsProfileSetup && segments[1] !== 'profile' && segments[1] !== 'done') {
      // Signed in but onboarding is unfinished — send them to finish it rather than into an
      // app where their name is blank.
      router.replace('/profile');
    } else if (session && !needsProfileSetup && inAuthFlow && segments[1] !== 'done') {
      // `done` is excluded deliberately. Saving the profile clears needsProfileSetup, and
      // without this the guard fires the instant the save lands and redirects straight past
      // the completion screen — the seal moment never plays. That screen navigates onward
      // itself once the stamp has landed.
      router.replace('/');
    }
  }, [loading, session, needsProfileSetup, segments, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Screens must be transparent so the ambient background shows through.
        contentStyle: { backgroundColor: 'transparent' },
        animation: 'fade',
      }}
    />
  );
}
