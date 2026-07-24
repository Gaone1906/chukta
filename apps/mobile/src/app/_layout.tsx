import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AmbientBackground, color } from '@/design';
import { useAppFonts } from '@/design/fonts';

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
        {/* Mounted once, above the navigator: the glass has nothing to refract without it,
            and per-screen mounting would restart the drift on every navigation. */}
        <AmbientBackground />
        <Stack
          screenOptions={{
            headerShown: false,
            // Screens must be transparent so the ambient background shows through.
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'fade',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
