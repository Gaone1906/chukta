import { Hind_300Light, Hind_400Regular, Hind_500Medium, Hind_600SemiBold } from '@expo-google-fonts/hind';
import { RozhaOne_400Regular } from '@expo-google-fonts/rozha-one';
import { useFonts } from 'expo-font';

/**
 * Neither face ships with iOS or Android, so both are bundled.
 *
 * Rozha One (Devanagari-rooted display serif) is for the wordmark and screen titles only.
 * Hind carries all body text, all labels and — critically — every amount.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    RozhaOne_400Regular,
    Hind_300Light,
    Hind_400Regular,
    Hind_500Medium,
    Hind_600SemiBold,
  });

  // Don't hold the splash screen hostage to a font failure — falling back to a system face is
  // far better than never rendering.
  return loaded || error != null;
}
