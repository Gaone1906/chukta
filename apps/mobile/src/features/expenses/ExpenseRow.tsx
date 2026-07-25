import { formatAmount, money } from '@hisaab/core';
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
  onPress?: () => void;
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
  onPress,
}: ExpenseRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${description}, ${formatAmount(money(amountMinor, 'INR'))}`}
      onPress={onPress}
    >
      <GlassSurface radius={radius.card}>
        <View style={styles.row}>
          <View style={styles.left}>
            {groupName !== undefined ? (
              <Text style={styles.group} numberOfLines={1}>
                {groupName ?? 'One-off'}
              </Text>
            ) : null}
            <Text style={styles.description} numberOfLines={1}>
              {description}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          <View style={styles.right}>
            <Text style={styles.amount}>{formatAmount(money(amountMinor, 'INR'))}</Text>
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
  description: { fontFamily: font.medium, fontSize: 16, color: color.cream },
  meta: { fontFamily: font.light, fontSize: 12.5, color: color.textMuted },
  right: { alignItems: 'flex-end', gap: 3 },
  amount: { fontFamily: font.semibold, fontSize: 16, color: color.textHighlight },
  share: { fontFamily: font.light, fontSize: 11.5, color: color.textFaint },
});
