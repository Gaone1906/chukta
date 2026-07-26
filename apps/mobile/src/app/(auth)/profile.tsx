import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { GlassButton, GlassSurface, Toast, color, font } from '@/design';
import { useSession } from '@/features/auth/session';
import { supabase } from '@/lib/supabase';

/**
 * Profile setup — step 3 of onboarding.
 * Ported from design-reference/screens/Hisaab Profile.dc.html.
 *
 * UPI ID is OPTIONAL here, against the design doc's "required". The prototype itself marks it
 * optional, and a hard gate on the last onboarding step for a value many people don't know
 * offhand is a real drop-off risk. Settle up already handles a missing VPA gracefully and
 * prompts for it at the moment it actually matters.
 */
export default function ProfileSetup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, profile, refreshProfile } = useSession();

  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /*
   * Prefill from whatever the provider gave us — Google always sends a name, Apple only on the
   * first authorisation. The profile arrives asynchronously, so this has to happen after the
   * first render.
   *
   * Adjusting state during render rather than in an effect: React re-runs this component
   * immediately without committing the intermediate result, whereas an effect would paint the
   * empty fields first and then paint them again filled in.
   */
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (profile && profile.id !== prefilledFor) {
    setPrefilledFor(profile.id);
    if (profile.display_name !== 'Someone') setName(profile.display_name);
    if (profile.upi_vpa) setUpi(profile.upi_vpa);
  }

  const ping = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      ping('Photo access is off — you can add one later in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri);
  }, [ping]);

  const canContinue = name.trim().length > 1 && !saving;

  const save = useCallback(async () => {
    if (!canContinue || !session) return;
    setSaving(true);
    try {
      let avatarUrl: string | null = profile?.avatar_url ?? null;

      if (avatarUri && profile) {
        const response = await fetch(avatarUri);
        const bytes = await response.arrayBuffer();
        const path = `${profile.id}/avatar.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) {
          // A failed avatar must not block onboarding — it is the one optional thing here.
          ping("Couldn't upload the photo, but your profile is saved.");
        } else {
          avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: name.trim(),
          upi_vpa: upi.trim() || null,
          avatar_url: avatarUrl,
          /*
           * What actually ends onboarding.
           *
           * `needsProfileSetup` reads this, so without it the guard would send them straight
           * back here after saving — a loop. It is written on save rather than on first sight
           * of the screen, so abandoning it halfway leaves them still un-onboarded and they get
           * asked again, which is the behaviour you want for the screen that captures the UPI
           * id. See migration 0038.
           */
          onboarded_at: new Date().toISOString(),
        })
        .eq('user_id', session.user.id);

      if (error) throw error;

      await refreshProfile();
      router.replace('/done');
    } catch (error) {
      ping(`Couldn't save — ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [canContinue, session, profile, avatarUri, name, upi, refreshProfile, router, ping]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 54, paddingBottom: insets.bottom + 30 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>Step 3 of 3</Text>
      <Text style={styles.heading}>Tell us who you are</Text>
      <Text style={styles.sub}>This is how you&rsquo;ll show up in shared ledgers</Text>

      <GlassSurface radius={28} contentStyle={styles.card}>
        <Pressable style={styles.photoRow} onPress={() => void pickPhoto()} accessibilityRole="button">
          <View style={styles.photo}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.photoImage} contentFit="cover" />
            ) : (
              <Svg width={22} height={20} viewBox="0 0 22 20" fill="none">
                <Path
                  d="M2 6.5h3.5L7 4h8l1.5 2.5H20v11H2v-11Z"
                  stroke={color.goldBright}
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                />
                <Circle cx={11} cy={11.5} r={3.4} stroke={color.goldBright} strokeWidth={1.4} />
              </Svg>
            )}
          </View>
          <View style={styles.photoText}>
            <Text style={styles.photoLabel}>{avatarUri ? 'Change photo' : 'Add photo'}</Text>
            <Text style={styles.photoHint}>Optional — you can add it later</Text>
          </View>
        </Pressable>

        <View style={styles.field}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Aanya Mehra"
            placeholderTextColor="rgba(255,255,255,0.28)"
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            accessibilityLabel="Your name"
          />
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>UPI ID</Text>
            <Text style={styles.optional}>Optional</Text>
          </View>
          <TextInput
            value={upi}
            onChangeText={setUpi}
            placeholder="aanya@okbank"
            placeholderTextColor="rgba(255,255,255,0.28)"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="UPI ID"
          />
          <Text style={styles.hint}>So friends can pay you back directly. Add it whenever.</Text>
        </View>
      </GlassSurface>

      <GlassButton
        label={saving ? 'Saving…' : 'Get started'}
        variant="primary"
        disabled={!canContinue}
        onPress={() => void save()}
        style={styles.cta}
      />

      <Text style={styles.footnote}>No spreadsheet required</Text>

      <Toast message={toast} position="bottom" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 26 },
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.goldBright,
    textAlign: 'center',
  },
  heading: {
    marginTop: 10,
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 42,
    color: color.cream,
    textAlign: 'center',
  },
  sub: {
    marginTop: 6,
    marginBottom: 26,
    fontFamily: font.light,
    fontSize: 15,
    lineHeight: 21,
    color: color.textMuted,
    textAlign: 'center',
  },
  card: { padding: 20, gap: 20 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photo: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.5)',
    backgroundColor: 'rgba(184,150,60,0.12)',
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  photoText: { flex: 1, gap: 2 },
  photoLabel: { fontFamily: font.medium, fontSize: 16, color: color.cream },
  photoHint: { fontFamily: font.light, fontSize: 13, color: color.textMuted },
  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  optional: {
    fontFamily: font.light,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  input: {
    minHeight: 52,
    paddingVertical: 10,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
    fontFamily: font.regular,
    fontSize: 16,
    color: color.cream,
  },
  hint: { fontFamily: font.light, fontSize: 12.5, lineHeight: 18, color: color.textFaint },
  cta: { marginTop: 22 },
  footnote: {
    marginTop: 16,
    textAlign: 'center',
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
});
