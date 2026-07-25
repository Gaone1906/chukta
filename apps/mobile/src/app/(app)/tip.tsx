import { formatAmount, money } from '@hisaab/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton, GlassSurface, Toast, color, font, radius } from '@/design';
import { ScreenHeader } from '@/features/expenses/ScreenHeader';
import { inviteMessage, plainInviteUrl } from '@/features/invite/inviteLink';
import { getMyTips, isTipJarConfigured, tipProducts } from '@/features/tip/purchases';

/**
 * Tip jar.
 * Ported from design-reference/screens/Hisaab Tip Jar.dc.html.
 *
 * Two corrections to what was handed over, both load-bearing:
 *
 * 1. **The design doc calls these non-consumables. They must be consumables.** A
 *    non-consumable can be bought once per Apple ID, ever — so anyone who tipped ₹99 could
 *    never tip again, which is the exact opposite of what a tip jar is for.
 * 2. **The copy must never read as a plea.** "Made free, on purpose" is the point; asking is
 *    the footnote. The share option is given equal footing on purpose — for most people it is
 *    genuinely the more useful thing they can do.
 *
 * The purchase itself needs a RevenueCat account and products configured in App Store Connect
 * and Play Console, none of which exist until there are developer accounts. Until then the
 * screen is fully built and the Send button says so rather than failing at the tap.
 */
const PRESETS = [9900n, 19900n, 49900n];

export default function TipJar() {
  const insets = useSafeAreaInsets();

  const [picked, setPicked] = useState<bigint>(19900n);
  const [custom, setCustom] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const ping = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3400);
  };

  const configured = isTipJarConfigured();

  const tipsQuery = useQuery({ queryKey: ['tips'], queryFn: getMyTips });
  const hasTippedBefore = (tipsQuery.data?.length ?? 0) > 0;

  // A typed amount always wins over a preset — it is the more specific thing the user did.
  const customMinor = customToMinor(custom);
  const amountMinor = customMinor ?? picked;

  const share = async () => {
    try {
      await Share.share({ message: inviteMessage(plainInviteUrl()) });
    } catch (e) {
      ping((e as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Tip jar" />

        <Text style={styles.headline}>Made free, on purpose.</Text>

        <Text style={styles.body}>
          One developer, tired of ad-filled apps charging for basic features, built Hisaab to
          stay free — funded only by people who genuinely enjoy using it. A tip is entirely
          optional. Can&rsquo;t spare one? Rating it, or sharing it with a friend, helps just as
          much.
        </Text>

        {hasTippedBefore ? (
          <Text style={styles.thanks}>You&rsquo;ve tipped before. Genuinely, thank you.</Text>
        ) : null}

        <Text style={styles.sectionTitle}>Leave a tip</Text>

        <View style={styles.presets}>
          {PRESETS.map((value) => {
            const on = customMinor === null && picked === value;
            return (
              <Pressable
                key={String(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setCustom('');
                  setPicked(value);
                }}
                style={[styles.preset, on ? styles.presetOn : null]}
              >
                <Text style={[styles.presetLabel, on ? styles.presetLabelOn : null]}>
                  {formatAmount(money(value, 'INR'))}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.customWrap, customMinor !== null ? styles.customActive : null]}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            value={custom}
            onChangeText={(text) => setCustom(text.replace(/[^0-9]/g, ''))}
            placeholder="Something else"
            placeholderTextColor={color.textGhost}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={6}
            accessibilityLabel="A different amount"
            style={styles.customInput}
          />
        </View>

        <GlassButton
          label={
            configured
              ? `Send ${formatAmount(money(amountMinor, 'INR'))}`
              : 'Tipping opens at launch'
          }
          variant="primary"
          disabled={!configured || amountMinor <= 0n}
          onPress={() =>
            ping(
              // Named products, so this reads as a thing that is coming rather than broken.
              `Not yet — tips go through the App Store and Play, and Hisaab isn't on either one yet. ${tipProducts().length} tiers are ready to switch on.`,
            )
          }
          style={styles.send}
        />

        {/* The margin goes on `style`, not `contentStyle` — contentStyle lands on the inner
            view inside the surface, so a margin there pads the content and leaves the panel
            itself butted against the button above it. */}
        <GlassSurface radius={radius.cardCompact} style={styles.altSpacing} contentStyle={styles.alt}>
          <Text style={styles.altTitle}>Or, just as useful</Text>
          <GlassButton label="Share Hisaab instead" variant="secondary" onPress={() => void share()} />
        </GlassSurface>

        <Text style={styles.footnote}>One-time only, no subscription</Text>
      </ScrollView>

      <Toast message={toast} />
    </KeyboardAvoidingView>
  );
}

/** Whole rupees only — nobody tips ₹99.50. Returns null when nothing usable was typed. */
function customToMinor(text: string): bigint | null {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const rupees = BigInt(digits);
  return rupees > 0n ? rupees * 100n : null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 22 },
  headline: {
    marginTop: 24,
    fontFamily: font.display,
    fontSize: 34,
    lineHeight: 41,
    color: color.cream,
  },
  body: {
    marginTop: 12,
    fontFamily: font.light,
    fontSize: 14.5,
    lineHeight: 22,
    color: color.textSecondary,
  },
  thanks: {
    marginTop: 14,
    fontFamily: font.regular,
    fontSize: 13.5,
    color: color.goldBright,
  },
  sectionTitle: {
    marginTop: 26,
    marginBottom: 12,
    paddingLeft: 4,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  presets: { flexDirection: 'row', gap: 9 },
  preset: {
    flex: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  presetOn: { borderColor: color.owedBorder, backgroundColor: 'rgba(184,150,60,0.22)' },
  presetLabel: { fontFamily: font.medium, fontSize: 16, color: color.textSecondary },
  presetLabelOn: { fontFamily: font.semibold, color: color.creamWarm },
  customWrap: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  customActive: { borderColor: color.owedBorder, backgroundColor: 'rgba(184,150,60,0.10)' },
  rupee: { fontFamily: font.light, fontSize: 17, color: color.textMuted },
  customInput: { flex: 1, fontFamily: font.medium, fontSize: 16, color: color.cream },
  send: { marginTop: 18 },
  altSpacing: { marginTop: 26 },
  alt: { padding: 16, gap: 12 },
  altTitle: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  footnote: {
    marginTop: 18,
    textAlign: 'center',
    fontFamily: font.light,
    fontSize: 12,
    letterSpacing: 1.2,
    color: color.textGhost,
  },
});
