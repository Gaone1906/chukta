import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GlassSurface, color, font, radius } from '@/design';

/**
 * The big amount field at the top of the expense form.
 *
 * Kept as raw text rather than a parsed number in state: "12." and "12.0" are both valid
 * things to be in the middle of typing, and normalising on every keystroke fights the user.
 * Parsing happens once, at the edge, via `parseAmount`.
 */
export function AmountField({
  value,
  onChangeText,
  error,
}: {
  value: string;
  onChangeText: (text: string) => void;
  error?: string | null;
}) {
  return (
    <GlassSurface radius={radius.panel} elevation="glass" contentStyle={styles.amountCard}>
      <Text style={styles.label}>Amount</Text>
      <View style={styles.amountRow}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="0"
          placeholderTextColor={color.textGhost}
          keyboardType="decimal-pad"
          inputMode="decimal"
          accessibilityLabel="Amount"
          style={styles.amountInput}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </GlassSurface>
  );
}

/** A plain single-line text field on glass. */
export function TextField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  maxLength,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
  maxLength?: number;
}) {
  return (
    <GlassSurface radius={radius.cardCompact} contentStyle={styles.textField}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={styles.textInput}
      />
    </GlassSurface>
  );
}

/** Label on the left, current value on the right, chevron. Opens a sheet. */
export function DisclosureRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
    >
      <GlassSurface radius={radius.cardCompact} contentStyle={styles.disclosure}>
        {icon}
        <Text style={styles.disclosureLabel}>{label}</Text>
        <Text style={styles.disclosureValue} numberOfLines={1}>
          {value}
        </Text>
        <Svg width={7} height={12} viewBox="0 0 7 12" fill="none">
          <Path
            d="M1.5 1l4 5-4 5"
            stroke="rgba(255,255,255,.3)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  amountCard: { padding: 20, gap: 8 },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rupee: { fontFamily: font.light, fontSize: 34, color: color.textFaint },
  amountInput: {
    flex: 1,
    padding: 0,
    fontFamily: font.semibold,
    fontSize: 40,
    color: color.textHighlight,
  },
  error: { fontFamily: font.light, fontSize: 12.5, color: color.creamRose },
  textField: { paddingHorizontal: 16, minHeight: 50, paddingVertical: 8, justifyContent: 'center' },
  textInput: { padding: 0, fontFamily: font.regular, fontSize: 15.5, color: color.cream },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    height: 50,
  },
  disclosureLabel: { fontFamily: font.regular, fontSize: 15, color: color.textSecondary },
  disclosureValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: font.medium,
    fontSize: 15,
    color: color.cream,
  },
});
