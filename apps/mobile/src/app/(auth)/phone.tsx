import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackChevron } from '@/features/onboarding/BackChevron';
import { GlassButton, GlassSurface, Toast, color, font } from '@/design';
import { supabase } from '@/lib/supabase';

/**
 * Phone number entry — step 1 of 3.
 * Ported from design-reference/screens/Hisaab Phone.dc.html, including its digit grouping.
 *
 * FLAG-GATED OFF for v1 (EXPO_PUBLIC_ENABLE_PHONE_AUTH). Indian SMS OTP needs TRAI DLT
 * registration of the sender ID and templates plus a paid provider, which is weeks of lead
 * time. The screen is finished so switching it on is a flag, not a build.
 */
const REQUIRED_DIGITS = 10;

export default function PhoneEntry() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const formatted = useMemo(() => {
    // 98765 43210 — the grouping the prototype uses.
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }, [digits]);

  const remaining = REQUIRED_DIGITS - digits.length;
  const ready = remaining === 0;

  const onChange = useCallback((text: string) => {
    setDigits(text.replace(/\D/g, '').slice(0, REQUIRED_DIGITS));
  }, []);

  const send = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const phone = `+91${digits}`;
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
      router.push({ pathname: '/otp', params: { phone } });
    } catch (error) {
      setToast(`Couldn't send the code — ${(error as Error).message}`);
      setTimeout(() => setToast(null), 3500);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, digits, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24 }]}>
      <BackChevron onPress={() => router.back()} />

      <Text style={styles.eyebrow}>Step 1 of 3</Text>
      <Text style={styles.heading}>What&rsquo;s your number?</Text>

      <GlassSurface radius={24} contentStyle={styles.card}>
        <Pressable style={styles.dial} accessibilityRole="button" accessibilityLabel="Country code">
          <Text style={styles.dialText}>+91</Text>
        </Pressable>
        <View style={styles.divider} />
        <TextInput
          value={formatted}
          onChangeText={onChange}
          placeholder="98765 43210"
          placeholderTextColor="rgba(255,255,255,0.28)"
          keyboardType="number-pad"
          style={styles.input}
          autoFocus
          accessibilityLabel="Phone number"
        />
      </GlassSurface>

      <Text style={styles.hint}>
        {ready ? 'Ready to send' : `${remaining} more digit${remaining === 1 ? '' : 's'}`}
      </Text>

      <View style={styles.spacer} />

      <GlassButton
        label={busy ? 'Sending…' : 'Send code'}
        variant="primary"
        disabled={!ready || busy}
        onPress={() => void send()}
      />

      <Toast message={toast} position="bottom" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 26 },
  eyebrow: {
    marginTop: 26,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.goldBright,
  },
  heading: { marginTop: 10, marginBottom: 28, fontFamily: font.display, fontSize: 34, color: color.cream },
  card: { flexDirection: 'row', alignItems: 'center', height: 58, paddingHorizontal: 6 },
  dial: { paddingHorizontal: 14, height: '100%', justifyContent: 'center' },
  dialText: { fontFamily: font.medium, fontSize: 17, color: color.cream },
  divider: { width: 1, height: 26, backgroundColor: color.glassBorder },
  input: { flex: 1, height: '100%', paddingHorizontal: 14, fontFamily: font.regular, fontSize: 17, color: color.cream },
  hint: { marginTop: 12, fontFamily: font.light, fontSize: 13, color: color.textFaint },
  spacer: { flex: 1 },
});
