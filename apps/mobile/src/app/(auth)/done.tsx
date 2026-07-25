import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, Seal, color, font } from '@/design';

/**
 * The completion screen — the one real loading state in the whole design set.
 * Ported from design-reference/screens/Hisaab Done.dc.html.
 *
 * The seal spins, then stamps; the headline and button fade in only once it lands, so the
 * moment reads as an arrival rather than a form finishing.
 */
export default function Done() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [settled, setSettled] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 110, paddingBottom: insets.bottom + 40 }]}>
      <Seal size={158} state="animate" label="Sealing your ledger" onSettled={() => setSettled(true)} />

      {settled ? (
        <Animated.View entering={FadeIn.duration(420)} style={styles.reveal}>
          <Text style={styles.heading}>You&rsquo;re all set</Text>
          <Text style={styles.sub}>Your account is open and the maths is now our problem.</Text>
        </Animated.View>
      ) : null}

      <View style={styles.spacer} />

      {settled ? (
        <Animated.View entering={FadeIn.duration(420).delay(120)} style={styles.ctaWrap}>
          <GlassButton
            label="Go to your hisaab-kitaab"
            variant="primary"
            onPress={() => router.replace('/')}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 26 },
  reveal: { alignItems: 'center', marginTop: 40 },
  heading: { fontFamily: font.display, fontSize: 34, color: color.cream, textAlign: 'center' },
  sub: {
    marginTop: 10,
    maxWidth: 280,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 15.5,
    lineHeight: 22,
    color: color.textMuted,
  },
  spacer: { flex: 1 },
  ctaWrap: { width: '100%' },
});
