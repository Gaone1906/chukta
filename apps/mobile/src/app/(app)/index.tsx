import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassSurface, color, font } from '@/design';
import { useSession } from '@/features/auth/session';

/**
 * PLACEHOLDER. The real Home — segmented switcher, group and person rows, the FAB — is
 * Phase 5. This exists so onboarding has somewhere to land, and so signing in end to end is
 * verifiable now rather than in three weeks.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, session, signOut } = useSession();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
      <Text style={styles.heading}>Hisaab</Text>
      <Text style={styles.sub}>Signed in. Home lands in Phase 5.</Text>

      <GlassSurface radius={24} contentStyle={styles.card}>
        <Row label="Name" value={profile?.display_name ?? '—'} />
        <Row label="UPI ID" value={profile?.upi_vpa ?? 'not set'} />
        <Row label="Profile id" value={profile?.id?.slice(0, 8) ?? '—'} />
        <Row label="User id" value={session?.user.id.slice(0, 8) ?? '—'} />
      </GlassSurface>

      <View style={styles.spacer} />

      <GlassButton label="Kitchen sink" onPress={() => router.push('/_dev/kitchen-sink')} />
      <GlassButton label="Sign out" onPress={() => void signOut()} style={styles.signOut} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 26 },
  heading: { fontFamily: font.display, fontSize: 34, color: color.cream },
  sub: { marginTop: 4, marginBottom: 24, fontFamily: font.light, fontSize: 14.5, color: color.textMuted },
  card: { padding: 18, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  value: { flex: 1, textAlign: 'right', fontFamily: font.medium, fontSize: 15, color: color.cream },
  spacer: { flex: 1 },
  signOut: { marginTop: 11 },
});
