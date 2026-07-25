import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AmbientBackground, color } from '@/design';
import { BlurTargetProvider } from '@/design/blurTarget';
import { useAppFonts } from '@/design/fonts';
import { SessionProvider, useSession } from '@/features/auth/session';
import { isConflict } from '@/lib/errors';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Balances change when anyone in a shared group adds an expense, so a long stale time
      // would show stale money. Phase 8 replaces polling entirely with the change_events
      // subscription; until then, refetch on focus and keep the window short.
      staleTime: 30_000,
      retry: 2,
    },
    mutations: {
      // Never retry a conflict — the point of P0409 is that the user has to choose. Retrying
      // would just fail again with the same stale revision.
      retry: (count, error) => !isConflict(error) && count < 1,
    },
  },
});

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
          {/*
           * Transparent navigation theme, or the whole app is invisible on iOS.
           *
           * `contentStyle: 'transparent'` on the Stack is not enough: React Navigation also
           * paints its container with `theme.colors.background`, and the default theme's is
           * rgb(242,242,242). On iOS that light grey sits ON TOP of the ambient background —
           * cream text on near-white, the entire design gone. Android happened to escape it,
           * which is why this survived until the first iOS run.
           */}
          <ThemeProvider
            value={{
              ...DarkTheme,
              colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent' },
            }}
          >
            <QueryClientProvider client={queryClient}>
              <SessionProvider>
                <RootNavigator />
              </SessionProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </BlurTargetProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Onboarding lives at these paths. Route groups are stripped from the URL by expo-router. */
const AUTH_PATHS = ['/sign-in', '/phone', '/otp', '/profile', '/done'];

function RootNavigator() {
  const { session, loading, needsProfileSetup } = useSession();
  /*
   * usePathname rather than useSegments: segments is a TUPLE whose length comes from the
   * generated route types, and `.expo/types/` is gitignored — so indexing `segments[1]`
   * typechecks locally and fails in CI, where those types don't exist. A pathname is a plain
   * string either way, and reads better here regardless.
   */
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Wait until the persisted session has been read, or we bounce to login and back on every
    // cold start.
    if (loading) return;

    // The kitchen sink is reachable regardless of auth state.
    if (pathname.startsWith('/_dev')) return;

    const inAuthFlow = AUTH_PATHS.includes(pathname);

    if (!session && !inAuthFlow) {
      router.replace('/sign-in');
    } else if (session && needsProfileSetup && pathname !== '/profile' && pathname !== '/done') {
      // Signed in but onboarding is unfinished — send them to finish it rather than into an
      // app where their name is blank.
      router.replace('/profile');
    } else if (session && !needsProfileSetup && inAuthFlow && pathname !== '/done') {
      // `done` is excluded deliberately. Saving the profile clears needsProfileSetup, and
      // without this the guard fires the instant the save lands and redirects straight past
      // the completion screen — the seal moment never plays. That screen navigates onward
      // itself once the stamp has landed.
      router.replace('/');
    }
  }, [loading, session, needsProfileSetup, pathname, router]);

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
