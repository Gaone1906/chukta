import { DarkTheme, Stack, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { AmbientBackground, Toast, color } from '@/design';
import { BlurTargetProvider } from '@/design/blurTarget';
import { useAppFonts } from '@/design/fonts';
import { SessionProvider, useSession } from '@/features/auth/session';
import { usePendingInvite } from '@/features/invite/usePendingInvite';
import { isConflict } from '@/lib/errors';
import { registerForPush } from '@/features/notifications/registerPush';
import { OfflineProvider } from '@/lib/offline/OfflineProvider';
import { OfflineBanner } from '@/lib/offline/OfflineBanner';
import { CACHE_BUSTER, CACHE_MAX_AGE, queryPersister } from '@/lib/offline/persister';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Balances change when anyone in a shared group adds an expense. Phase 8 replaced polling
      // with the change_events subscription, which invalidates the affected keys the moment
      // anything moves — so the stale window no longer has to be short to stay honest.
      staleTime: 60_000,
      /*
       * Long enough to outlive the persisted cache, and that is the whole point.
       *
       * A query is only written to disk if it is still IN the cache when the persister
       * dehydrates. At the default five minutes, everything the user was not currently looking
       * at would be collected before the app closed — so the "works offline" cache would hold
       * one screen. Matching gcTime to the cache's max age is what makes a cold start on a
       * plane show the whole app rather than the last thing that was open.
       */
      gcTime: CACHE_MAX_AGE,
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
            {/*
              * The cached reads, restored before the first render that could show an empty
              * screen. `buster` discards anything written by an older serializer rather than
              * feeding it to a newer one — tagged bigints read back by the wrong parser would
              * render as [object Object] where a balance belongs.
              */}
            <PersistQueryClientProvider
              client={queryClient}
              persistOptions={{
                persister: queryPersister,
                maxAge: CACHE_MAX_AGE,
                buster: CACHE_BUSTER,
              }}
            >
              <SessionProvider>
                {/* Inside SessionProvider: the queue, the cursor and the subscription all
                    belong to one profile, so none of them can start before there is one. */}
                <OfflineProvider>
                  <RootNavigator />
                </OfflineProvider>
              </SessionProvider>
            </PersistQueryClientProvider>
          </ThemeProvider>
        </BlurTargetProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Onboarding lives at these paths. Route groups are stripped from the URL by expo-router. */
const AUTH_PATHS = ['/sign-in', '/phone', '/otp', '/profile', '/done'];

function RootNavigator() {
  const { session, loading, needsProfileSetup, profile } = useSession();
  /*
   * usePathname rather than useSegments: segments is a TUPLE whose length comes from the
   * generated route types, and `.expo/types/` is gitignored — so indexing `segments[1]`
   * typechecks locally and fails in CI, where those types don't exist. A pathname is a plain
   * string either way, and reads better here regardless.
   */
  const pathname = usePathname();
  const router = useRouter();

  // Lives here rather than on a screen: an invite link can land on any of them, and the claim
  // has to survive the redirect through sign-in that it almost always triggers.
  const inviteMessage = usePendingInvite();

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

  /*
   * Ask for push once the user is actually in the app.
   *
   * Not at cold start, and not on the sign-in screen: the OS permission prompt can be shown
   * once per install and never re-asked once denied, so firing it before the user has seen
   * anything worth being notified about is the reliable way to get a permanent no. By the time
   * `needsProfileSetup` is false they have a name, a home screen, and a reason to care.
   *
   * Fire-and-forget on purpose. Every outcome — denied, simulator, no project id — is a normal
   * state of the world, not an error worth interrupting anybody with, and `registerForPush`
   * already swallows its own failures.
   */
  useEffect(() => {
    if (loading || !session || needsProfileSetup || !profile) return;
    void registerForPush(profile.id);
  }, [loading, session, needsProfileSetup, profile]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          // Screens must be transparent so the ambient background shows through.
          contentStyle: { backgroundColor: 'transparent' },
          animation: 'fade',
        }}
      />
      <OfflineBanner />
      <Toast message={inviteMessage} />
    </>
  );
}
