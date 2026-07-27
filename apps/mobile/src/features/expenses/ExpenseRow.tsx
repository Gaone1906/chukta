import { formatAmount, money } from '@chukta/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface, color, font, radius } from '@/design';

export interface ExpenseRowProps {
  description: string;
  amountMinor: bigint;
  /** What the viewer's own share is. Negative means they are owed for this one. */
  myShareMinor: bigint;
  /** "You paid · split 4 ways" — assembled by the caller, which knows the payer names. */
  meta: string;
  /** Shown above the description on Person detail; null for a one-off. */
  groupName?: string | null;
  /**
   * Settled in full: every debt this expense created has been paid back against it.
   *
   * Marked with a small `PAID` tag and dimmed figures rather than the full seal — the pressed
   * stamp is a moment, and a list of them would be wallpaper. The detail screen is where it
   * lands; this is only the reminder that it did.
   */
  paidInFull?: boolean;
  /** Reports the tap point in window coordinates, so the ripple starts under the finger. */
  onPress?: (event: { x: number; y: number }) => void;
}

/**
 * A single expense in a list. Used by both Group detail and Person detail.
 *
 * The amount shown large is the EXPENSE total; the viewer's own share sits underneath in
 * smaller type. Leading with your own share would be more personal but makes the list
 * impossible to scan against a receipt.
 */
export function ExpenseRow({
  description,
  amountMinor,
  myShareMinor,
  meta,
  groupName,
  paidInFull = false,
  onPress,
}: ExpenseRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        paidInFull
          ? `${description}, ${formatAmount(money(amountMinor, 'INR'))}, paid in full`
          : `${description}, ${formatAmount(money(amountMinor, 'INR'))}`
      }
      onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
    >
      <GlassSurface radius={radius.card}>
        <View style={styles.row}>
          <View style={styles.left}>
            {groupName !== undefined ? (
              <Text style={styles.group} numberOfLines={1}>
                {groupName ?? 'One-off'}
              </Text>
            ) : null}
            <View style={styles.titleRow}>
              <Text
                style={[styles.description, paidInFull ? styles.dim : null]}
                numberOfLines={1}
              >
                {description}
              </Text>
              {paidInFull ? (
                <View style={styles.paidTag}>
                  <Text style={styles.paidTagLabel}>PAID</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          <View style={styles.right}>
            <Text style={[styles.amount, paidInFull ? styles.dim : null]}>
              {formatAmount(money(amountMinor, 'INR'))}
            </Text>
            <Text style={styles.share}>
              your share {formatAmount(money(myShareMinor, 'INR'), { signed: false })}
            </Text>
          </View>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingLeft: 18,
    paddingRight: 16,
  },
  left: { flex: 1, gap: 3 },
  group: {
    fontFamily: font.regular,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: color.textGhost,
  },
  // `flexShrink` rather than `flex: 1`: the description gives way to the tag when it has to, but
  // a short name does not get padded out into the middle of the row.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  description: { flexShrink: 1, fontFamily: font.medium, fontSize: 16, color: color.cream },
  dim: { opacity: 0.6 },
  paidTag: {
    borderWidth: 1,
    borderColor: 'rgba(184,150,60,0.5)',
    backgroundColor: 'rgba(184,150,60,0.13)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  paidTagLabel: {
    fontFamily: font.medium,
    fontSize: 8.5,
    letterSpacing: 1.1,
    color: color.goldBright,
  },
  meta: { fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  right: { alignItems: 'flex-end', gap: 3 },
  amount: { fontFamily: font.semibold, fontSize: 16, color: color.textHighlight },
  share: { fontFamily: font.light, fontSize: 11.5, color: color.textFaint },
});
