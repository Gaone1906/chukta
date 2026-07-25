import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { GlassSurface, color, font, radius } from '@/design';

/**
 * The grouped-rows pattern the Settings screen is built from.
 * Ported from design-reference/screens/Hisaab Settings.dc.html.
 *
 * A labelled section over one glass panel, rows hairline-separated inside it. Extracted
 * because Settings uses it three times and Help uses the same shape for its accordion — and
 * because the separator rule ("between rows, never at the ends") is the sort of thing that
 * drifts if every screen re-implements it.
 */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children];

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <GlassSurface radius={radius.card} elevation="glass">
        {/* Index keys are correct here: the row set is written literally at each call site
            and never reorders — there is no identity to preserve. */}
        {rows.map((row, i) => (
          <View key={i}>
            {i > 0 ? <View style={styles.separator} /> : null}
            {row}
          </View>
        ))}
      </GlassSurface>
    </View>
  );
}

/** A row that opens something. `value` is the current setting, shown inline. */
export function SettingsRow({
  label,
  value,
  accessory,
  onPress,
}: {
  label: string;
  value?: string | null;
  /** Rendered in place of the text value — the avatar, for the Photo row. */
  accessory?: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {accessory ?? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value ?? 'Not set'}
        </Text>
      )}
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

/** A row that toggles something, with the reason it exists underneath. */
export function SettingsToggle({
  label,
  hint,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.row,
        styles.toggleRow,
        pressed && !disabled ? styles.rowPressed : null,
        disabled ? styles.rowDisabled : null,
      ]}
    >
      <View style={styles.toggleText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch on={value} />
    </Pressable>
  );
}

/**
 * The switch itself. Written rather than using RN's, which paints a platform control that
 * looks like it wandered in from another app — the whole screen is one custom material.
 */
function Switch({ on }: { on: boolean }) {
  // `useDerivedValue` rather than setting a shared value during render — Reanimated warns
  // about the latter, and rightly: render can run more than once per commit, so the animation
  // would be restarted by renders that changed nothing about this switch.
  const progress = useDerivedValue(() => withTiming(on ? 1 : 0, { duration: 240 }), [on]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * 19 }],
    backgroundColor: progress.get() > 0.5 ? color.creamWarm : 'rgba(255,255,255,.55)',
  }));

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor:
      progress.get() > 0.5 ? 'rgba(184,150,60,.32)' : 'rgba(255,255,255,.07)',
    borderColor: progress.get() > 0.5 ? color.owedBorder : 'rgba(255,255,255,.18)',
  }));

  return (
    <Animated.View style={[styles.track, trackStyle]}>
      <Animated.View style={[styles.knob, knobStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 9 },
  groupTitle: {
    paddingLeft: 4,
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  separator: { height: 1, marginHorizontal: 17, backgroundColor: 'rgba(255,255,255,.08)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 17,
  },
  toggleRow: { paddingVertical: 13 },
  rowPressed: { backgroundColor: 'rgba(255,255,255,.06)' },
  rowDisabled: { opacity: 0.45 },
  rowLabel: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: 'rgba(244,237,228,.9)' },
  rowValue: {
    flexShrink: 1,
    maxWidth: '55%',
    textAlign: 'right',
    fontFamily: font.regular,
    fontSize: 15,
    color: color.textMuted,
  },
  toggleText: { flex: 1, gap: 2 },
  rowHint: { fontFamily: font.light, fontSize: 12, color: color.textFaint },
  track: {
    width: 46,
    height: 27,
    borderRadius: 14,
    borderWidth: 1,
    padding: 2,
    justifyContent: 'center',
  },
  knob: { width: 21, height: 21, borderRadius: 11 },
});
