import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { GlassButton, GlassSurface, Seal, Toast, color, font, space } from '@/design';
import { AuthCancelled, appleAuthAvailable, signInWithApple, signInWithGoogle } from '@/features/auth/providers';
import { env, googleConfigured } from '@/lib/env';

/**
 * Onboarding entry. Ported from design-reference/screens/Hisaab Login.dc.html.
 *
 * The design doc calls this the one screen allowed to be more decorated than the rest, hence
 * the 212px seal and the tagline above the auth card.
 */
export default function AuthEntry() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ping = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const attempt = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        // Routing is handled by the root navigator once the session lands.
      } catch (error) {
        if (error instanceof AuthCancelled) return; // user backed out; say nothing
        ping(`${label} didn't work — ${(error as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, ping],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 46, paddingBottom: insets.bottom + 18 }]}>
      <Seal size={212} state="settled" label="" />

      <Text style={styles.tagline}>
        We keep the running total, so nobody has to bring it up at dinner.
      </Text>

      <View style={styles.spacer} />

      <GlassSurface radius={30} elevation="glass" contentStyle={styles.card}>
        <View style={styles.buttons}>
          {appleAuthAvailable ? (
            <GlassButton
              label="Continue with Apple"
              disabled={busy}
              icon={
                <Svg width={18} height={21} viewBox="0 0 18 21" fill="none">
                  <Path
                    d="M14.9 11.1c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.7 3-.7 1.4 0 1.8.7 3 .7 1.2 0 2-1.1 2.8-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.5Z"
                    fill="rgba(244,237,228,.92)"
                  />
                  <Path
                    d="M12.6 3.6c.6-.8 1-1.8.9-2.9-.9.1-2 .6-2.6 1.4-.6.7-1 1.8-.9 2.8 1 .1 2-.5 2.6-1.3Z"
                    fill="rgba(244,237,228,.92)"
                  />
                </Svg>
              }
              onPress={() => void attempt('Apple', signInWithApple)}
            />
          ) : null}

          {googleConfigured ? (
            <GlassButton
              label="Continue with Google"
              disabled={busy}
              icon={
                <Svg width={19} height={19} viewBox="0 0 20 20">
                  <Path fill="#4285F4" d="M19.6 10.2c0-.7-.1-1.4-.2-2H10v3.9h5.4c-.2 1.2-1 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z" />
                  <Path fill="#34A853" d="M10 20c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H1.1v2.6C2.8 17.9 6.1 20 10 20Z" />
                  <Path fill="#FBBC05" d="M4.4 12c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V5.4H1.1A10 10 0 0 0 0 10c0 1.6.4 3.2 1.1 4.6L4.4 12Z" />
                  <Path fill="#EA4335" d="M10 4c1.5 0 2.8.5 3.8 1.5l2.8-2.8C14.9 1 12.7 0 10 0 6.1 0 2.8 2.1 1.1 5.4L4.4 8c.8-2.3 3-4 5.6-4Z" />
                </Svg>
              }
              onPress={() => void attempt('Google', signInWithGoogle)}
            />
          ) : (
            <GlassButton label="Google sign-in not configured" disabled />
          )}

          {/* Built and working, but hidden until TRAI DLT registration clears. */}
          {env.phoneAuthEnabled ? (
            <GlassButton
              label="Continue with phone number"
              disabled={busy}
              icon={
                <Svg width={17} height={20} viewBox="0 0 17 20" fill="none">
                  <Rect x={1} y={1} width={15} height={18} rx={4} stroke={color.goldBright} strokeWidth={1.4} />
                  <Rect x={6} y={15} width={5} height={1.6} rx={0.8} fill={color.goldBright} />
                </Svg>
              }
              onPress={() => router.push('/phone')}
            />
          ) : null}
        </View>

        <Text style={styles.legal}>
          By continuing you agree to our{' '}
          <Text style={styles.link} onPress={() => void Linking.openURL('https://example.com/terms')}>
            Terms
          </Text>{' '}
          and{' '}
          <Text style={styles.link} onPress={() => void Linking.openURL('https://example.com/privacy')}>
            Privacy Policy
          </Text>
          .
        </Text>
      </GlassSurface>

      <View style={styles.footnoteRow}>
        <View style={styles.rule} />
        <Text style={styles.footnote}>Est. between friends</Text>
        <View style={styles.rule} />
      </View>

      {/* Dev-only door into the kitchen sink; removed before submission. */}
      {__DEV__ ? (
        <Pressable onPress={() => router.push('/_dev/kitchen-sink')} hitSlop={12}>
          <Text style={styles.devLink}>Kitchen sink</Text>
        </Pressable>
      ) : null}

      <Toast message={toast} position="bottom" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 26 },
  tagline: {
    marginTop: 34,
    maxWidth: 272,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 15.5,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.5)',
  },
  spacer: { flex: 1 },
  card: { padding: 22, paddingBottom: 20, width: '100%' },
  buttons: { gap: 11 },
  legal: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 11.5,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.34)',
  },
  link: { color: 'rgba(255,255,255,0.52)' },
  footnoteRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { width: 22, height: 1, backgroundColor: 'rgba(255,255,255,0.16)' },
  footnote: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  devLink: { marginTop: space.lg, fontFamily: font.light, fontSize: 12, color: color.textGhost },
});
