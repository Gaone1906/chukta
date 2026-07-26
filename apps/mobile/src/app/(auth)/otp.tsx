import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackChevron } from '@/features/onboarding/BackChevron';
import { GlassButton, Toast, color, font } from '@/design';
import { supabase } from '@/lib/supabase';

/**
 * Six-digit code entry — step 2 of 3.
 * Ported from design-reference/screens/Hisaab OTP.dc.html.
 *
 * The prototype's box behaviour is genuinely good and is reproduced here: auto-advance,
 * backspace into the previous box, pasting all six at once, and a live resend countdown.
 *
 * One thing the design set never had, anywhere: an invalid-code state. Added here, because
 * "nothing happens" is the worst possible response to a wrong code.
 */
const LENGTH = 6;
const RESEND_SECONDS = 28;

export default function OtpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone?: string }>();

  const [values, setValues] = useState<string[]>(Array(LENGTH).fill(''));
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const code = values.join('');
  const complete = code.length === LENGTH;

  const setDigit = useCallback((index: number, text: string) => {
    setError(null);
    const clean = text.replace(/\D/g, '');

    // Pasting the whole code into one box should fill them all.
    if (clean.length > 1) {
      const spread = clean.slice(0, LENGTH).split('');
      setValues((prev) => {
        const next = [...prev];
        for (let i = 0; i < LENGTH; i++) next[i] = spread[i] ?? '';
        return next;
      });
      inputs.current[Math.min(spread.length, LENGTH - 1)]?.focus();
      return;
    }

    setValues((prev) => {
      const next = [...prev];
      next[index] = clean;
      return next;
    });

    if (clean && index < LENGTH - 1) inputs.current[index + 1]?.focus();
  }, []);

  const onKeyPress = useCallback(
    (index: number, key: string) => {
      if (key === 'Backspace' && !values[index] && index > 0) {
        inputs.current[index - 1]?.focus();
        setValues((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
      }
    },
    [values],
  );

  const verify = useCallback(async () => {
    if (!complete || busy || !phone) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });
      if (verifyError) throw verifyError;
      // The root navigator takes it from here once the session lands.
    } catch {
      setError('That code didn’t work. Check it and try again.');
      setValues(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }, [complete, busy, phone, code]);

  const resend = useCallback(async () => {
    if (seconds > 0 || !phone) return;
    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({ phone });
      if (resendError) throw resendError;
      setSeconds(RESEND_SECONDS);
      setToast('Sent another one.');
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      setToast(`Couldn't resend — ${(err as Error).message}`);
      setTimeout(() => setToast(null), 3500);
    }
  }, [seconds, phone]);

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24 }]}>
      <BackChevron onPress={() => router.back()} />

      <Text style={styles.eyebrow}>Step 2 of 3</Text>
      <Text style={styles.heading}>Enter the code</Text>
      <View style={styles.sentRow}>
        <Text style={styles.sent}>Sent to {phone ?? 'your phone'}</Text>
        {/* "Edit" alone tells a screen reader nothing about what it edits. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change the phone number"
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Text style={styles.edit}>Edit</Text>
        </Pressable>
      </View>

      <View style={styles.boxes}>
        {values.map((value, index) => (
          <TextInput
            key={index}
            ref={(el) => {
              inputs.current[index] = el;
            }}
            value={value}
            onChangeText={(text) => setDigit(index, text)}
            onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={LENGTH}
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            autoFocus={index === 0}
            style={[styles.box, error ? styles.boxError : null, value ? styles.boxFilled : null]}
            accessibilityLabel={`Digit ${index + 1}`}
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/*
        * `accessibilityState.disabled` as well as the prop: VoiceOver announces the state from
        * the former, so without it the countdown reads as a live button that does nothing.
        */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          seconds > 0 ? `Resend the code, available in ${mmss}` : 'Resend the code'
        }
        accessibilityState={{ disabled: seconds > 0 }}
        onPress={() => void resend()}
        disabled={seconds > 0}
        hitSlop={8}
      >
        <Text style={[styles.resend, seconds === 0 ? styles.resendActive : null]}>
          {seconds > 0 ? `Resend in ${mmss}` : "Didn't get it? Tap to resend."}
        </Text>
      </Pressable>

      <View style={styles.spacer} />

      <GlassButton
        label={busy ? 'Verifying…' : 'Verify'}
        variant="primary"
        disabled={!complete || busy}
        onPress={() => void verify()}
      />

      <Text style={styles.fine}>The code expires in 10 minutes.</Text>

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
  heading: { marginTop: 10, fontFamily: font.display, fontSize: 34, color: color.cream },
  sentRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sent: { fontFamily: font.light, fontSize: 14, color: color.textMuted },
  edit: { fontFamily: font.medium, fontSize: 14, color: color.goldBright },
  boxes: { marginTop: 30, flexDirection: 'row', gap: 9, justifyContent: 'space-between' },
  box: {
    flex: 1,
    height: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    textAlign: 'center',
    fontFamily: font.semibold,
    fontSize: 22,
    color: color.cream,
  },
  boxFilled: { borderColor: 'rgba(184,150,60,0.55)' },
  boxError: { borderColor: color.oweBorder },
  error: { marginTop: 14, fontFamily: font.regular, fontSize: 13.5, color: color.creamRose },
  resend: { marginTop: 18, fontFamily: font.light, fontSize: 13.5, color: color.textFaint },
  resendActive: { color: color.goldBright, fontFamily: font.medium },
  spacer: { flex: 1 },
  fine: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 12,
    color: color.textGhost,
  },
});
