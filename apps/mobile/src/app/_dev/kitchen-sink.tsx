import { money } from '@chukta/core';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BalanceChip,
  FAB,
  GlassButton,
  GlassSurface,
  Row,
  RippleReveal,
  Seal,
  SegmentedSwitcher,
  Toast,
  color,
  font,
  forceGlassBackend,
  getGlassBackend,
  space,
  type GlassBackend,
} from '@/design';

/**
 * Phase 1 acceptance artifact: every design primitive in every state, on one screen.
 *
 * This is the thing to hold next to design-reference/prototype/ when checking fidelity, and
 * the place to exercise the degraded glass path without waiting for a low-end device.
 * Replaced by the real Home screen in Phase 5.
 */
export default function KitchenSink() {
  /*
   * Second gate, deliberately redundant with the `__DEV__` check in the root layout.
   *
   * That one stops the route bypassing auth; this one stops the screen rendering at all in a
   * release build, whatever routing decides. Two independent guards because this file is
   * reachable by deep link and neither of them is expensive.
   */
  if (!__DEV__) return null;

  return <KitchenSinkBody />;
}

function KitchenSinkBody() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'groups' | 'people'>('groups');
  const [toast, setToast] = useState<string | null>(null);
  const [backend, setBackend] = useState<GlassBackend | 'auto'>('auto');
  const [sealKey, setSealKey] = useState(0);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const [rippleMs, setRippleMs] = useState<number>(900);

  const ping = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const chooseBackend = (next: GlassBackend | 'auto') => {
    setBackend(next);
    forceGlassBackend(next === 'auto' ? null : next);
    // Remount the tree so every surface picks the new backend up.
    setSealKey((k) => k + 1);
  };

  const content = (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 140 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.h1}>Kitchen sink</Text>
      <Text style={styles.sub}>
        Every primitive, every state. Compare against design-reference/prototype/.
      </Text>

      <Section title="Glass backend">
        <View style={styles.rowWrap}>
          {(['auto', 'liquid', 'blur', 'fallback'] as const).map((option) => (
            <Pressable key={option} onPress={() => chooseBackend(option)}>
              <GlassSurface radius={999} active={backend === option} elevation="none" contentStyle={styles.pill}>
                <Text style={styles.pillText}>{option}</Text>
              </GlassSurface>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>Resolved: {getGlassBackend()}</Text>
      </Section>

      <Section title="Segmented switcher">
        <SegmentedSwitcher
          options={[
            { value: 'groups', label: 'Groups' },
            { value: 'people', label: 'People' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Section>

      <Section title={tab === 'groups' ? 'Group rows' : 'Person rows'}>
        {tab === 'groups' ? (
          <>
            <Row name="Goa, finally" meta="6 members" balance={money(-1248000n, 'INR')} onPress={() => ping('Goa, finally')} />
            <Row name="Flat 302" meta="3 members" balance={money(-84000n, 'INR')} />
            <Row name="Sunday football" meta="11 members" balance={money(0n, 'INR')} />
            <Row name="Wedding season" meta="8 members" balance={money(315000n, 'INR')} />
            <Row name="Kitchen fund" meta="4 members" balance={money(92000n, 'INR')} />
          </>
        ) : (
          <>
            <Row name="Rhea Kapoor" meta="2 shared groups" balance={money(620000n, 'INR')} avatar="RK" avatarTone="gold" />
            <Row name="Arjun Verma" meta="1 shared group" balance={money(-43000n, 'INR')} avatar="AV" avatarTone="oxblood" />
            <Row name="Meher Irani" meta="3 shared groups" balance={money(0n, 'INR')} avatar="MI" />
            <Row name="Kabir Shah" meta="2 shared groups" balance={money(187500n, 'INR')} avatar="KS" avatarTone="gold" compact />
          </>
        )}
      </Section>

      <Section title="Balance chips — including lakh/crore grouping">
        <GlassSurface contentStyle={styles.panel}>
          <View style={styles.chipRow}>
            <BalanceChip balance={money(-142000n, 'INR')} />
            <BalanceChip balance={money(620000n, 'INR')} />
            <BalanceChip balance={money(0n, 'INR')} />
          </View>
          <View style={styles.chipRow}>
            <BalanceChip balance={money(12345678900n, 'INR')} />
            <BalanceChip balance={money(-150050n, 'INR')} />
          </View>
          <Text style={styles.note}>₹12,34,56,789 must group the Indian way (lakh/crore), not 123,456,789</Text>
        </GlassSurface>
      </Section>

      <Section title="Buttons">
        <GlassButton label="Save expense" variant="primary" onPress={() => ping('Primary pressed')} />
        <GlassButton label="Settle up" onPress={() => ping('Secondary pressed')} />
        <GlassButton label="Disabled until valid" disabled />
      </Section>

      <Section title="Seal">
        <View style={styles.sealRow}>
          <Seal key={sealKey} size={132} state="animate" label="Sealing your ledger" onSettled={() => ping('Seal settled')} />
          <Seal size={92} state="settled" label="" />
        </View>
        <GlassButton label="Replay the stamp" onPress={() => setSealKey((k) => k + 1)} />
      </Section>

      <Section title="Typography">
        <GlassSurface contentStyle={styles.panel}>
          <Text style={styles.h1}>Rozha One display</Text>
          <Text style={styles.body}>Hind carries all body copy and every label.</Text>
          <Text style={styles.amount}>₹12,480 — amounts are always Hind, never the display face</Text>
        </GlassSurface>
      </Section>

      <Section title="Ripple transition">
        <Text style={styles.note}>
          Tap the FAB. Circular reveal from the tap point, three trailing rings, outgoing screen
          recedes. Slow motion makes the wavefront and the rings reviewable frame by frame.
        </Text>
        <View style={styles.rowWrap}>
          {([900, 4000] as const).map((ms) => (
            <Pressable key={ms} onPress={() => setRippleMs(ms)}>
              <GlassSurface radius={999} active={rippleMs === ms} elevation="none" contentStyle={styles.pill}>
                <Text style={styles.pillText}>{ms === 900 ? 'normal' : 'slow motion'}</Text>
              </GlassSurface>
            </Pressable>
          ))}
        </View>
      </Section>
    </ScrollView>
  );

  return (
    <View style={styles.flex}>
      {ripple ? (
        <RippleReveal
          from={content}
          to={<RippleTarget onBack={() => setRipple(null)} />}
          origin={ripple}
          durationMs={rippleMs}
          onDone={() => {}}
        />
      ) : (
        content
      )}

      <Toast message={toast} />

      {!ripple ? (
        <FAB style={[styles.fab, { bottom: insets.bottom + 28 }]} onPress={(pt) => setRipple(pt)} />
      ) : null}
    </View>
  );
}

function RippleTarget({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    // Opaque on purpose: the reveal is only legible if the incoming screen actually covers the
    // outgoing one. Real screens get this from the ambient background behind the navigator.
    <View style={[styles.flex, styles.target, styles.targetOpaque, { paddingTop: insets.top + 80 }]}>
      <Seal size={150} state="settled" label="" />
      <Text style={styles.h1}>Revealed</Text>
      <Text style={styles.sub}>This screen arrived through the ripple.</Text>
      <GlassButton label="Back" onPress={onBack} style={styles.targetButton} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.xl },
  h1: { fontFamily: font.display, fontSize: 32, color: color.cream },
  sub: { fontFamily: font.light, fontSize: 14.5, color: color.textMuted, marginTop: 4 },
  section: { marginTop: 30 },
  sectionBody: { gap: 11, marginTop: 12 },
  eyebrow: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  panel: { padding: 16, gap: 12 },
  chipRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' },
  rowWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 14, paddingVertical: 8 },
  pillText: { fontFamily: font.medium, fontSize: 13, color: color.cream },
  note: { fontFamily: font.light, fontSize: 12.5, lineHeight: 19, color: color.textFaint },
  body: { fontFamily: font.regular, fontSize: 15, color: color.textSecondary },
  amount: { fontFamily: font.semibold, fontSize: 15, color: color.textHighlight },
  sealRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  fab: { position: 'absolute', right: 24 },
  target: { alignItems: 'center', gap: 14 },
  targetOpaque: { backgroundColor: color.bgBase },
  targetButton: { marginTop: 20, width: 200 },
});
