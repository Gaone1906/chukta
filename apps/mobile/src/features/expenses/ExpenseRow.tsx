import { formatAmount, money } from '@chukta/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassSurface, color, font, radius } from '@/design';
import type { MarkedBy } from '@/lib/api';

import { describeDate } from './DateSheet';
import { PaidStamp } from './PaidStamp';

/**
 * Build the row's byline from a list item, or null when the expense is still open.
 *
 * ⚠️ **Gated on `paid_in_full_at`, not on `marked_by`.** An expense can hold linked settlements
 * that no longer cover every debt — someone marks it, then an edit raises the amount — and that
 * leaves a marker on record for an expense that is emphatically not settled. `paid_in_full_at`
 * is the fact; `marked_by` is only who to credit for it.
 *
 * Lives here rather than in each screen because Group detail and Person detail both render this
 * row, and two copies of this rule would eventually disagree.
 */
export function markerFor(
  paidInFullAt: string | null,
  marked: MarkedBy | null,
  meId: string | undefined,
): ExpenseRowProps['paidBy'] {
  if (!paidInFullAt || !marked) return null;
  return {
    name: marked.display_name,
    at: describeDate(paidInFullAt.slice(0, 10)),
    isYou: marked.profile_id === meId,
  };
}

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
   * Who closed this expense, if anyone. Null means it is still open.
   *
   * Its presence is what switches the row into its settled form: the die presses behind the
   * figures, the ledger recedes, and this becomes the row's last line. Since 0040 anybody can
   * mark an expense paid, so the name is not decoration — it is the accountability the open rule
   * rests on, and it belongs everywhere the stamp appears.
   */
  paidBy?: { name: string; at: string; isYou: boolean } | null;
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
  paidBy = null,
  onPress,
}: ExpenseRowProps) {
  const paid = paidBy != null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        paidBy
          ? `${description}, ${formatAmount(money(amountMinor, 'INR'))}, paid in full, marked by ${paidBy.isYou ? 'you' : paidBy.name}`
          : `${description}, ${formatAmount(money(amountMinor, 'INR'))}`
      }
      onPress={(e) => onPress?.({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
    >
      <GlassSurface radius={radius.card}>
        {/*
          * A settled row is the same row with the ink pressed through it.
          *
          * The die sits BEHIND the type rather than on top — a rotated stamp across a 62pt row
          * has nowhere to go that is not already occupied, and every attempt to place it on top
          * landed on either the amount or the byline. Behind, the figures simply recede to make
          * room for it, and nothing has to survive underneath.
          *
          * The amount is the one thing that does NOT recede. It is how you find "the ₹50,000 one"
          * when somebody asks; the name, the split and your share are all one tap away.
          */}
        <View style={[styles.row, paid ? styles.rowPaid : null]}>
          {paid ? <PaidStamp width={228} /> : null}

          <View style={styles.body}>
            <View style={styles.topLine}>
              <View style={styles.left}>
                {groupName !== undefined ? (
                  <Text style={[styles.group, paid ? styles.faded : null]} numberOfLines={1}>
                    {groupName ?? 'One-off'}
                  </Text>
                ) : null}
                <Text
                  style={[styles.description, paid ? styles.receded : null]}
                  numberOfLines={1}
                >
                  {description}
                </Text>
                <Text style={[styles.meta, paid ? styles.faded : null]} numberOfLines={1}>
                  {meta}
                </Text>
              </View>

              <View style={styles.right}>
                <Text style={styles.amount}>{formatAmount(money(amountMinor, 'INR'))}</Text>
                <Text style={[styles.share, paid ? styles.faded : null]}>
                  your share {formatAmount(money(myShareMinor, 'INR'), { signed: false })}
                </Text>
              </View>
            </View>

            {/*
              * The byline is the top layer, and it carries a double shadow to get there: one
              * tight and dark for edge contrast against the gold line-work, one wide and soft to
              * push the die back behind the letters. Without it the accountability line is the
              * faintest type on the row, which is exactly backwards.
              */}
            {paidBy ? (
              <View style={styles.byline}>
                <View style={styles.byDot} />
                <Text style={styles.byText} numberOfLines={1}>
                  {paidBy.isYou
                    ? `You marked this paid · ${paidBy.at}`
                    : `Marked paid by ${paidBy.name} · ${paidBy.at}`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 15,
    paddingLeft: 18,
    paddingRight: 16,
  },
  /*
   * A floor on the height, so the die's TYPE never clips.
   *
   * The die is taller than the row and always overruns it — that overrun is what makes it read as
   * pressed over the edge rather than placed inside a box. Its borders may clip; "PAID IN FULL"
   * may not.
   */
  rowPaid: { minHeight: 92, justifyContent: 'center' },
  body: { zIndex: 3 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  /** What is settled steps back to let the ink through — but never disappears. */
  receded: { opacity: 0.32 },
  faded: { opacity: 0.2 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  byDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.goldLeaf, opacity: 0.8 },
  byText: {
    flex: 1,
    fontFamily: font.light,
    fontSize: 11.5,
    color: color.textFaint,
    textShadowColor: 'rgba(5,2,3,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
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
