import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { GlassSurface, Seal, Toast, color, font, radius, useRippleNav } from '@/design';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { rateApp } from '@/features/tip/rate';

/**
 * About.
 * Ported from design-reference/screens/Hisaab About.dc.html.
 *
 * The version is read from `expo-constants`, never typed in. The prototype hardcodes it, which
 * is why the Sidebar says v1.0.3 and this screen says v1.0.0 — a mismatch that survived all the
 * way to handover and is the argument for reading it.
 */

// Published from legal/ via GitHub Pages. The stores require both to be reachable URLs that
// work without the app installed, which rules out anything served from inside it.
const LEGAL_BASE = 'https://gaone1906.github.io/hisaab';

export default function About() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { rippleFrom } = useRippleNav();
  const [toast, setToast] = useState<string | null>(null);

  const version = Constants.expoConfig?.version ?? '0.0.0';

  const openLegal = async (path: string) => {
    try {
      // An in-app browser rather than leaving for Safari: reading the terms should not lose
      // the user's place in the app.
      await WebBrowser.openBrowserAsync(`${LEGAL_BASE}/${path}`, {
        toolbarColor: color.bgBase,
        controlsColor: color.goldBright,
      });
    } catch {
      setToast("Couldn't open that page.");
      setTimeout(() => setToast(null), 2600);
    }
  };

  /*
   * Same handler as the tip jar's gold pill — one ladder (review sheet → store URL → an honest
   * message), one place to change it. See features/tip/rate.ts for why there is no success
   * message on the good path.
   */
  const rate = async () => {
    try {
      if ((await rateApp()) === 'unavailable') {
        setToast('Once Hisaab is on the store, this is where you rate it.');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (e) {
      setToast((e as Error).message);
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="About" />

        <View style={styles.hero}>
          {/* `state="settled"` — the stamp already landed. This is a mark, not a moment. */}
          <Seal size={104} state="settled" label="" />
          <Text style={styles.name}>Hisaab</Text>
          <Text style={styles.tagline}>
            Built to stay free forever. No ads, no paywalls, no subscriptions — just a quiet
            ledger between friends.
          </Text>
          <Text style={styles.version}>Version {version}</Text>
        </View>

        <GlassSurface radius={radius.card} elevation="glass" style={styles.links}>
          <LinkRow label="Terms of Service" onPress={() => void openLegal('terms')} />
          <Rule />
          <LinkRow label="Privacy Policy" onPress={() => void openLegal('privacy')} />
          <Rule />
          <LinkRow label="Rate Hisaab" onPress={() => void rate()} />
          <Rule />
          <LinkRow
            label="Tip jar"
            gold
            onPress={(e) => rippleFrom(e, () => router.push('/tip'))}
          />
        </GlassSurface>

        <Text style={styles.colophon}>
          Made by one developer in Bengaluru who split too many dinner bills. No investors, no
          ad-tech, no growth team.
        </Text>
      </ScrollView>

      <Toast message={toast} />
    </View>
  );
}

function LinkRow({
  label,
  gold = false,
  onPress,
}: {
  label: string;
  gold?: boolean;
  onPress: (event: GestureResponderEvent) => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={[styles.rowLabel, gold ? styles.rowLabelGold : null]}>{label}</Text>
      <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
        <Path
          d="M1.5 1l4 5-4 5"
          stroke="rgba(255,255,255,.28)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

const Rule = () => <View style={styles.rule} />;

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  hero: { alignItems: 'center', marginTop: 26, marginBottom: 30, gap: 12 },
  name: { fontFamily: font.display, fontSize: 40, lineHeight: 46, color: color.cream },
  tagline: {
    textAlign: 'center',
    maxWidth: 300,
    fontFamily: font.light,
    fontSize: 14.5,
    lineHeight: 22,
    color: color.textSecondary,
  },
  version: {
    marginTop: 2,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  links: { overflow: 'hidden' },
  rule: { height: 1, marginHorizontal: 17, backgroundColor: 'rgba(255,255,255,.08)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 17,
  },
  rowPressed: { backgroundColor: 'rgba(255,255,255,.06)' },
  rowLabel: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: 'rgba(244,237,228,.85)' },
  rowLabelGold: { color: color.goldBright },
  colophon: {
    marginTop: 26,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 13,
    lineHeight: 20,
    color: color.textFaint,
  },
});
