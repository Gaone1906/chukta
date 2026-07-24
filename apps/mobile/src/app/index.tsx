import { StyleSheet, Text, View } from 'react-native';

// Placeholder. The real entry screen is the onboarding flow, built in Phase 4.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hisaab</Text>
      <Text style={styles.subtitle}>Scaffold only — see plan/PROGRESS.md</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0405' },
  title: { color: '#D9B25C', fontSize: 34, letterSpacing: 2 },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 10 },
});
