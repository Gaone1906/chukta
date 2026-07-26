import { formatAmount, money } from '@chukta/core';
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
import { getMyTips, isTipJarConfigured, purchase, tipProducts } from '@/features/tip/purchases';
import { rateApp } from '@/features/tip/rate';

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

  /*
   * The Send button used to toast "not yet" unconditionally — it never looked at `configured`,
   * so wiring RevenueCat up would not have changed what it did. It calls `purchase()` now, and
   * the honest message comes from the error that throws when the store is not wired, which is
   * the one place that fact is known.
   */
  const send = async () => {
    const product = tipProducts().find((p) => p.amountMinor === amountMinor);
    try {
      await purchase(product?.id ?? `tip_custom_${amountMinor}`);
      ping('Thank you — genuinely.');
      void tipsQuery.refetch();
    } catch (e) {
      ping((e as Error).message);
    }
  };

  /*
   * No success toast on the good path, deliberately. `requestReview()` resolves whether or not
   * the OS actually showed the sheet — both stores ration these silently — so "thanks for
   * rating!" would be a lie most of the time. Only the case where there is nowhere at all to
   * send them says anything. See features/tip/rate.ts.
   */
  const rate = async () => {
    try {
      if ((await rateApp()) === 'unavailable') {
        ping('Once Chukta is on the store, this is where you rate it.');
      }
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
          One developer, tired of ad-filled apps charging for basic features, built Chukta to
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
              // Was "Tipping opens at launch", which stops being true the moment we launch
              // without it — and v1 ships with tipping off deliberately (see purchases.ts:
              // the iap-verify Edge Function that must write these rows does not exist yet).
              // This wording stays honest whenever it is read.
              : 'Tipping isn’t open yet'
          }
          variant="primary"
          disabled={!configured || amountMinor <= 0n}
          onPress={() => void send()}
          style={styles.send}
        />

        {/* The margin goes on `style`, not `contentStyle` — contentStyle lands on the inner
            view inside the surface, so a margin there pads the content and leaves the panel
            itself butted against the button above it. */}
        <GlassSurface radius={radius.cardCompact} style={styles.altSpacing} contentStyle={styles.alt}>
          <Text style={styles.altTitle}>Or, just as useful</Text>

          {/*
            * Rate and Share as a pair, which is what the heading above has always claimed they
            * were — it says "just as useful" and then used to present exactly one option.
            *
            * Both are the design's 44pt pill (Hisaab Tip Jar.dc.html), differing only in colour:
            * Rate keeps the gold border and star, Share the plain white. Hand-rolled rather than
            * two GlassButtons because GlassButton picks its border from `variant`, so there is
            * no way to get one gold and one white without adding a variant that exists for this
            * one row.
            *
            * `flex: 1` on both, so they split the width evenly however long the labels get.
            * "instead" is dropped from Share's label — it was doing the work the heading does,
            * and at half width it no longer fits on one line.
            */}
          <View style={styles.altRow}>
            <Pressable
              onPress={() => void rate()}
              accessibilityRole="button"
              accessibilityLabel="Rate Chukta"
              style={({ pressed }) => [
                styles.pill,
                styles.ratePill,
                pressed ? styles.ratePressed : null,
              ]}
            >
              <Text style={styles.rateStar}>★</Text>
              <Text style={styles.pillLabel}>Rate</Text>
            </Pressable>

            <Pressable
              onPress={() => void share()}
              accessibilityRole="button"
              accessibilityLabel="Share Chukta"
              style={({ pressed }) => [
                styles.pill,
                styles.sharePill,
                pressed ? styles.sharePressed : null,
              ]}
            >
              <Text style={styles.pillLabel}>Share</Text>
            </Pressable>
          </View>
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
    minHeight: 52,
    paddingVertical: 10,
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
    minHeight: 52,
    paddingVertical: 10,
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

  altRow: { flexDirection: 'row', gap: 10 },

  /*
   * The shape both alternatives share — the design's 44pt fully-rounded pill. Only the border
   * and fill differ between them, which is the whole point: they are the same offer, and one is
   * merely warmer.
   */
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
  },
  pillLabel: {
    fontFamily: font.medium,
    fontSize: 14.5,
    color: 'rgba(246,233,203,0.9)',
    letterSpacing: 0.1,
  },

  /*
   * Gold, where Share is white. Straight from the design: `rgba(184,150,60,.4)` border over a
   * `.1` fill. Deliberately quieter than the Send button above (which is `.6` over `.2`) — a
   * ladder of emphasis rather than three buttons competing.
   */
  ratePill: { borderColor: 'rgba(184,150,60,0.4)', backgroundColor: 'rgba(184,150,60,0.1)' },
  // `scale(.97)` in the design. A plain Pressable style rather than a Reanimated press — these
  // are once-in-a-while buttons and do not need a worklet.
  ratePressed: {
    transform: [{ scale: 0.97 }],
    borderColor: 'rgba(184,150,60,0.7)',
    backgroundColor: 'rgba(184,150,60,0.26)',
  },
  rateStar: { color: color.goldBright, fontSize: 15, lineHeight: 18 },

  sharePill: { borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.05)' },
  sharePressed: {
    transform: [{ scale: 0.97 }],
    borderColor: 'rgba(184,150,60,0.45)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

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
